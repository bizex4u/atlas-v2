import { callLLM } from '../utils/llm.js';
import { logAgentRaw } from '../utils/logger.js';
import {
  confidenceFromEvidence,
  field,
  getAgentEvidence,
  needsInput,
  type Agent,
  type AgentContext,
  type DiscoveryResult,
} from './types.js';

type DiscoveryLlm = {
  officialName?: string | null;
  website?: string | null;
  category?: string | null;
  hq?: string | null;
  aliases?: string[] | null;
};

export class DiscoveryAgent implements Agent<DiscoveryResult> {
  name = 'Discovery' as const;

  async run(brandName: string, context: AgentContext): Promise<DiscoveryResult> {
    const evidence = getAgentEvidence(context);
    const prompt = `Resolve the official company profile for the brand: "${brandName}" (India focus).

Use the EVIDENCE block when present. Prefer official website and about pages.
You MAY set officialName to "${brandName}" when evidence clearly refers to that same brand.
category should be concise (e.g. "Footwear retail", "Coffee retail").
hq should include city and country if known.
If a field is not supported by evidence, use null (except officialName as above when evidence confirms the brand).
Do NOT invent revenue, store counts, or other metrics.`;

    const { data, raw, sources, evidenceIds, provider, model, usage, estimatedCostUsd } =
      await callLLM<DiscoveryLlm>({
        prompt,
        evidence,
        evidenceQuery: `${brandName} company about website headquarters`,
        maxRetries: 2,
        signal: context.signal,
        schema: `{
  "officialName": string | null,
  "website": string | null,
  "category": string | null,
  "hq": string | null,
  "aliases": string[] | null
}`,
      });

    this.#accumulateUsage(context, usage, estimatedCostUsd, provider, model);

    logAgentRaw(this.name, brandName, {
      raw,
      data,
      sources,
      evidenceIds,
      evidenceCount: evidence.length,
      provider,
      model,
    });

    if (!data) {
      return {
        partial: true,
        error: 'Discovery LLM returned no parseable JSON',
        officialName: needsInput('insufficient_sources'),
        website: needsInput('insufficient_sources'),
        category: needsInput('insufficient_sources'),
        hq: needsInput('insufficient_sources'),
        aliases: needsInput('insufficient_sources'),
      };
    }

    const conf = confidenceFromEvidence(evidenceIds);
    const opts = {
      evidenceIds,
      sources,
      extractionMethod: 'llm_extract' as const,
    };

    return {
      officialName: data.officialName
        ? field(data.officialName, conf, opts)
        : needsInput('insufficient_sources'),
      website: data.website
        ? field(data.website, conf, opts)
        : needsInput('insufficient_sources'),
      category: data.category
        ? field(data.category, conf, opts)
        : needsInput('insufficient_sources'),
      hq: data.hq ? field(data.hq, conf, opts) : needsInput('insufficient_sources'),
      aliases:
        Array.isArray(data.aliases) && data.aliases.length
          ? field(data.aliases, conf, opts)
          : needsInput('insufficient_sources'),
    };
  }

  #accumulateUsage(
    context: AgentContext,
    usage: { promptTokens: number; completionTokens: number } | null,
    cost: number | null,
    provider: string | null,
    model: string | null,
  ) {
    if (!context.telemetry) return;
    if (usage) {
      context.telemetry.promptTokens += usage.promptTokens;
      context.telemetry.completionTokens += usage.completionTokens;
    }
    if (cost) context.telemetry.estimatedCostUsd += cost;
    if (provider) context.telemetry.provider = provider;
    if (model) context.telemetry.model = model;
  }
}
