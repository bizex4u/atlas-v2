import type { Evidence } from '@atlas/shared';
import {
  brandRootToken,
  expandBrandAliases,
  isGeoOrLegalToken,
  normalizeBrandKey,
} from './aliases.js';

export type RelevanceRejectionReason =
  | 'accepted'
  | 'accepted_brand_site'
  | 'accepted_alias'
  | 'accepted_root_high_confidence'
  | 'accepted_fuzzy'
  | 'rejected_no_brand_signal'
  | 'rejected_ambiguous_geo_only';

export type RelevanceAssessment = {
  relevant: boolean;
  reason: RelevanceRejectionReason;
  matchedAlias?: string;
};

const HIGH_CONFIDENCE_CONTEXT = [
  'limited',
  'ltd',
  'shoes',
  'footwear',
  'retail',
  'company',
  'brand',
  'stores',
  'store',
  'india',
  'roasters',
  'coffee',
  'jewellery',
  'jewelry',
  'electronics',
  'official',
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Phrase / token presence with loose word boundaries. */
function containsPhrase(haystack: string, phrase: string): boolean {
  const p = phrase.trim().toLowerCase();
  if (!p) return false;
  if (haystack.includes(p)) return true;
  // word-boundary style for single tokens
  if (!p.includes(' ')) {
    const re = new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(p)}(?:[^a-z0-9]|$)`, 'i');
    return re.test(haystack);
  }
  return false;
}

function compactAlnum(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Alias-aware brand relevance.
 *
 * "Bata India" matches documents that mention Bata / Bata Limited / Bata Shoes
 * without requiring both "bata" and "india".
 */
export function assessBrandRelevance(
  doc: Evidence,
  brandName: string,
  aliases?: string[],
): RelevanceAssessment {
  if (doc.retrievalMethod === 'brand_site') {
    return { relevant: true, reason: 'accepted_brand_site' };
  }

  const text = `${doc.title ?? ''} ${doc.extractedText}`.toLowerCase();
  if (!text.trim()) {
    return { relevant: false, reason: 'rejected_no_brand_signal' };
  }

  const aliasList = aliases?.length ? aliases : expandBrandAliases(brandName);

  // 1) Direct alias / full-name phrase match (longest first)
  const sorted = [...aliasList].sort((a, b) => b.length - a.length);
  for (const alias of sorted) {
    if (containsPhrase(text, alias)) {
      return {
        relevant: true,
        reason: 'accepted_alias',
        matchedAlias: alias,
      };
    }
  }

  // 2) Root token + high-confidence corporate/category context
  const root = brandRootToken(brandName).toLowerCase();
  if (root.length >= 3 && containsPhrase(text, root)) {
    const hasContext = HIGH_CONFIDENCE_CONTEXT.some((c) =>
      containsPhrase(text, c),
    );
    // Also accept if title clearly features the root
    const title = (doc.title ?? '').toLowerCase();
    const titleHit = containsPhrase(title, root);
    if (hasContext || titleHit) {
      return {
        relevant: true,
        reason: 'accepted_root_high_confidence',
        matchedAlias: root,
      };
    }
  }

  // 3) Fuzzy compact match (thirdwavecoffee ↔ third wave coffee)
  const brandCompact = compactAlnum(brandName);
  const textCompact = compactAlnum(text.slice(0, 8000));
  if (brandCompact.length >= 5 && textCompact.includes(brandCompact)) {
    return { relevant: true, reason: 'accepted_fuzzy', matchedAlias: brandName };
  }
  for (const alias of aliasList) {
    const ac = compactAlnum(alias);
    if (ac.length >= 5 && textCompact.includes(ac)) {
      return { relevant: true, reason: 'accepted_fuzzy', matchedAlias: alias };
    }
  }

  // 4) Legacy multi-token: if brand has 2+ significant tokens, require primary
  //    (already failed above) — reject rather than requiring all geo tokens.
  const significant = brandName
    .split(/\s+/)
    .map((t) => t.replace(/[^a-zA-Z0-9]/g, ''))
    .filter((t) => t.length >= 3 && !isGeoOrLegalToken(t));

  if (significant.length === 0) {
    return { relevant: false, reason: 'rejected_no_brand_signal' };
  }

  // If only geo secondary tokens were missing, call that out
  const allTokens = brandName
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter(Boolean);
  const geoOnlyMiss =
    containsPhrase(text, significant[0].toLowerCase()) === false &&
    allTokens.some((t) => isGeoOrLegalToken(t) && text.includes(t));

  return {
    relevant: false,
    reason: geoOnlyMiss
      ? 'rejected_ambiguous_geo_only'
      : 'rejected_no_brand_signal',
  };
}

/** Back-compat boolean helper. */
export function isBrandRelevant(
  doc: Evidence,
  brandName: string,
  aliases?: string[],
): boolean {
  return assessBrandRelevance(doc, brandName, aliases).relevant;
}

export { normalizeBrandKey, expandBrandAliases };
