import { callLLM } from '../utils/llm.js';
import { logAgentRaw } from '../utils/logger.js';
import {
  confidenceFromEvidence,
  field,
  getAgentEvidence,
  needsInput,
  refsFromIds,
  type Agent,
  type AgentContext,
  type StrategyResult,
} from './types.js';

type StrategyLlm = {
  priorityMarkets?: Array<{
    name: string;
    priority: 'P1' | 'P2' | 'P3';
    rationale: string;
    budgetAllocation: string;
  }> | null;
  sequencing?: Array<{
    weeks: string;
    channel: string;
    budgetShare: string;
    goal: string;
  }> | null;
  seasonalPhases?: Array<{
    phase: string;
    window: string;
    budgetShare: string;
    actions: string[];
  }> | null;
  budget?: {
    total?: string | null;
    barterSavings?: string | null;
    lineItems?: Array<{
      channel: string;
      market: string;
      listCost: string;
      postBarterCost: string;
      percentOfTotal: string;
    }> | null;
  } | null;
  creativePillars?: string[] | null;
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

export class StrategyAgent implements Agent<StrategyResult> {
  name = 'Strategy' as const;

  async run(brandName: string, context: AgentContext): Promise<StrategyResult> {
    const evidence = getAgentEvidence(context);
    const payload = {
      discovery: context.discovery,
      financials: context.financials,
      footprint: context.footprint,
      campaign: context.campaign,
      competitor: context.competitor,
      geo: context.geo,
    };

    const prompt = `You are a senior media strategist at Bizex4U (barter media).
Synthesize a campaign strategy for "${brandName}" from RESEARCH JSON and EVIDENCE.

Rules:
- Exactly 3 priority markets when geo/footprint allows; otherwise fewer.
- Prefer markets with higher store density + Zepto overlap for quick-commerce adjacency.
- Sequencing should cover ~12 weeks (OOH → FM/Digital → Cinema or similar).
- Budget figures must be clearly labeled as estimates if research lacked hard numbers; use null rather than inventing precise rupee figures.
- Do not fabricate store counts or revenue numbers not present in the input or evidence.
- priorityMarkets names MUST be chosen ONLY from the market names present in RESEARCH.geo.markets. Never introduce a city not in that list. If geo.markets is empty, return priorityMarkets: [].

RESEARCH:
${JSON.stringify(payload).slice(0, 20000)}`;

    const { data, raw, sources, evidenceIds, provider, model, usage, estimatedCostUsd } =
      await callLLM<StrategyLlm>({
        prompt,
        evidence,
        evidenceQuery: `${brandName} markets campaign strategy`,
        maxRetries: 2,
        signal: context.signal,
        schema: `{
  "priorityMarkets": [{ "name": string, "priority": "P1"|"P2"|"P3", "rationale": string, "budgetAllocation": string }],
  "sequencing": [{ "weeks": string, "channel": string, "budgetShare": string, "goal": string }],
  "seasonalPhases": [{ "phase": string, "window": string, "budgetShare": string, "actions": string[] }],
  "budget": {
    "total": string | null,
    "barterSavings": string | null,
    "lineItems": [{ "channel": string, "market": string, "listCost": string, "postBarterCost": string, "percentOfTotal": string }] | null
  },
  "creativePillars": string[] | null
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
        error: 'Strategy synthesis failed',
        priorityMarkets: [],
        sequencing: [],
        seasonalPhases: [],
        budget: {
          total: needsInput('insufficient_sources'),
          barterSavings: needsInput('insufficient_sources'),
          lineItems: needsInput('insufficient_sources'),
        },
        creativePillars: needsInput('insufficient_sources'),
      };
    }

    const geoMarkets = context.geo?.markets ?? [];
    const evidenceRefs = refsFromIds(evidenceIds);
    // Structural anti-invention gate: a priority market may ONLY exist if it
    // maps to a real Geo market (footprint-derived or HQ-seed). The LLM cannot
    // introduce a metro that Geo never produced. Empty geo → empty markets →
    // honest failure, never fabricated Gurugram/Delhi/Mumbai.
    const priorityMarkets = (data.priorityMarkets ?? [])
      .filter((m) => typeof m?.name === 'string' && m.name.trim())
      .map((m) => ({
        m,
        geo: geoMarkets.find((g) => g.name.toLowerCase() === m.name!.trim().toLowerCase()),
      }))
      .filter((x): x is { m: typeof x.m; geo: (typeof geoMarkets)[number] } => Boolean(x.geo))
      .slice(0, 3)
      .map(({ m, geo }) => {
        return {
          name: geo.name, // canonical Geo name, not the LLM's spelling
          priority: (m.priority ?? 'P1') as 'P1' | 'P2' | 'P3',
          rationale: m.rationale ?? '',
          budgetAllocation: m.budgetAllocation ?? '',
          storeCount: geo.storeCount,
          clusters: geo.clusters,
          highways: geo.highways,
          zeptoOverlap: geo.zeptoOverlap,
          evidence: evidenceRefs,
        };
      });

    const conf = confidenceFromEvidence(evidenceIds);
    const opts = {
      evidenceIds,
      sources,
      extractionMethod: 'llm_extract' as const,
    };

    const sequencing = (data.sequencing ?? [])
      .filter((s) => typeof s?.weeks === 'string' && s.weeks.trim())
      .map((s) => ({
        weeks: s.weeks!,
        channel: s.channel ?? '',
        budgetShare: s.budgetShare ?? '',
        goal: s.goal ?? '',
        evidence: evidenceRefs,
      }));
    const seasonalPhases = (data.seasonalPhases ?? [])
      .filter((s) => typeof s?.phase === 'string' && s.phase.trim())
      .map((s) => ({
        phase: s.phase!,
        window: s.window ?? '',
        budgetShare: s.budgetShare ?? '',
        actions: Array.isArray(s.actions) ? s.actions.filter(Boolean) : [],
        evidence: evidenceRefs,
      }));

    return {
      priorityMarkets,
      sequencing,
      seasonalPhases,
      budget: {
        total: data.budget?.total
          ? field(data.budget.total, conf, opts)
          : needsInput('insufficient_sources'),
        barterSavings: data.budget?.barterSavings
          ? field(data.budget.barterSavings, conf, opts)
          : needsInput('insufficient_sources'),
        lineItems: data.budget?.lineItems?.length
          ? field(data.budget.lineItems, conf, opts)
          : needsInput('insufficient_sources'),
      },
      creativePillars: data.creativePillars?.length
        ? field(data.creativePillars, conf, opts)
        : (context.campaign?.pillars ?? needsInput('insufficient_sources')),
      usedEvidenceIds: evidenceIds,
      partial: priorityMarkets.length < 3,
    };
  }
}
