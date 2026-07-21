import type { Field } from '@atlas/shared';
import { field, needsInput, type DiscoveryResult } from './types.js';

function hasValue<T>(f: Field<T> | undefined): boolean {
  if (!f || f.value == null || f.confidence === 'needs_input') return false;
  if (Array.isArray(f.value) && f.value.length === 0) return false;
  if (typeof f.value === 'string' && !f.value.trim()) return false;
  return true;
}

/**
 * Prefer evidence-backed enrichment when it has a value; otherwise keep the
 * prior Discovery Field and attach EvidenceReference IDs from the enrichment call.
 */
function pickField<T>(
  prior: Field<T> | undefined,
  enriched: Field<T> | undefined,
  enrichmentEvidenceIds: string[],
): Field<T> {
  if (hasValue(enriched)) return enriched!;
  if (hasValue(prior)) {
    const p = prior!;
    if ((p.evidence?.length ?? 0) > 0 || enrichmentEvidenceIds.length === 0) {
      return p;
    }
    return field(p.value, p.confidence === 'verified' ? 'verified' : 'estimated', {
      evidenceIds: enrichmentEvidenceIds,
      sources: p.sources,
      extractionMethod: p.extractionMethod ?? 'llm_extract',
      reasoningNotes:
        p.reasoningNotes ??
        'Value retained from pre-evidence Discovery; cited against post-retrieve evidence context.',
    });
  }
  return enriched ?? prior ?? needsInput('insufficient_sources');
}

export function mergeDiscovery(
  prior: DiscoveryResult | null | undefined,
  enriched: DiscoveryResult | null | undefined,
  enrichmentEvidenceIds: string[] = [],
): DiscoveryResult | undefined {
  if (!prior && !enriched) return undefined;
  if (!prior) return enriched ?? undefined;
  if (!enriched) {
    if (enrichmentEvidenceIds.length === 0) return prior;
    return {
      ...prior,
      officialName: pickField(prior.officialName, undefined, enrichmentEvidenceIds),
      website: pickField(prior.website, undefined, enrichmentEvidenceIds),
      category: pickField(prior.category, undefined, enrichmentEvidenceIds),
      hq: pickField(prior.hq, undefined, enrichmentEvidenceIds),
      aliases: pickField(prior.aliases, undefined, enrichmentEvidenceIds),
    };
  }

  return {
    partial: Boolean(prior.partial || enriched.partial),
    error: enriched.error ?? prior.error,
    officialName: pickField(
      prior.officialName,
      enriched.officialName,
      enrichmentEvidenceIds,
    ),
    website: pickField(prior.website, enriched.website, enrichmentEvidenceIds),
    category: pickField(prior.category, enriched.category, enrichmentEvidenceIds),
    hq: pickField(prior.hq, enriched.hq, enrichmentEvidenceIds),
    aliases: pickField(prior.aliases, enriched.aliases, enrichmentEvidenceIds),
  };
}
