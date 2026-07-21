import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import type { AgentName, Evidence, SseEvent } from '@atlas/shared';
import {
  CampaignAgent,
  CompetitorAgent,
  DiscoveryAgent,
  FinancialsAgent,
  FootprintAgent,
  GeoAgent,
  StrategyAgent,
} from './agents/index.js';
import type {
  AgentContext,
  DiscoveryResult,
  RunTelemetry,
} from './agents/types.js';
import { mergeDiscovery } from './agents/mergeDiscovery.js';
import { assembleCampaignBrief } from './assembleBrief.js';
import { createEvidenceStore } from './evidence/index.js';
import { retrieveEvidence } from './retrieval/index.js';
import {
  normalizeBrandInput,
  resolveCanonicalBrand,
} from './utils/brand.js';
import { hasAnyLlmProvider, probeOpenRouter } from './utils/llm.js';
import { logInfo, logWarn } from './utils/logger.js';
import { validateCampaignBrief } from './utils/validateBrief.js';

function send(res: Response, event: SseEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function detailFor(
  agent: AgentName,
  status: 'running' | 'done' | 'failed',
  data?: unknown,
): string | undefined {
  if (status === 'running') {
    const map: Record<AgentName, string> = {
      Discovery: 'Discovering brand…',
      Financials: 'Analyzing financials…',
      Footprint: 'Mapping stores…',
      Campaign: 'Scanning campaigns…',
      Competitor: 'Identifying competitors…',
      Geo: 'Computing geo clusters…',
      Strategy: 'Synthesizing strategy…',
    };
    return map[agent];
  }

  if (status === 'failed') return 'Failed — continuing with partial data';

  switch (agent) {
    case 'Discovery': {
      const d = data as DiscoveryResult;
      const name = d.officialName.value;
      const cat = d.category.value;
      if (name && cat) return `Resolved ${name} · ${cat}`;
      if (name) return `Resolved ${name}`;
      return 'Brand profile partially resolved';
    }
    case 'Financials': {
      const f = data as { revenue?: { value?: string | null } };
      if (f.revenue?.value) return `Revenue signal: ${f.revenue.value}`;
      return 'Financial signals reviewed';
    }
    case 'Footprint': {
      const f = data as {
        totalStores?: { value?: number | null };
        storesByCity?: { value?: unknown[] | null };
      };
      const total = f.totalStores?.value;
      const cities = f.storesByCity?.value?.length ?? 0;
      if (total != null) {
        return `Found ${total} stores across ${cities || '?'} cities`;
      }
      return 'Footprint partially mapped';
    }
    case 'Campaign': {
      const c = data as {
        activeCampaign?: { value?: string | null };
        ambassador?: { value?: string | null };
      };
      if (c.activeCampaign?.value) return `Campaign: ${c.activeCampaign.value}`;
      if (c.ambassador?.value) return `Ambassador: ${c.ambassador.value}`;
      return 'Campaign context reviewed';
    }
    case 'Competitor': {
      const c = data as { competitors?: { value?: unknown[] | null } };
      const n = c.competitors?.value?.length ?? 0;
      return n ? `Top ${n} competitors identified` : 'Competitor set incomplete';
    }
    case 'Geo': {
      const g = data as { markets?: unknown[] };
      return `${g.markets?.length ?? 0} market clusters computed`;
    }
    case 'Strategy': {
      const s = data as { priorityMarkets?: unknown[] };
      return `${s.priorityMarkets?.length ?? 0} priority markets synthesized`;
    }
    default:
      return undefined;
  }
}

async function runAgentSafe<T>(
  res: Response,
  signal: AbortSignal,
  agentName: AgentName,
  ctx: AgentContext,
  fn: () => Promise<T>,
): Promise<T | null> {
  if (signal.aborted) return null;
  ctx.currentAgent = agentName;
  send(res, {
    type: 'agent',
    agent: agentName,
    status: 'running',
    detail: detailFor(agentName, 'running'),
  });

  try {
    const data = await fn();
    if (signal.aborted) return null;
    send(res, {
      type: 'agent',
      agent: agentName,
      status: 'done',
      detail: detailFor(agentName, 'done', data),
      data,
    });
    return data;
  } catch (err) {
    logWarn(`${agentName} failed`, err);
    if (!signal.aborted) {
      send(res, {
        type: 'agent',
        agent: agentName,
        status: 'failed',
        detail: detailFor(agentName, 'failed'),
        data: {
          partial: true,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
    return null;
  } finally {
    ctx.currentAgent = undefined;
  }
}

function ingestEvidence(
  store: ReturnType<typeof createEvidenceStore>,
  docs: Evidence[],
  brand: string,
  telemetry: RunTelemetry,
  signal?: AbortSignal,
): number {
  let added = 0;
  for (const doc of docs) {
    if (signal?.aborted) break;
    store.add(
      {
        ...doc,
        brand: doc.brand || brand,
      },
      { signal },
    );
    added += 1;
  }
  telemetry.evidenceRetrieved += docs.length;
  telemetry.evidenceStored = store.size({ signal });
  return added;
}

/**
 * Orchestrator (evidence-wired):
 * seed retrieve → Discovery → full retrieve →
 * Parallel(Financials, Footprint, Campaign, Competitor) → Geo → Strategy
 */
export async function runResearchOrchestrator(
  brandName: string,
  res: Response,
  signal: AbortSignal,
) {
  if (!hasAnyLlmProvider()) {
    send(res, {
      type: 'error',
      message:
        'No LLM API key configured. Set OPENROUTER_API_KEY and/or GEMINI_API_KEY in the root .env and restart the backend.',
    });
    return;
  }

  const openRouterProbe = await probeOpenRouter();
  if (openRouterProbe.configured && !openRouterProbe.ok) {
    logWarn('[orchestrator] OpenRouter probe failed', openRouterProbe.error);
  }

  const normalizedInput = normalizeBrandInput(brandName);
  let canonicalBrand = normalizedInput;
  const requestId = randomUUID();
  const evidenceStore = createEvidenceStore();
  const telemetry: RunTelemetry = {
    requestId,
    startedAt: Date.now(),
    evidenceRetrieved: 0,
    evidenceStored: 0,
    evidencePassedToAgent: {},
    promptTokens: 0,
    completionTokens: 0,
    estimatedCostUsd: 0,
  };

  const agents: AgentName[] = [
    'Discovery',
    'Financials',
    'Footprint',
    'Campaign',
    'Competitor',
    'Geo',
    'Strategy',
  ];

  for (const agent of agents) {
    send(res, { type: 'agent', agent, status: 'pending' });
  }

  const discoveryAgent = new DiscoveryAgent();
  const financialsAgent = new FinancialsAgent();
  const footprintAgent = new FootprintAgent();
  const campaignAgent = new CampaignAgent();
  const competitorAgent = new CompetitorAgent();
  const geoAgent = new GeoAgent();
  const strategyAgent = new StrategyAgent();

  const ctx: AgentContext = {
    brandName: canonicalBrand,
    signal,
    evidenceStore,
    telemetry,
  };

  // Seed retrieve so Discovery has evidence (entity pages for the typed brand)
  logInfo('[orchestrator] seed retrieval', { brand: canonicalBrand, requestId });
  const seedDocs = await retrieveEvidence({
    brandName: canonicalBrand,
    intents: ['entity', 'financial', 'campaign', 'competitor', 'store'],
    maxDocuments: 10,
    signal,
  });
  ingestEvidence(evidenceStore, seedDocs, canonicalBrand, telemetry, signal);
  telemetry.evidencePassedToAgent.Retrieval = evidenceStore.size({ signal });
  logInfo('[orchestrator] seed evidence stored', {
    retrieved: seedDocs.length,
    stored: telemetry.evidenceStored,
  });

  const discovery = await runAgentSafe(res, signal, 'Discovery', ctx, () =>
    discoveryAgent.run(canonicalBrand, ctx),
  );
  if (signal.aborted) return;
  if (discovery) {
    ctx.discovery = discovery;
    canonicalBrand = resolveCanonicalBrand(
      normalizedInput,
      discovery.officialName.value,
    );
    ctx.brandName = canonicalBrand;
    logInfo(`[orchestrator] canonical brand: ${canonicalBrand}`);
  }

  // Full retrieve after Discovery resolves brand (+ website when known)
  let discoveryFinal: DiscoveryResult | null | undefined = discovery;
  if (!signal.aborted) {
    logInfo('[orchestrator] post-discovery retrieval', {
      brand: canonicalBrand,
      website: discovery?.website.value ?? null,
    });
    const fullDocs = await retrieveEvidence({
      brandName: canonicalBrand,
      website: discovery?.website.value,
      intents: ['entity', 'financial', 'campaign', 'competitor', 'store'],
      maxDocuments: 14,
      signal,
    });
    ingestEvidence(evidenceStore, fullDocs, canonicalBrand, telemetry, signal);
    logInfo('[orchestrator] full evidence stored', {
      retrievedBatch: fullDocs.length,
      storedTotal: telemetry.evidenceStored,
    });

    // Re-run Discovery with Evidence Store, then merge so empty enrichment
    // cannot wipe a usable first-pass profile. Attach store evidence IDs onto
    // retained Fields so CampaignBrief carries EvidenceReference IDs.
    if (telemetry.evidenceStored > 0) {
      const storeIds = evidenceStore.all({ signal }).map((d) => d.id);
      const enriched = await runAgentSafe(res, signal, 'Discovery', ctx, () =>
        discoveryAgent.run(canonicalBrand, ctx),
      );
      const enrichmentIds =
        enriched?.officialName.evidence?.map((e) => e.evidenceId) ??
        storeIds;
      discoveryFinal = mergeDiscovery(discovery, enriched, enrichmentIds);
      if (discoveryFinal) {
        ctx.discovery = discoveryFinal;
        canonicalBrand = resolveCanonicalBrand(
          normalizedInput,
          discoveryFinal.officialName.value,
        );
        ctx.brandName = canonicalBrand;
        logInfo('[orchestrator] discovery enriched with evidence', {
          evidenceOnName: discoveryFinal.officialName.evidence?.length ?? 0,
          website: discoveryFinal.website.value,
          storeIds: storeIds.length,
        });
      }
    }
  }

  const [financials, footprint, campaign, competitor] = await Promise.all([
    runAgentSafe(res, signal, 'Financials', ctx, () =>
      financialsAgent.run(canonicalBrand, ctx),
    ),
    runAgentSafe(res, signal, 'Footprint', ctx, () =>
      footprintAgent.run(canonicalBrand, ctx),
    ),
    runAgentSafe(res, signal, 'Campaign', ctx, () =>
      campaignAgent.run(canonicalBrand, ctx),
    ),
    runAgentSafe(res, signal, 'Competitor', ctx, () =>
      competitorAgent.run(canonicalBrand, ctx),
    ),
  ]);

  if (signal.aborted) return;
  if (financials) ctx.financials = financials;
  if (footprint) ctx.footprint = footprint;
  if (campaign) ctx.campaign = campaign;
  if (competitor) ctx.competitor = competitor;

  const geo = await runAgentSafe(res, signal, 'Geo', ctx, () =>
    geoAgent.run(canonicalBrand, ctx),
  );
  if (signal.aborted) return;
  if (geo) ctx.geo = geo;

  const strategy = await runAgentSafe(res, signal, 'Strategy', ctx, () =>
    strategyAgent.run(canonicalBrand, ctx),
  );
  if (signal.aborted) return;

  const brief = assembleCampaignBrief({
    brandName: canonicalBrand,
    discovery: discoveryFinal ?? undefined,
    financials: financials ?? undefined,
    footprint: footprint ?? undefined,
    campaign: campaign ?? undefined,
    competitor: competitor ?? undefined,
    strategy: strategy ?? undefined,
    telemetry,
    cacheHits: 0,
  });

  const evidenceReferenced = countEvidenceReferences(brief);

  logInfo('CampaignBrief assembled', {
    requestId,
    evidenceRetrieved: telemetry.evidenceRetrieved,
    evidenceStored: telemetry.evidenceStored,
    evidencePassedToAgent: telemetry.evidencePassedToAgent,
    evidenceReferenced,
    meta: brief.meta,
  });
  console.log('\n===== CampaignBrief =====\n');
  console.log(JSON.stringify(brief, null, 2));
  console.log('\n=========================\n');

  const validation = validateCampaignBrief(brief);
  if (!validation.ok) {
    logWarn('[orchestrator] brief validation failed', {
      validation,
      evidenceRetrieved: telemetry.evidenceRetrieved,
      evidenceStored: telemetry.evidenceStored,
      evidencePassedToAgent: telemetry.evidencePassedToAgent,
      evidenceReferenced,
    });
    send(res, {
      type: 'error',
      message:
        validation.reason ??
        'Research failed: CampaignBrief did not contain enough verified data.',
    });
    return;
  }

  send(res, { type: 'complete', brief });
}

function countEvidenceReferences(brief: unknown): number {
  const ids = new Set<string>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    if (Array.isArray(obj.evidence)) {
      for (const ref of obj.evidence) {
        if (
          ref &&
          typeof ref === 'object' &&
          typeof (ref as { evidenceId?: unknown }).evidenceId === 'string'
        ) {
          ids.add((ref as { evidenceId: string }).evidenceId);
        }
      }
    }
    for (const v of Object.values(obj)) walk(v);
  };
  walk(brief);
  return ids.size;
}
