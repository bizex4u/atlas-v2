import type { Evidence } from '@atlas/shared';
import { hashContent } from '../evidence/ids.js';
import { normalizeUrl } from './normalize.js';

/**
 * Deduplicate evidence: same normalized URL wins once;
 * near-identical extractedText collapses to the longer document.
 */
export function dedupeEvidence(docs: Evidence[]): Evidence[] {
  const byUrl = new Map<string, Evidence>();

  for (const doc of docs) {
    const key = doc.normalizedUrl || normalizeUrl(doc.canonicalUrl) || doc.canonicalUrl;
    const existing = byUrl.get(key);
    if (!existing) {
      byUrl.set(key, doc);
      continue;
    }
    if (doc.extractedText.length > existing.extractedText.length) {
      byUrl.set(key, doc);
    }
  }

  const urlDeduped = [...byUrl.values()];
  const byContent = new Map<string, Evidence>();

  for (const doc of urlDeduped) {
    if (doc.extractedText.length < 200) {
      byContent.set(`short:${doc.id}`, doc);
      continue;
    }
    const fp = doc.contentHash || hashContent(doc.extractedText.slice(0, 4000));
    const existing = byContent.get(fp);
    if (!existing) {
      byContent.set(fp, doc);
      continue;
    }
    if (doc.extractedText.length > existing.extractedText.length) {
      byContent.set(fp, doc);
    }
  }

  return [...byContent.values()];
}

export function dedupeCandidateUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of urls) {
    const n = normalizeUrl(raw);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}
