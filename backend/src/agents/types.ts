import type {
  AgentName,
  Confidence,
  EvidenceReference,
  Field,
} from '@atlas/shared';
import type { EvidenceStore } from '../evidence/types.js';
import type { RunTelemetry } from './context.js';

export type AgentResultBase = {
  partial?: boolean;
  error?: string;
};

export type DiscoveryResult = AgentResultBase & {
  officialName: Field<string>;
  website: Field<string>;
  category: Field<string>;
  hq: Field<string>;
  aliases: Field<string[]>;
};

export type FinancialsResult = AgentResultBase & {
  revenue: Field<string>;
  cagr: Field<string>;
  growthTarget: Field<string>;
  priceRange: Field<string>;
};

export type StoreCity = {
  city: string;
  count: number;
  addresses: string[];
};

export type FootprintResult = AgentResultBase & {
  totalStores: Field<number>;
  storesByCity: Field<StoreCity[]>;
  confidence: Confidence;
};

export type CampaignResult = AgentResultBase & {
  activeCampaign: Field<string>;
  ambassador: Field<string>;
  tvcName: Field<string>;
  pillars: Field<string[]>;
};

export type CompetitorItem = {
  name: string;
  positioning: string;
};

export type CompetitorResult = AgentResultBase & {
  competitors: Field<CompetitorItem[]>;
};

export type GeoCluster = {
  zone: string;
  count: number;
  areas: string[];
};

export type GeoHighway = {
  city: string;
  nh: string;
  corridor: string;
  sites: string;
};

export type GeoMarket = {
  name: string;
  storeCount: number;
  clusters: GeoCluster[];
  highways: GeoHighway[];
  zeptoOverlap: number;
  /** Provenance of this market:
   *  'footprint'   = derived from real store cities.
   *  'demand'      = city where the brand shows real digital/editorial demand
   *                  signal in the retrieved evidence (news mentions, expansion,
   *                  sales) — the "advertise where interest is high" model.
   *  'hq-fallback' = estimated seed from Discovery HQ, last resort. */
  seed?: 'footprint' | 'demand' | 'hq-fallback';
  /** 0-100 demand signal for this city, from evidence-cited brand activity.
   *  A market with demandScore > 0 carries real geo signal even with 0 stores. */
  demandScore?: number;
  /** Evidence-cited reason this city is a demand market (why advertise here). */
  demandReason?: string;
};

export type GeoResult = AgentResultBase & {
  markets: GeoMarket[];
};

export type StrategyResult = AgentResultBase & {
  priorityMarkets: Array<{
    name: string;
    priority: 'P1' | 'P2' | 'P3';
    rationale: string;
    budgetAllocation: string;
    storeCount: number;
    clusters: GeoCluster[];
    highways: GeoHighway[];
    zeptoOverlap: number;
    demandScore?: number;
    demandReason?: string;
    evidence?: EvidenceReference[];
  }>;
  sequencing: Array<{
    weeks: string;
    channel: string;
    budgetShare: string;
    goal: string;
    evidence?: EvidenceReference[];
  }>;
  seasonalPhases: Array<{
    phase: string;
    window: string;
    budgetShare: string;
    actions: string[];
    evidence?: EvidenceReference[];
  }>;
  budget: {
    total: Field<string>;
    barterSavings: Field<string>;
    lineItems: Field<
      Array<{
        channel: string;
        market: string;
        listCost: string;
        postBarterCost: string;
        percentOfTotal: string;
      }>
    >;
  };
  creativePillars: Field<string[]>;
  /** Evidence IDs passed into the Strategy LLM call (for assembleBrief). */
  usedEvidenceIds?: string[];
};

export type AgentContext = {
  brandName: string;
  discovery?: DiscoveryResult;
  financials?: FinancialsResult;
  footprint?: FootprintResult;
  campaign?: CampaignResult;
  competitor?: CompetitorResult;
  geo?: GeoResult;
  signal?: AbortSignal;
  evidenceStore?: EvidenceStore;
  telemetry?: RunTelemetry;
  currentAgent?: AgentName;
};

export type { RunTelemetry, FieldOptions } from './context.js';

export {
  field,
  needsInput,
  getAgentEvidence,
  confidenceFromEvidence,
  refsFromIds,
} from './context.js';

export interface Agent<T> {
  name: AgentName;
  run(brandName: string, context: AgentContext): Promise<T>;
}
