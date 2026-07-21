import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import type { Evidence } from '@atlas/shared';
import {
  buildEvidenceContext,
  type BuildEvidenceContextOptions,
} from './evidenceContext.js';
import { logInfo, logWarn } from './logger.js';

export type LlmProviderName = 'groq' | 'openrouter' | 'gemini';

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

/**
 * Provider-independent LLM call.
 * Retrieval is NEVER performed here — pass Evidence from the Evidence Store.
 */
export type CallLlmOptions = {
  prompt: string;
  schema?: string;
  maxRetries?: number;
  /** Explicit evidence from Retrieval Layer / Evidence Store */
  evidence?: Evidence[];
  /** Ranking query for evidence selection */
  evidenceQuery?: string;
  evidenceOptions?: Omit<BuildEvidenceContextOptions, 'query'>;
  systemPrompt?: string;
  signal?: AbortSignal;
};

export type CallLlmResult<T> = {
  data: T | null;
  raw: string;
  /** Canonical URLs of evidence actually injected into the prompt */
  sources: string[];
  evidenceIds: string[];
  provider: LlmProviderName | null;
  model: string | null;
  usage: TokenUsage | null;
  estimatedCostUsd: number | null;
  latencyMs: number | null;
};

export type ProviderHealth = {
  configured: boolean;
  ok: boolean;
  error?: string;
};

const DEFAULT_SYSTEM = `You are a careful market-intelligence researcher.
Use ONLY the EVIDENCE block in the user message for factual claims.
If evidence is missing or insufficient, use null. Never invent facts.
Return only valid JSON objects.`;

const OPENROUTER_MODELS = [
  process.env.OPENROUTER_MODEL,
  'openrouter/free',
  'google/gemma-4-31b-it:free',
  'openai/gpt-oss-20b:free',
  'nvidia/nemotron-3-nano-30b-a3b:free',
  'poolside/laguna-m.1:free',
].filter(Boolean) as string[];

const GEMINI_MODELS = [
  process.env.GEMINI_MODEL,
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
].filter(Boolean) as string[];

// Groq free tier — real, generous quota (unlike OpenRouter's churny :free
// roster and Gemini's low daily cap). OpenAI-compatible API. Hosts strong
// open models incl. Chinese (Qwen). Verified live 2026-07-21.
const GROQ_MODELS = [
  process.env.GROQ_MODEL,
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-120b',
  'qwen/qwen3.6-27b',
  'llama-3.1-8b-instant',
].filter(Boolean) as string[];

/** Rough USD / 1M tokens — logging estimate only, not billing. */
const COST_PER_MTOKEN: Record<string, { in: number; out: number }> = {
  openrouter: { in: 0.05, out: 0.05 },
  gemini: { in: 0.1, out: 0.4 },
};

let openRouterClient: OpenAI | null = null;
let openRouterKeyUsed: string | null = null;
let groqClient: OpenAI | null = null;
let groqKeyUsed: string | null = null;
let geminiClient: GoogleGenerativeAI | null = null;
let lastActiveProvider: LlmProviderName | null = null;
let openRouterDisabledReason: string | null = null;

export function sanitizeApiKey(raw: string | undefined | null): string | null {
  if (!raw) return null;
  let key = raw.trim();
  if (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }
  key = key.replace(/^\uFEFF/, '').replace(/[\u200B-\u200D\uFEFF]/g, '');
  return key.length > 0 ? key : null;
}

export function getOpenRouterApiKey(): string | null {
  return sanitizeApiKey(process.env.OPENROUTER_API_KEY);
}

export function getGeminiApiKey(): string | null {
  return sanitizeApiKey(process.env.GEMINI_API_KEY);
}

export function getGroqApiKey(): string | null {
  return sanitizeApiKey(process.env.GROQ_API_KEY);
}

export function getProviderOrder(): LlmProviderName[] {
  const raw = (process.env.LLM_PROVIDER_ORDER ?? 'groq,gemini,openrouter')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const order = raw.filter(
    (p): p is LlmProviderName => p === 'groq' || p === 'openrouter' || p === 'gemini',
  );
  return order.length ? order : ['groq', 'gemini', 'openrouter'];
}

export function getActiveProvider(): LlmProviderName | null {
  if (lastActiveProvider) return lastActiveProvider;
  for (const p of getProviderOrder()) {
    if (p === 'groq' && getGroqApiKey()) return p;
    if (p === 'openrouter' && getOpenRouterApiKey() && !openRouterDisabledReason) {
      return p;
    }
    if (p === 'gemini' && getGeminiApiKey()) return p;
  }
  return null;
}

export function hasAnyLlmProvider(): boolean {
  return Boolean(getGroqApiKey() || getOpenRouterApiKey() || getGeminiApiKey());
}

function getOpenRouter(): OpenAI {
  const key = getOpenRouterApiKey();
  if (!key) throw new Error('OPENROUTER_API_KEY is not set');
  if (!openRouterClient || openRouterKeyUsed !== key) {
    openRouterClient = new OpenAI({
      apiKey: key,
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'Atlas',
      },
    });
    openRouterKeyUsed = key;
    openRouterDisabledReason = null;
  }
  return openRouterClient;
}

function getGroq(): OpenAI {
  const key = getGroqApiKey();
  if (!key) throw new Error('GROQ_API_KEY is not set');
  if (!groqClient || groqKeyUsed !== key) {
    groqClient = new OpenAI({
      apiKey: key,
      baseURL: 'https://api.groq.com/openai/v1',
    });
    groqKeyUsed = key;
  }
  return groqClient;
}

function getGemini(): GoogleGenerativeAI {
  const key = getGeminiApiKey();
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  if (!geminiClient) {
    geminiClient = new GoogleGenerativeAI(key);
  }
  return geminiClient;
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function estimateTokensFromText(text: string): number {
  return Math.ceil(text.length / 4);
}

function estimateCostUsd(
  provider: LlmProviderName,
  usage: TokenUsage,
): number {
  const rates = COST_PER_MTOKEN[provider] ?? { in: 0.1, out: 0.1 };
  return (
    (usage.promptTokens / 1_000_000) * rates.in +
    (usage.completionTokens / 1_000_000) * rates.out
  );
}

/**
 * Compose the user message: task prompt + optional schema + evidence context.
 * Providers receive identical text — no provider-specific retrieval.
 */
export function buildUserMessage(input: {
  prompt: string;
  schema?: string;
  evidenceText?: string;
}): string {
  const parts: string[] = [];
  if (input.evidenceText) {
    parts.push(input.evidenceText);
    parts.push('');
  }
  parts.push(input.prompt);
  if (input.schema) {
    parts.push('');
    parts.push('JSON shape (follow exactly, use null when unknown):');
    parts.push(input.schema);
  }
  parts.push('');
  parts.push('Respond with ONLY valid JSON. No markdown fences. Never invent values.');
  return parts.join('\n');
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function isAuthError(err: unknown): boolean {
  const msg = errMessage(err);
  return /401|403|Unauthorized|User not found|invalid.?api.?key|authentication/i.test(
    msg,
  );
}

function isRetryable(err: unknown): boolean {
  const msg = errMessage(err);
  if (isAuthError(err)) return false;
  return /429|quota|rate.?limit|timeout|503|502|overloaded|capacity|temporarily/i.test(
    msg,
  );
}

function isFatalDailyQuota(err: unknown): boolean {
  return /PerDayPerProjectPerModel|quota.*limit: 0/i.test(errMessage(err));
}

export async function probeOpenRouter(): Promise<ProviderHealth> {
  const key = getOpenRouterApiKey();
  if (!key) {
    return { configured: false, ok: false, error: 'OPENROUTER_API_KEY missing' };
  }
  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: {
        Authorization: `Bearer ${key}`,
        'HTTP-Referer': 'http://localhost:5173',
        'X-Title': 'Atlas',
      },
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 401 || res.status === 403) {
      const body = await res.text();
      openRouterDisabledReason =
        'OPENROUTER_API_KEY rejected (401/403). Create a new key at https://openrouter.ai/keys and update .env';
      return {
        configured: true,
        ok: false,
        error: `OpenRouter auth failed (${res.status}): ${body.slice(0, 120)}`,
      };
    }
    if (!res.ok) {
      return {
        configured: true,
        ok: false,
        error: `OpenRouter probe HTTP ${res.status}`,
      };
    }
    openRouterDisabledReason = null;
    return { configured: true, ok: true };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      error: errMessage(err).slice(0, 200),
    };
  }
}

export async function probeGemini(): Promise<ProviderHealth> {
  const key = getGeminiApiKey();
  if (!key) {
    return { configured: false, ok: false, error: 'GEMINI_API_KEY missing' };
  }
  return { configured: true, ok: true };
}

type ProviderCallResult = {
  raw: string;
  model: string;
  usage: TokenUsage | null;
};

async function callGroq(
  systemPrompt: string,
  userMessage: string,
  maxRetries: number,
  signal?: AbortSignal,
): Promise<ProviderCallResult> {
  if (signal?.aborted) throw new Error('aborted');
  const client = getGroq();
  let lastErr: unknown;

  for (const model of GROQ_MODELS) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) throw new Error('aborted');
      try {
        const completion = await client.chat.completions.create(
          {
            model,
            temperature: 0.2,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage },
            ],
          },
          signal ? { signal } : undefined,
        );

        const raw = completion.choices[0]?.message?.content ?? '';
        if (!raw.trim()) throw new Error('Empty Groq response');

        const usage: TokenUsage | null = completion.usage
          ? {
              promptTokens: completion.usage.prompt_tokens ?? 0,
              completionTokens: completion.usage.completion_tokens ?? 0,
              totalTokens:
                completion.usage.total_tokens ??
                (completion.usage.prompt_tokens ?? 0) + (completion.usage.completion_tokens ?? 0),
            }
          : {
              promptTokens: estimateTokensFromText(systemPrompt + userMessage),
              completionTokens: estimateTokensFromText(raw),
              totalTokens: 0,
            };
        if (usage && usage.totalTokens === 0) {
          usage.totalTokens = usage.promptTokens + usage.completionTokens;
        }

        return { raw, model, usage };
      } catch (err) {
        lastErr = err;
        logWarn(`[llm] groq model=${model} attempt=${attempt + 1} failed`, {
          error: errMessage(err).slice(0, 240),
        });
        if (isAuthError(err)) {
          throw new Error(
            'GROQ_API_KEY rejected (401). Create a key at https://console.groq.com/keys and update .env.',
          );
        }
        if (!isRetryable(err) || attempt === maxRetries) break;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('Groq failed for all models');
}

async function callOpenRouter(
  systemPrompt: string,
  userMessage: string,
  maxRetries: number,
  signal?: AbortSignal,
): Promise<ProviderCallResult> {
  if (openRouterDisabledReason) {
    throw new Error(openRouterDisabledReason);
  }
  if (signal?.aborted) throw new Error('aborted');

  const client = getOpenRouter();
  let lastErr: unknown;

  for (const model of OPENROUTER_MODELS) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) throw new Error('aborted');
      try {
        const completion = await client.chat.completions.create(
          {
            model,
            temperature: 0.2,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userMessage },
            ],
          },
          signal ? { signal } : undefined,
        );

        const raw = completion.choices[0]?.message?.content ?? '';
        if (!raw.trim()) throw new Error('Empty OpenRouter response');

        const usage: TokenUsage | null = completion.usage
          ? {
              promptTokens: completion.usage.prompt_tokens ?? 0,
              completionTokens: completion.usage.completion_tokens ?? 0,
              totalTokens: completion.usage.total_tokens ?? 0,
            }
          : {
              promptTokens: estimateTokensFromText(systemPrompt + userMessage),
              completionTokens: estimateTokensFromText(raw),
              totalTokens: 0,
            };
        if (usage && usage.totalTokens === 0) {
          usage.totalTokens = usage.promptTokens + usage.completionTokens;
        }

        return { raw, model, usage };
      } catch (err) {
        lastErr = err;
        logWarn(`[llm] openrouter model=${model} attempt=${attempt + 1} failed`, {
          error: errMessage(err).slice(0, 240),
        });

        if (isAuthError(err)) {
          openRouterDisabledReason =
            'OPENROUTER_API_KEY rejected (401). Create a new key at https://openrouter.ai/keys, paste into .env, restart backend.';
          throw new Error(openRouterDisabledReason);
        }

        if (!isRetryable(err) || attempt === maxRetries) break;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error('OpenRouter failed for all models');
}

async function callGemini(
  systemPrompt: string,
  userMessage: string,
  maxRetries: number,
  signal?: AbortSignal,
): Promise<ProviderCallResult> {
  if (signal?.aborted) throw new Error('aborted');

  const client = getGemini();
  let lastErr: unknown;
  // Gemini: fold system into user — no Google Search / grounding tools
  const combined = `${systemPrompt}\n\n${userMessage}`;

  for (const modelId of GEMINI_MODELS) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) throw new Error('aborted');
      try {
        const model = client.getGenerativeModel({
          model: modelId,
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json',
          },
        });

        const result = await model.generateContent({
          contents: [{ role: 'user', parts: [{ text: combined }] }],
        });

        const raw = result.response.text();
        if (!raw.trim()) throw new Error('Empty Gemini response');

        const usage: TokenUsage = {
          promptTokens: estimateTokensFromText(combined),
          completionTokens: estimateTokensFromText(raw),
          totalTokens: 0,
        };
        usage.totalTokens = usage.promptTokens + usage.completionTokens;

        return { raw, model: modelId, usage };
      } catch (err) {
        lastErr = err;
        logWarn(`[llm] gemini model=${modelId} attempt=${attempt + 1} failed`, {
          error: errMessage(err).slice(0, 240),
        });
        if (isFatalDailyQuota(err)) break;
        if (!isRetryable(err) || attempt === maxRetries) break;
        const retryMatch = errMessage(err).match(/retry in ([\d.]+)s/i);
        const wait = retryMatch
          ? Math.ceil(parseFloat(retryMatch[1]) * 1000) + 300
          : 2000 * (attempt + 1);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error('Gemini failed for all models');
}

export async function callLLM<T = unknown>(
  options: CallLlmOptions,
): Promise<CallLlmResult<T>> {
  const {
    prompt,
    schema,
    maxRetries = 2,
    evidence = [],
    evidenceQuery,
    evidenceOptions,
    systemPrompt = DEFAULT_SYSTEM,
    signal,
  } = options;

  const evidenceCtx = buildEvidenceContext(evidence, {
    query: evidenceQuery ?? prompt.slice(0, 400),
    ...evidenceOptions,
  });

  const userMessage = buildUserMessage({
    prompt,
    schema,
    evidenceText: evidenceCtx.text,
  });

  const order = getProviderOrder();
  let lastError: unknown;
  const started = Date.now();

  for (const provider of order) {
    if (provider === 'groq' && !getGroqApiKey()) continue;
    if (provider === 'openrouter') {
      if (!getOpenRouterApiKey() || openRouterDisabledReason) continue;
    }
    if (provider === 'gemini' && !getGeminiApiKey()) continue;

    try {
      const result =
        provider === 'groq'
          ? await callGroq(systemPrompt, userMessage, maxRetries, signal)
          : provider === 'openrouter'
            ? await callOpenRouter(systemPrompt, userMessage, maxRetries, signal)
            : await callGemini(systemPrompt, userMessage, maxRetries, signal);

      lastActiveProvider = provider;
      const latencyMs = Date.now() - started;
      const usage = result.usage;
      const estimatedCostUsd = usage
        ? estimateCostUsd(provider, usage)
        : null;

      logInfo('[llm] call complete', {
        provider,
        model: result.model,
        evidenceCount: evidenceCtx.evidenceIds.length,
        evidenceIds: evidenceCtx.evidenceIds,
        promptTokens: usage?.promptTokens ?? null,
        completionTokens: usage?.completionTokens ?? null,
        estimatedCostUsd,
        latencyMs,
      });

      const sources = evidenceCtx.selected.map((d) => d.canonicalUrl);

      try {
        const data = JSON.parse(stripCodeFences(result.raw)) as T;
        return {
          data,
          raw: result.raw,
          sources,
          evidenceIds: evidenceCtx.evidenceIds,
          provider,
          model: result.model,
          usage,
          estimatedCostUsd,
          latencyMs,
        };
      } catch {
        logWarn(`[llm] ${provider} returned non-JSON`, {
          preview: result.raw.slice(0, 160),
        });
        return {
          data: null,
          raw: result.raw,
          sources,
          evidenceIds: evidenceCtx.evidenceIds,
          provider,
          model: result.model,
          usage,
          estimatedCostUsd,
          latencyMs,
        };
      }
    } catch (err) {
      lastError = err;
      logWarn(`[llm] provider=${provider} failed — trying next`, {
        error: errMessage(err).slice(0, 240),
      });
    }
  }

  logWarn('[llm] all providers failed', {
    error: errMessage(lastError).slice(0, 240),
    evidenceCount: evidenceCtx.evidenceIds.length,
  });

  return {
    data: null,
    raw: '',
    sources: [],
    evidenceIds: evidenceCtx.evidenceIds,
    provider: null,
    model: null,
    usage: null,
    estimatedCostUsd: null,
    latencyMs: Date.now() - started,
  };
}

export { buildEvidenceContext } from './evidenceContext.js';
