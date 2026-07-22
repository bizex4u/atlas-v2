import type { CampaignBrief, Field } from '@atlas/shared';

type FieldLike = Field<unknown> | null | undefined;

function isNeedsInput(field: FieldLike): boolean {
  return !field || field.value === null || field.confidence === 'needs_input';
}

function isFilled(field: FieldLike): boolean {
  if (!field) return false;
  if (field.value === null || field.value === undefined) return false;
  if (Array.isArray(field.value) && field.value.length === 0) return false;
  if (typeof field.value === 'string' && !field.value.trim()) return false;
  return field.confidence !== 'needs_input';
}

export type BriefValidation = {
  ok: boolean;
  filled: number;
  total: number;
  needsInputRatio: number;
  reason?: string;
};

/**
 * Reject near-empty briefs so the UI does not treat LLM failure as success.
 * Fails when ≥90% of scored fields are needs_input / empty, or core sections blank.
 */
export function validateCampaignBrief(brief: CampaignBrief): BriefValidation {
  const scored: FieldLike[] = [
    brief.brand.name,
    brief.brand.category,
    brief.brand.hq,
    brief.brand.revenue,
    brief.brand.cagr,
    brief.brand.totalStores,
    brief.brand.pricePoint,
    brief.brand.ambassador,
    brief.brand.activeCampaign,
    brief.brand.pillars,
    brief.competitors,
    brief.budget.total,
    brief.budget.barterSavings,
    brief.budget.lineItems,
  ];

  const total = scored.length;
  const filled = scored.filter(isFilled).length;
  const needs = scored.filter(isNeedsInput).length;
  const needsInputRatio = total === 0 ? 1 : needs / total;

  const onlyName =
    isFilled(brief.brand.name) &&
    filled <= 1 &&
    brief.markets.length === 0 &&
    !isFilled(brief.competitors) &&
    brief.mediaPlan.sequencing.length === 0;

  if (onlyName) {
    return {
      ok: false,
      filled,
      total,
      needsInputRatio,
      reason:
        'CampaignBrief is nearly empty (only brand name). LLM providers failed to extract research data — check OPENROUTER_API_KEY / Gemini quota.',
    };
  }

  if (needsInputRatio >= 0.9) {
    return {
      ok: false,
      filled,
      total,
      needsInputRatio,
      reason: `CampaignBrief failed validation: ${Math.round(needsInputRatio * 100)}% of fields are needs_input (${filled}/${total} filled).`,
    };
  }

  if (
    brief.markets.length === 0 &&
    !isFilled(brief.competitors) &&
    brief.mediaPlan.sequencing.length === 0
  ) {
    return {
      ok: false,
      filled,
      total,
      needsInputRatio,
      reason:
        'CampaignBrief missing markets, competitors, and media plan — research pipeline did not produce usable intelligence.',
    };
  }

  // Provenance gate (defense-in-depth behind the Strategy allowedMarkets
  // filter): a market must carry REAL geo signal — either store footprint
  // (stores/clusters) OR evidence-cited demand (demandScore > 0, the
  // "advertise where interest is high" model). Reject only if EVERY market
  // has neither — that's an HQ-seed-only or invented set with nothing to
  // ground a plan on. A demand-signal market is legitimate geo intelligence.
  if (
    brief.markets.length > 0 &&
    brief.markets.every(
      (m) =>
        (m.storeCount ?? 0) === 0 &&
        (m.clusters?.length ?? 0) === 0 &&
        (m.demandScore ?? 0) === 0,
    )
  ) {
    return {
      ok: false,
      filled,
      total,
      needsInputRatio,
      reason:
        'No priority market has store, cluster, or demand signal — no verified geo intelligence to ground the plan.',
    };
  }

  return { ok: true, filled, total, needsInputRatio };
}
