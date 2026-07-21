import { callLLM } from '../utils/llm.js';
import { logAgentRaw } from '../utils/logger.js';
import {
  confidenceFromEvidence,
  field,
  getAgentEvidence,
  needsInput,
  type Agent,
  type AgentContext,
  type FinancialsResult,
} from './types.js';

type MetricsBundle = {
  revenue?: string | null;
  cagr?: string | null;
  growthTarget?: string | null;
  priceRange?: string | null;
};

function accumulateUsage(
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

export class FinancialsAgent implements Agent<FinancialsResult> {
  name = 'Financials' as const;

  async run(brandName: string, context: AgentContext): Promise<FinancialsResult> {
    const official = context.discovery?.officialName.value ?? brandName;
    const category = context.discovery?.category.value ?? '';
    const evidence = getAgentEvidence(context);

    const { data, raw, sources, evidenceIds, provider, model, usage, estimatedCostUsd } =
      await callLLM<MetricsBundle>({
        prompt: `Extract public financial metrics for "${official}" (${category}) in India from EVIDENCE only.
Rules: null when not clearly present. Never invent precise figures.`,
        evidence,
        evidenceQuery: `${official} revenue CAGR financial results`,
        maxRetries: 2,
        signal: context.signal,
        schema: `{
  "revenue": string|null,
  "cagr": string|null,
  "growthTarget": string|null,
  "priceRange": string|null
}`,
      });

    accumulateUsage(context, usage, estimatedCostUsd, provider, model);

    logAgentRaw(this.name, brandName, {
      raw,
      data,
      sources,
      evidenceIds,
      evidenceCount: evidence.length,
      provider,
      model,
    });

    const conf = confidenceFromEvidence(evidenceIds);
    const opts = {
      evidenceIds,
      sources,
      extractionMethod: 'llm_extract' as const,
    };

    const result: FinancialsResult = {
      revenue: data?.revenue
        ? field(data.revenue, conf, opts)
        : needsInput('insufficient_sources'),
      cagr: data?.cagr
        ? field(data.cagr, conf, opts)
        : needsInput('insufficient_sources'),
      growthTarget: data?.growthTarget
        ? field(data.growthTarget, conf, opts)
        : needsInput('insufficient_sources'),
      priceRange: data?.priceRange
        ? field(data.priceRange, conf, opts)
        : needsInput('insufficient_sources'),
      partial: true,
    };
    result.partial = [
      result.revenue,
      result.cagr,
      result.growthTarget,
      result.priceRange,
    ].some((f) => f.confidence === 'needs_input');

    return result;
  }
}
