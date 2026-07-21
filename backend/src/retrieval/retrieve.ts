import type { Evidence } from '@atlas/shared';
import { logInfo, logWarn } from '../utils/logger.js';
import { expandBrandAliases } from './aliases.js';
import { dedupeEvidence } from './dedupe.js';
import { fetchEvidenceDocuments } from './fetchEvidence.js';
import { assessBrandRelevance } from './relevance.js';
import { resolveBrandWebsite } from './resolveWebsite.js';
import { brandSiteCandidates, discoverCandidateLinks } from './search.js';
import type { CandidateLink, EvidenceQueryIntent, RetrieveOptions } from './types.js';
import { discoverWikipediaCandidate } from './wikipedia.js';

const DEFAULT_INTENTS: EvidenceQueryIntent[] = [
  'entity',
  'financial',
  'campaign',
  'competitor',
  'store',
];

export type RetrievalTelemetry = {
  brand: string;
  aliases: string[];
  website: {
    candidateDomains: string[];
    domainsAttempted: string[];
    domainsResolved: string[];
    selected: string | null;
    reasonSelected: string;
  };
  publisher: {
    candidates: number;
    fetched: number;
    accepted: number;
    rejected: Array<{ url: string; reason: string }>;
  };
  brandSitePages: number;
  documents: number;
  latencyMs: number;
};

/**
 * Retrieval Layer entry point.
 *
 * Discovers candidate article URLs from publisher search pages and brand site,
 * fetches article bodies, normalizes + deduplicates, returns Evidence[].
 *
 * Downstream agents must not web-search — they consume these documents
 * (via Evidence Store in Task 2).
 */
export async function retrieveEvidence(
  options: RetrieveOptions,
): Promise<Evidence[]> {
  const {
    brandName,
    website,
    signal,
    maxDocuments = 12,
    intents = DEFAULT_INTENTS,
  } = options;

  if (!brandName.trim()) return [];
  if (signal?.aborted) return [];

  const started = Date.now();
  const brand = brandName.trim();
  const aliases = expandBrandAliases(brand);

  const publisherLinksRaw = await discoverCandidateLinks({
    brandName: brand,
    intents,
    maxCandidates: Math.max(maxDocuments * 4, 24),
    signal,
  });

  // Prefer publisher URLs/titles that already mention the brand / aliases
  const publisherLinks = prioritizeBrandMentionLinks(
    publisherLinksRaw,
    aliases,
  );

  const wiki = await discoverWikipediaCandidate({ brandName: brand, signal });
  const wikiLinks: CandidateLink[] = wiki ? [wiki] : [];

  // Multi-stage official website resolution (replaces guessBrandWebsites)
  const resolved = await resolveBrandWebsite({
    brandName: brand,
    discoveryWebsite: website,
    signal,
  });

  const siteLinks =
    resolved.website != null
      ? await brandSiteCandidates(resolved.website, signal)
      : [];

  const candidates = [...siteLinks, ...wikiLinks, ...publisherLinks];

  logInfo('[retrieval] candidates discovered', {
    brand,
    aliases: aliases.slice(0, 8),
    publisher: publisherLinks.length,
    brandSite: siteLinks.length,
    websiteSelected: resolved.website,
    websiteReason: resolved.reason,
    candidateDomains: resolved.telemetry.candidateDomains.slice(0, 12),
    domainsAttempted: resolved.telemetry.domainsAttempted.length,
    domainsResolved: resolved.telemetry.domainsResolved,
  });

  const fetched = await fetchEvidenceDocuments(candidates, {
    maxDocuments: Math.max(maxDocuments * 2, maxDocuments + 4),
    signal,
    brand,
  });

  const rejected: Array<{ url: string; reason: string }> = [];
  const relevant: Evidence[] = [];
  for (const doc of fetched) {
    const assessment = assessBrandRelevance(doc, brand, aliases);
    if (assessment.relevant) {
      relevant.push(doc);
    } else {
      rejected.push({
        url: doc.canonicalUrl,
        reason: assessment.reason,
      });
    }
  }

  const evidence = dedupeEvidence(relevant).slice(0, maxDocuments);

  const telemetry: RetrievalTelemetry = {
    brand,
    aliases,
    website: {
      candidateDomains: resolved.telemetry.candidateDomains,
      domainsAttempted: resolved.telemetry.domainsAttempted,
      domainsResolved: resolved.telemetry.domainsResolved,
      selected: resolved.website,
      reasonSelected: resolved.reason,
    },
    publisher: {
      candidates: publisherLinks.length,
      fetched: fetched.length,
      accepted: relevant.length,
      rejected: rejected.slice(0, 40),
    },
    brandSitePages: siteLinks.length,
    documents: evidence.length,
    latencyMs: Date.now() - started,
  };

  logInfo('[retrieval] complete', {
    brand: telemetry.brand,
    fetched: fetched.length,
    relevant: relevant.length,
    documents: evidence.length,
    latencyMs: telemetry.latencyMs,
    websiteSelected: telemetry.website.selected,
    websiteReason: telemetry.website.reasonSelected,
    publisherRejected: rejected.length,
    rejectionReasons: summarizeReasons(rejected.map((r) => r.reason)),
  });

  if (rejected.length) {
    logInfo('[retrieval] publisher rejections', {
      brand,
      sample: rejected.slice(0, 8),
    });
  }

  if (evidence.length === 0) {
    logWarn('[retrieval] no evidence documents retrieved', {
      brand,
      websiteReason: resolved.reason,
      publisherFetched: fetched.length,
      publisherRejected: rejected.length,
    });
  }

  return evidence;
}

function summarizeReasons(reasons: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of reasons) {
    counts[r] = (counts[r] ?? 0) + 1;
  }
  return counts;
}

/** Rank links whose URL/title mention an alias ahead of generic SERP noise. */
function prioritizeBrandMentionLinks(
  links: CandidateLink[],
  aliases: string[],
): CandidateLink[] {
  const lowered = aliases.map((a) => a.toLowerCase());
  const score = (link: CandidateLink): number => {
    const hay = `${link.title ?? ''} ${link.url}`.toLowerCase();
    let s = 0;
    for (const a of lowered) {
      if (a.length >= 3 && hay.includes(a)) s += a.includes(' ') ? 3 : 2;
    }
    return s;
  };
  return [...links].sort((a, b) => score(b) - score(a));
}
