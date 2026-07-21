import type { Evidence } from '@atlas/shared';
import { fetchHtml } from '../utils/scrape.js';
import { logWarn } from '../utils/logger.js';
import { materializeEvidence, MIN_ARTICLE_CHARS } from './materialize.js';
import type { CandidateLink } from './types.js';

/**
 * Fetch a candidate URL and materialize a structured Evidence document.
 * Skips pages that look empty or are still search listings.
 */
export async function fetchEvidenceDocument(
  candidate: CandidateLink,
  options?: { signal?: AbortSignal; brand?: string },
): Promise<Evidence | null> {
  const signal = options?.signal;
  const brand = options?.brand ?? '';
  if (signal?.aborted) return null;

  const page = await fetchHtml(candidate.url, { signal });
  if (!page.ok) {
    logWarn('[retrieval] article fetch failed', {
      url: candidate.url,
      reason: page.reason,
    });
    return null;
  }

  const doc = materializeEvidence({
    html: page.html,
    finalUrl: page.url,
    candidate,
    brand,
  });

  if (!doc) {
    logWarn('[retrieval] article text too short — skipped', {
      url: page.url,
      minChars:
        candidate.retrievalMethod === 'brand_site'
          ? 120
          : MIN_ARTICLE_CHARS,
      method: candidate.retrievalMethod,
    });
  }

  return doc;
}

export async function fetchEvidenceDocuments(
  candidates: CandidateLink[],
  options: {
    maxDocuments: number;
    signal?: AbortSignal;
    brand?: string;
  },
): Promise<Evidence[]> {
  const docs: Evidence[] = [];
  let consecutivePublisherFailures = 0;

  for (const candidate of candidates) {
    if (options.signal?.aborted) break;
    if (docs.length >= options.maxDocuments) break;

    // Skip further publisher pages after a streak of failures; always keep
    // trying brand_site candidates (different domains/paths).
    if (
      consecutivePublisherFailures >= 4 &&
      candidate.retrievalMethod !== 'brand_site'
    ) {
      continue;
    }

    const doc = await fetchEvidenceDocument(candidate, {
      signal: options.signal,
      brand: options.brand,
    });
    if (doc) {
      docs.push(doc);
      if (candidate.retrievalMethod !== 'brand_site') {
        consecutivePublisherFailures = 0;
      }
    } else if (candidate.retrievalMethod !== 'brand_site') {
      consecutivePublisherFailures += 1;
    }
  }

  return docs;
}
