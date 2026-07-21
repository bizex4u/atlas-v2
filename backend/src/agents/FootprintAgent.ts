import { callLLM } from '../utils/llm.js';
import { logAgentRaw } from '../utils/logger.js';
import {
  confidenceFromEvidence,
  field,
  getAgentEvidence,
  needsInput,
  type Agent,
  type AgentContext,
  type FootprintResult,
  type StoreCity,
} from './types.js';

type NewsFootprint = {
  totalStores?: number | null;
  storesByCity?: Array<{
    city: string;
    count: number;
    addresses?: string[];
  }> | null;
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

export class FootprintAgent implements Agent<FootprintResult> {
  name = 'Footprint' as const;

  async run(brandName: string, context: AgentContext): Promise<FootprintResult> {
    const official = context.discovery?.officialName.value ?? brandName;
    const evidence = getAgentEvidence(context);

    const { data, raw, sources, evidenceIds, provider, model, usage, estimatedCostUsd } =
      await callLLM<NewsFootprint>({
        prompt: `Extract retail store footprint for "${official}" in India from EVIDENCE only.
Rules: Do not invent. If only a national total is mentioned, put it in totalStores and leave cities empty.`,
        evidence,
        evidenceQuery: `${official} store count retail stores locations`,
        maxRetries: 2,
        signal: context.signal,
        schema: `{
  "totalStores": number | null,
  "storesByCity": [{ "city": string, "count": number, "addresses": string[] }] | null
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

    const cities: StoreCity[] = (data?.storesByCity ?? []).map((c) => ({
      city: c.city,
      count: c.count,
      addresses: c.addresses ?? [],
    }));
    const total =
      cities.reduce((sum, c) => sum + c.count, 0) || data?.totalStores || null;

    if (total == null || total === 0) {
      return {
        totalStores: needsInput('insufficient_sources'),
        storesByCity: needsInput('insufficient_sources'),
        confidence: 'needs_input',
        partial: true,
        error: 'No store footprint in evidence',
      };
    }

    const conf = confidenceFromEvidence(evidenceIds);
    const opts = {
      evidenceIds,
      sources,
      extractionMethod: 'llm_extract' as const,
    };

    return {
      totalStores: field(total, conf, opts),
      storesByCity: cities.length
        ? field(cities, conf, opts)
        : needsInput('city breakdown unavailable'),
      confidence: conf,
      partial: cities.length === 0,
    };
  }
}
