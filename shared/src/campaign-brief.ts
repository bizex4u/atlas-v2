/**
 * CampaignBrief — provenance-first data contract for Atlas.
 *
 * Design rules:
 * - Business facts that come from retrieval → Field<T> with EvidenceReference[]
 * - Planner/reasoning outputs → may stay structured objects with optional
 *   evidence / reasoningNotes (not every nested key is Field-wrapped)
 * - BriefMeta is optional for backwards compatibility; Wave A validation will
 *   require it on new runs
 */

export type Confidence = 'verified' | 'estimated' | 'needs_input';

/**
 * Freshness label for Stage 5–7 UI and cache invalidation.
 * Free-string allowed so adapters can pass ISO ages or custom labels.
 */
export type Freshness = 'fresh' | 'aging' | 'stale' | 'unknown' | (string & {});

/**
 * How the value was produced. Free-string allowed for forward compatibility.
 */
export type ExtractionMethod =
  | 'scrape'
  | 'llm_extract'
  | 'geo'
  | 'deterministic'
  | 'manual'
  | 'retrieval'
  | 'assembler'
  | (string & {});

/**
 * Pointer into the request-scoped Evidence Store.
 * Do not embed full Evidence documents in the brief.
 */
export type EvidenceReference = {
  evidenceId: string;
  /** 0–1 relevance score when ranked against the field query */
  relevance?: number;
  /** Optional quote/snippet id for Stage 7 citation UI */
  quote?: string;
};

/**
 * Provenance-bearing value container.
 *
 * Backwards compatible: `evidence` and provenance fields are optional so
 * existing agent/assembler output still type-checks. Validation (Task 5)
 * will require evidence[] whenever value != null && confidence !== 'needs_input'.
 *
 * @deprecated Prefer `evidence` over `sources` (legacy URL list).
 */
export type Field<T> = {
  value: T | null;
  confidence: Confidence;
  /** Evidence Store ids supporting this value */
  evidence?: EvidenceReference[];
  freshness?: Freshness;
  extractionMethod?: ExtractionMethod;
  /** Planner / critic notes — never a substitute for evidence on facts */
  reasoningNotes?: string;
  /** Why value is null / needs_input */
  reason?: string;
  /**
   * @deprecated Legacy URL strings from Stage 4 agents.
   * Prefer EvidenceReference.evidenceId.
   */
  sources?: string[];
};

export type TokenUsage = {
  prompt: number;
  completion: number;
  total?: number;
};

/**
 * Execution metadata for observability and Stage 5–7 reproducibility.
 * Optional on CampaignBrief until orchestrator is wired (later Wave A tasks).
 */
export type BriefMeta = {
  requestId: string;
  /** Distinct from requestId when a request fans out to multiple runs */
  executionId?: string;
  generatedAt: string;
  provider?: string | null;
  model?: string | null;
  orchestratorVersion: string;
  promptVersion?: string;
  agentVersions?: Record<string, string>;
  latencyMs?: number;
  tokenUsage?: TokenUsage;
  /** Estimated USD cost for the run */
  estimatedCost?: number;
  cacheHits?: number;
};

export type MarketPriority = 'P1' | 'P2' | 'P3';

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

export type InventoryItem = {
  format: string;
  sites: string;
  costRange: string;
  barterEligible: boolean;
};

/**
 * Priority market row.
 *
 * Not every property is Field-wrapped:
 * - Identity / geo geometry (name, clusters, highways) stay plain — they are
 *   copied from Geo (deterministic) and cited via `evidence` / `geoMarketId`
 * - inventory is already a sourced Field (vendor data)
 * - storeCount / zeptoOverlap remain numbers for BC; optional Field mirrors
 *   can be added in a later migration without renaming keys
 */
export type Market = {
  name: string;
  priority: MarketPriority;
  storeCount: number;
  clusters: GeoCluster[];
  highways: GeoHighway[];
  inventory: Field<InventoryItem[]>;
  zeptoOverlap: number;
  rationale: string;
  budgetAllocation: string;
  /** Ties this row to a Geo market for provenance validation */
  geoMarketId?: string;
  /** 0-100 demand signal — city where evidence shows real brand demand
   *  ("advertise where interest is high"). A market with demandScore > 0 has
   *  real geo signal even when storeCount is 0. */
  demandScore?: number;
  /** Evidence-cited reason this city is a demand market. */
  demandReason?: string;
  /** Evidence supporting selection / enrichment of this market */
  evidence?: EvidenceReference[];
  freshness?: Freshness;
  reasoningNotes?: string;
};

export type CompetitorPresence = {
  name: string;
  presence: string;
};

export type SequencingItem = {
  weeks: string;
  channel: string;
  budgetShare: string;
  goal: string;
  evidence?: EvidenceReference[];
  reasoningNotes?: string;
};

export type SeasonalPhase = {
  phase: string;
  window: string;
  budgetShare: string;
  actions: string[];
  evidence?: EvidenceReference[];
  reasoningNotes?: string;
};

export type BudgetLineItem = {
  channel: string;
  market: string;
  listCost: string;
  postBarterCost: string;
  percentOfTotal: string;
};

export interface CampaignBrief {
  /** Run metadata — optional for Stage 4 BC; required by future validation */
  meta?: BriefMeta;
  brand: {
    name: Field<string>;
    category: Field<string>;
    hq: Field<string>;
    revenue: Field<string>;
    cagr: Field<string>;
    totalStores: Field<number>;
    pricePoint: Field<string>;
    ambassador: Field<string>;
    activeCampaign: Field<string>;
    pillars: Field<string[]>;
  };
  markets: Market[];
  competitors: Field<CompetitorPresence[]>;
  mediaPlan: {
    /**
     * Planner output: sequence items carry optional reasoningNotes/evidence.
     * Not wrapped as Field<T[]> so Stage 7 can edit rows independently.
     */
    sequencing: SequencingItem[];
    seasonalPhases: SeasonalPhase[];
  };
  budget: {
    total: Field<string>;
    barterSavings: Field<string>;
    lineItems: Field<BudgetLineItem[]>;
  };
}

/** Construct a needs_input field (shared helper for tests / Stage 7 stubs). */
export function emptyField<T>(reason?: string): Field<T> {
  return {
    value: null,
    confidence: 'needs_input',
    evidence: [],
    ...(reason ? { reason } : {}),
  };
}

/** Construct a populated field with provenance. */
export function provenancedField<T>(
  value: T,
  confidence: Confidence,
  evidence: EvidenceReference[],
  extra?: Partial<
    Pick<Field<T>, 'freshness' | 'extractionMethod' | 'reasoningNotes' | 'reason'>
  >,
): Field<T> {
  return {
    value,
    confidence,
    evidence,
    ...extra,
  };
}
