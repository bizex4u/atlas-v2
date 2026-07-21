import { callLLM } from '../utils/llm.js';
import { logAgentRaw } from '../utils/logger.js';
import {
  confidenceFromEvidence,
  field,
  getAgentEvidence,
  needsInput,
  type Agent,
  type AgentContext,
  type CompetitorResult,
} from './types.js';

type CompetitorLlm = {
  competitors?: Array<{ name: string; positioning: string }> | null;
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

export class CompetitorAgent implements Agent<CompetitorResult> {
  name = 'Competitor' as const;

  async run(brandName: string, context: AgentContext): Promise<CompetitorResult> {
    const official = context.discovery?.officialName.value ?? brandName;
    const category = context.discovery?.category.value ?? 'its category';
    const evidence = getAgentEvidence(context);

    const { data, raw, sources, evidenceIds, provider, model, usage, estimatedCostUsd } =
      await callLLM<CompetitorLlm>({
        prompt: `Top 5 competitors of "${official}" in ${category} in India from EVIDENCE only.
Rules:
- Exactly up to 5 competitors that actually compete in India.
- positioning: one short sentence.
- If unsure about a competitor, omit it rather than inventing.
- If none can be verified from evidence, return { "competitors": [] }.`,
        evidence,
        evidenceQuery: `${official} competitors vs rivals ${category}`,
        maxRetries: 2,
        signal: context.signal,
        schema: `{
  "competitors": [{ "name": string, "positioning": string }]
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

    const list = (data?.competitors ?? [])
      .filter((c) => c?.name)
      .slice(0, 5)
      .map((c) => ({
        name: c.name,
        positioning: c.positioning || 'Positioning unavailable',
      }));

    if (!list.length) {
      return {
        competitors: needsInput('insufficient_sources'),
        partial: true,
        error: 'No verified competitors',
      };
    }

    const conf = confidenceFromEvidence(evidenceIds);
    return {
      competitors: field(list, conf, {
        evidenceIds,
        sources,
        extractionMethod: 'llm_extract',
      }),
    };
  }
}
