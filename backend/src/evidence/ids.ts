import { createHash } from 'node:crypto';
import type { Evidence } from '@atlas/shared';

/** Stable evidence id derived from canonical URL — same article → same id. */
export function stableEvidenceId(canonicalUrl: string): string {
  return createHash('sha256').update(canonicalUrl).digest('hex').slice(0, 24);
}

/** Content fingerprint for near-duplicate detection. */
export function hashContent(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim().toLowerCase();
  return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Prefer the richer document when merging duplicates.
 * Higher score wins; ties keep `existing`.
 */
export function evidenceQualityScore(doc: Evidence): number {
  let score = 0;
  score += Math.min(doc.extractedText.length, 80_000);
  score += Math.min(Math.floor(doc.rawContent.length / 20), 10_000);
  if (doc.title) score += 2_000;
  if (doc.publishedAt) score += 1_000;
  if (doc.language) score += 200;
  if (doc.retrievalMethod === 'brand_site') score += 300;
  return score;
}

export function preferEvidence(a: Evidence, b: Evidence): Evidence {
  return evidenceQualityScore(b) > evidenceQualityScore(a) ? b : a;
}
