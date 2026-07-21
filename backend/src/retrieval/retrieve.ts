import type { Evidence } from '@atlas/shared';
import { logInfo, logWarn } from '../utils/logger.js';
import { expandBrandAliases } from './aliases.js';
import { dedupeEvidence } from './dedupe.js';
import { fetchEvidenceDocuments } from './fetchEvidence.js';
import { assessBrandRelevance } from './relevance.js';
import { resolveBrandWebsite } from './resolveWebsite.js';
import { brandSiteCandidates, discoverCandidateLinks } from './search.js';
import type {
  CandidateLink,
  EvidenceQueryIntent,
  RetrieveOptions,
} from './types.js';
import {
  indiaPressSeedCandidates,
  indiaTopicListingCandidates,
} from './indiaPressSeeds.js';
import { extractArticleLinksFromHtml } from './parse.js';
import { fetchHtml } from '../utils/scrape.js';
import { discoverPublisherViaWebSearch } from './webSearch.js';
import { discoverWikipediaCandidates } from './wikipedia.js';

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

  // 1) Curated India press / company pages (highest precision)
  const seedLinks = indiaPressSeedCandidates(brand);

  // 2) Topic listings → article links (ET topic pages work when DDG is blocked)
  const topicArticleLinks = await discoverTopicArticles(brand, signal);

  // 3) On-site publisher SERP — skip/limit when seeds already cover the brand
  //    (on-site search is slow, often robots-blocked, and fills with homepage noise)
  const haveStrongSeeds = seedLinks.length + topicArticleLinks.length >= 5;
  const publisherLinksRaw = haveStrongSeeds
    ? []
    : await discoverCandidateLinks({
        brandName: brand,
        intents,
        maxCandidates: Math.max(maxDocuments * 2, 12),
        signal,
      });

  // 4) DuckDuckGo → India trade press (best-effort; often bot-challenged)
  const webSearchLinks = haveStrongSeeds
    ? []
    : await discoverPublisherViaWebSearch({
        brandName: brand,
        maxCandidates: 12,
        signal,
      });

  const publisherLinks = prioritizeBrandMentionLinks(
    [...topicArticleLinks, ...webSearchLinks, ...publisherLinksRaw],
    aliases,
  ).filter((l) => brandMentionScore(l, aliases) > 0);

  // 5) Wikipedia — India entity preferred; may be empty for "Bata India"
  const wikiLinks = await discoverWikipediaCandidates({
    brandName: brand,
    signal,
  });

  // 6) Official India website (only when homepage reachable)
  const resolved = await resolveBrandWebsite({
    brandName: brand,
    discoveryWebsite: website,
    signal,
  });

  const siteLinks =
    resolved.website != null
      ? await brandSiteCandidates(resolved.website, signal, {
          optimistic: true,
        })
      : [];

  // Seeds first so fetch budget isn't burned on dead brand-site paths
  const candidates = [
    ...seedLinks,
    ...wikiLinks,
    ...publisherLinks,
    ...siteLinks,
  ];

  logInfo('[retrieval] candidates discovered', {
    brand,
    aliases: aliases.slice(0, 8),
    indiaPressSeeds: seedLinks.length,
    topicArticles: topicArticleLinks.length,
    publisherOnSite: publisherLinksRaw.length,
    publisherWebSearch: webSearchLinks.length,
    publisherBrandMention: publisherLinks.length,
    wikipedia: wikiLinks.length,
    brandSite: siteLinks.length,
    websiteSelected: resolved.website,
    websiteReason: resolved.reason,
    wikiTitles: wikiLinks.map((w) => w.title),
  });

  const fetched = await fetchEvidenceDocuments(candidates, {
    maxDocuments: Math.max(maxDocuments * 2, maxDocuments + 6),
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

  logInfo('[retrieval] complete', {
    brand,
    fetched: fetched.length,
    relevant: relevant.length,
    documents: evidence.length,
    latencyMs: Date.now() - started,
    websiteSelected: resolved.website,
    websiteReason: resolved.reason,
    publisherRejected: rejected.length,
    rejectionReasons: summarizeReasons(rejected.map((r) => r.reason)),
    sampleUrls: evidence.slice(0, 8).map((d) => d.canonicalUrl),
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

/** Crawl ET/topic listing pages and keep only brand-mentioning article URLs. */
async function discoverTopicArticles(
  brandName: string,
  signal?: AbortSignal,
): Promise<CandidateLink[]> {
  const aliases = expandBrandAliases(brandName);
  const listings = indiaTopicListingCandidates(brandName);
  const found: CandidateLink[] = [];
  const seen = new Set<string>();

  for (const listing of listings.slice(0, 2)) {
    if (signal?.aborted || found.length >= 10) break;
    const page = await fetchHtml(listing.url, { signal, timeoutMs: 15_000 });
    if (!page.ok) continue;
    const links = extractArticleLinksFromHtml(
      page.html,
      page.url,
      'topic_listing',
    );
    for (const link of links) {
      if (found.length >= 10) break;
      if (seen.has(link.url)) continue;
      if (brandMentionScore(link, aliases) <= 0) continue;
      seen.add(link.url);
      found.push(link);
    }
  }

  return found;
}

function summarizeReasons(reasons: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of reasons) {
    counts[r] = (counts[r] ?? 0) + 1;
  }
  return counts;
}

function brandMentionScore(link: CandidateLink, aliases: string[]): number {
  const lowered = aliases.map((a) => a.toLowerCase());
  const hay = `${link.title ?? ''} ${link.url}`.toLowerCase();
  let s = 0;
  for (const a of lowered) {
    if (a.length >= 3 && hay.includes(a)) s += a.includes(' ') ? 3 : 2;
  }
  return s;
}

/** Rank links whose URL/title mention an alias ahead of generic SERP noise. */
function prioritizeBrandMentionLinks(
  links: CandidateLink[],
  aliases: string[],
): CandidateLink[] {
  const seen = new Set<string>();
  const unique: CandidateLink[] = [];
  for (const link of links) {
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    unique.push(link);
  }
  return unique.sort(
    (a, b) => brandMentionScore(b, aliases) - brandMentionScore(a, aliases),
  );
}
