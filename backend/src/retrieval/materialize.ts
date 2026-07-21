import type { Evidence } from '@atlas/shared';
import { hashContent, stableEvidenceId } from '../evidence/ids.js';
import { domainOf, normalizeUrl } from './normalize.js';
import { extractArticleMeta, extractArticleText } from './parse.js';
import type { CandidateLink } from './types.js';

export const MIN_ARTICLE_CHARS = 280;
/** Brand marketing sites are often sparse; still useful as entity evidence. */
export const MIN_BRAND_SITE_CHARS = 120;

/**
 * Pure evidence construction from already-fetched HTML.
 * Used by the fetch path and unit tests — no network I/O.
 */
export function materializeEvidence(input: {
  html: string;
  finalUrl: string;
  candidate: CandidateLink;
  brand: string;
  retrievedAt?: string;
}): Evidence | null {
  const canonicalUrl = normalizeUrl(input.finalUrl) ?? input.finalUrl;
  const normalizedUrl = normalizeUrl(canonicalUrl) ?? canonicalUrl;
  const meta = extractArticleMeta(input.html);
  let extractedText = extractArticleText(input.html);

  // SPA / sparse brand sites: fold meta description into body evidence
  if (
    input.candidate.retrievalMethod === 'brand_site' &&
    extractedText.length < MIN_BRAND_SITE_CHARS
  ) {
    const desc = meta.description?.trim();
    const title = meta.title?.trim();
    const extras = [title, desc].filter(Boolean).join('. ');
    if (extras) {
      extractedText = `${extras} ${extractedText}`.replace(/\s+/g, ' ').trim();
    }
  }

  const minChars =
    input.candidate.retrievalMethod === 'brand_site'
      ? MIN_BRAND_SITE_CHARS
      : MIN_ARTICLE_CHARS;

  if (extractedText.length < minChars) {
    return null;
  }

  return {
    id: stableEvidenceId(canonicalUrl),
    canonicalUrl,
    normalizedUrl,
    title: meta.title ?? input.candidate.title,
    domain: domainOf(canonicalUrl),
    publishedAt: meta.publishedAt,
    retrievedAt: input.retrievedAt ?? new Date().toISOString(),
    retrievalMethod: input.candidate.retrievalMethod,
    language: meta.language,
    brand: input.brand.trim(),
    contentHash: hashContent(extractedText),
    rawContent: input.html.slice(0, 250_000),
    extractedText,
    metadata: {
      sourceLabel: input.candidate.sourceLabel,
    },
  };
}
