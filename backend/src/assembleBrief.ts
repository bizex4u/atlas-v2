import type { BriefMeta, CampaignBrief, Field } from '@atlas/shared';
import type {
  CampaignResult,
  CompetitorResult,
  DiscoveryResult,
  FinancialsResult,
  FootprintResult,
  RunTelemetry,
  StrategyResult,
} from './agents/types.js';
import { needsInput } from './agents/types.js';

function orNeeds<T>(f: Field<T> | undefined): Field<T> {
  return f ?? needsInput('insufficient_sources');
}

/** Prefer a Field that actually has a value over needs_input placeholders. */
function preferFilled<T>(
  primary: Field<T> | undefined,
  fallback: Field<T> | undefined,
): Field<T> | undefined {
  if (primary && primary.value != null && primary.confidence !== 'needs_input') {
    if (Array.isArray(primary.value) && primary.value.length === 0) {
      // fall through
    } else {
      return primary;
    }
  }
  if (
    fallback &&
    fallback.value != null &&
    fallback.confidence !== 'needs_input'
  ) {
    return fallback;
  }
  return primary ?? fallback;
}

function buildMeta(
  telemetry: RunTelemetry | undefined,
  cacheHits: number,
): BriefMeta | undefined {
  if (!telemetry) return undefined;
  const latencyMs = Date.now() - telemetry.startedAt;
  return {
    requestId: telemetry.requestId,
    executionId: telemetry.requestId,
    generatedAt: new Date().toISOString(),
    provider: telemetry.provider ?? null,
    model: telemetry.model ?? null,
    orchestratorVersion: '0.2.0-evidence-wired',
    promptVersion: 'waveA-wiring',
    agentVersions: {
      Discovery: '2',
      Financials: '2',
      Footprint: '2',
      Campaign: '2',
      Competitor: '2',
      Geo: '1',
      Strategy: '2',
    },
    latencyMs,
    tokenUsage: {
      prompt: telemetry.promptTokens,
      completion: telemetry.completionTokens,
      total: telemetry.promptTokens + telemetry.completionTokens,
    },
    estimatedCost: telemetry.estimatedCostUsd,
    cacheHits,
  };
}

export function assembleCampaignBrief(input: {
  brandName: string;
  discovery?: DiscoveryResult;
  financials?: FinancialsResult;
  footprint?: FootprintResult;
  campaign?: CampaignResult;
  competitor?: CompetitorResult;
  strategy?: StrategyResult;
  telemetry?: RunTelemetry;
  cacheHits?: number;
}): CampaignBrief {
  const {
    discovery,
    financials,
    footprint,
    campaign,
    competitor,
    strategy,
    telemetry,
    cacheHits = 0,
  } = input;

  const competitorsField: CampaignBrief['competitors'] = competitor?.competitors
    ? {
        value:
          competitor.competitors.value?.map((c) => ({
            name: c.name,
            presence: c.positioning,
          })) ?? null,
        confidence: competitor.competitors.confidence,
        evidence: competitor.competitors.evidence ?? [],
        sources: competitor.competitors.sources,
        extractionMethod: competitor.competitors.extractionMethod,
      }
    : needsInput('insufficient_sources');

  const nameField = discovery?.officialName.value
    ? discovery.officialName
    : ({
        value: input.brandName,
        confidence: 'estimated' as const,
        evidence: discovery?.officialName.evidence ?? [],
        reason: 'fallback_to_input_brand',
      } satisfies Field<string>);

  const pillars = preferFilled(campaign?.pillars, strategy?.creativePillars);

  return {
    meta: buildMeta(telemetry, cacheHits),
    brand: {
      name: orNeeds(nameField),
      category: orNeeds(discovery?.category),
      hq: orNeeds(discovery?.hq),
      revenue: orNeeds(financials?.revenue),
      cagr: orNeeds(financials?.cagr),
      totalStores: orNeeds(footprint?.totalStores),
      pricePoint: orNeeds(financials?.priceRange),
      ambassador: orNeeds(campaign?.ambassador),
      activeCampaign: orNeeds(campaign?.activeCampaign),
      pillars: orNeeds(pillars),
    },
    markets: (strategy?.priorityMarkets ?? []).map((m) => ({
      name: m.name,
      priority: m.priority,
      storeCount: m.storeCount,
      clusters: m.clusters,
      highways: m.highways,
      inventory: needsInput('vendor inventory not yet loaded'),
      zeptoOverlap: m.zeptoOverlap,
      rationale: m.rationale,
      budgetAllocation: m.budgetAllocation,
      geoMarketId: m.name,
      demandScore: m.demandScore,
      demandReason: m.demandReason,
      evidence: m.evidence ?? [],
    })),
    competitors: competitorsField,
    mediaPlan: {
      sequencing: strategy?.sequencing ?? [],
      seasonalPhases: strategy?.seasonalPhases ?? [],
    },
    budget: {
      total: orNeeds(strategy?.budget.total),
      barterSavings: orNeeds(strategy?.budget.barterSavings),
      lineItems: orNeeds(strategy?.budget.lineItems),
    },
  };
}
