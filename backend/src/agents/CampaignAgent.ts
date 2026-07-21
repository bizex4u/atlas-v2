import { callLLM } from '../utils/llm.js';
import { logAgentRaw } from '../utils/logger.js';
import {
  confidenceFromEvidence,
  field,
  getAgentEvidence,
  needsInput,
  type Agent,
  type AgentContext,
  type CampaignResult,
} from './types.js';

type CampaignLlm = {
  activeCampaign?: string | null;
  ambassador?: string | null;
  tvcName?: string | null;
  pillars?: string[] | null;
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

export class CampaignAgent implements Agent<CampaignResult> {
  name = 'Campaign' as const;

  async run(brandName: string, context: AgentContext): Promise<CampaignResult> {
    const official = context.discovery?.officialName.value ?? brandName;
    const evidence = getAgentEvidence(context);

    const prompt = `Extract current marketing signals for "${official}" in India from EVIDENCE only.
Prefer recent campaigns, ambassadors, TVC names, and creative pillars.
Null if unverified. Do not invent.`;

    const { data, raw, sources, evidenceIds, provider, model, usage, estimatedCostUsd } =
      await callLLM<CampaignLlm>({
        prompt,
        evidence,
        evidenceQuery: `${official} campaign ambassador advertising marketing`,
        maxRetries: 2,
        signal: context.signal,
        schema: `{
  "activeCampaign": string | null,
  "ambassador": string | null,
  "tvcName": string | null,
  "pillars": string[] | null
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

    if (!data) {
      return {
        partial: true,
        error: 'Campaign extraction failed',
        activeCampaign: needsInput('insufficient_sources'),
        ambassador: needsInput('insufficient_sources'),
        tvcName: needsInput('insufficient_sources'),
        pillars: needsInput('insufficient_sources'),
      };
    }

    const conf = confidenceFromEvidence(evidenceIds);
    const opts = {
      evidenceIds,
      sources,
      extractionMethod: 'llm_extract' as const,
    };

    return {
      activeCampaign: data.activeCampaign
        ? field(data.activeCampaign, conf, opts)
        : needsInput('insufficient_sources'),
      ambassador: data.ambassador
        ? field(data.ambassador, conf, opts)
        : needsInput('insufficient_sources'),
      tvcName: data.tvcName
        ? field(data.tvcName, conf, opts)
        : needsInput('insufficient_sources'),
      pillars:
        Array.isArray(data.pillars) && data.pillars.length
          ? field(data.pillars, conf, opts)
          : needsInput('insufficient_sources'),
      partial: !data.activeCampaign && !data.ambassador,
    };
  }
}
