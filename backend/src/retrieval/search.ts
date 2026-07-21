import { NEWS_SOURCES, fetchHtml } from '../utils/scrape.js';
import { logWarn } from '../utils/logger.js';
import { extractArticleLinksFromHtml } from './parse.js';
import { dedupeCandidateUrls } from './dedupe.js';
import { normalizeUrl } from './normalize.js';
import type { CandidateLink, EvidenceQueryIntent } from './types.js';

function queriesForIntent(
  brandName: string,
  intent: EvidenceQueryIntent,
): string[] {
  switch (intent) {
    case 'financial':
      return [
        `${brandName} revenue`,
        `${brandName} annual report`,
        `${brandName} financial results`,
      ];
    case 'campaign':
      return [
        `${brandName} campaign`,
        `${brandName} brand ambassador`,
        `${brandName} advertising`,
      ];
    case 'competitor':
      return [`${brandName} competitors`, `${brandName} vs`];
    case 'store':
      return [`${brandName} store count`, `${brandName} retail stores`];
    case 'entity':
      return [`${brandName} company`, `${brandName} about`];
    default:
      return [brandName];
  }
}

/**
 * Discover article candidate URLs from publisher search/topic pages.
 * Returns links only — never treats SERP HTML as article content.
 */
export async function discoverCandidateLinks(options: {
  brandName: string;
  intents: EvidenceQueryIntent[];
  maxCandidates?: number;
  signal?: AbortSignal;
}): Promise<CandidateLink[]> {
  const { brandName, intents, signal } = options;
  const maxCandidates = options.maxCandidates ?? 24;
  const candidates: CandidateLink[] = [];

  for (const intent of intents) {
    if (signal?.aborted) break;
    const queries = queriesForIntent(brandName, intent);

    for (const query of queries.slice(0, 2)) {
      if (signal?.aborted) break;

      for (const source of NEWS_SOURCES) {
        if (signal?.aborted) break;
        if (candidates.length >= maxCandidates) break;

        const searchUrl = source.searchUrl(query);
        const page = await fetchHtml(searchUrl, { signal });
        if (!page.ok) {
          logWarn('[retrieval] search page fetch failed', {
            source: source.name,
            reason: page.reason,
          });
          continue;
        }

        const links = extractArticleLinksFromHtml(
          page.html,
          page.url,
          source.name,
        );
        for (const link of links) {
          candidates.push(link);
          if (candidates.length >= maxCandidates) break;
        }
      }
    }
  }

  // Dedupe by normalized URL while preserving first title/source
  const byUrl = new Map<string, CandidateLink>();
  for (const c of candidates) {
    const key = normalizeUrl(c.url) ?? c.url;
    if (!byUrl.has(key)) byUrl.set(key, { ...c, url: key });
  }

  const unique = [...byUrl.values()];
  const urls = dedupeCandidateUrls(unique.map((c) => c.url));
  return urls
    .map((url) => unique.find((c) => c.url === url)!)
    .filter(Boolean)
    .slice(0, maxCandidates);
}

export async function brandSiteCandidates(
  website: string,
  signal?: AbortSignal,
  options?: { optimistic?: boolean },
): Promise<CandidateLink[]> {
  let base = website.startsWith('http') ? website : `https://${website}`;
  const optimistic = options?.optimistic ?? true;

  // Resolve redirects (e.g. bata.in → bata.com/in/) with a longer timeout
  const home = await fetchHtml(base, { signal, timeoutMs: 18_000 });
  let resolved = false;
  if (home.ok) {
    base = home.url;
    resolved = true;
  } else {
    // Common regional redirects when apex times out / 301s empty
    try {
      const host = new URL(base).hostname.replace(/^www\./, '');
      const alts = [
        host.endsWith('.in') && !host.endsWith('.co.in')
          ? `https://www.${host.replace(/\.in$/, '.com')}/in/`
          : null,
        host.includes('bata') ? 'https://www.bata.com/in/' : null,
        `https://www.${host}/`,
      ].filter(Boolean) as string[];
      for (const alt of alts) {
        if (alt === base) continue;
        const altHome = await fetchHtml(alt, { signal, timeoutMs: 18_000 });
        if (altHome.ok) {
          base = altHome.url;
          resolved = true;
          break;
        }
      }
    } catch {
      // keep original base
    }
  }

  // When homepage (+ regional alts) all fail, skip path crawl — dead hosts
  // (e.g. bata.com bot timeouts) burn the fetch budget before India press seeds.
  if (!resolved) {
    if (!optimistic) return [];
    logWarn('[retrieval] brand site unreachable — skipping path crawl', {
      website,
    });
    return [];
  }

  let origin: string;
  let pathPrefix = '';
  try {
    const u = new URL(base);
    origin = u.origin;
    // Preserve /in/ storefront prefix (bata.com/in/)
    if (/^\/in\/?/i.test(u.pathname)) pathPrefix = '/in';
  } catch {
    return [];
  }

  const paths = [
    '/',
    '/about',
    '/about-us',
    '/about-us.html',
    '/company',
    '/investors',
    '/investor-relations',
    '/press',
    '/media',
    '/news',
    '/store-locator',
    '/stores',
    '/campaigns',
  ];
  const out: CandidateLink[] = [];
  for (const path of paths) {
    try {
      const fullPath = pathPrefix && path === '/' ? `${pathPrefix}/` : `${pathPrefix}${path}`;
      const url = normalizeUrl(new URL(fullPath, origin + '/').toString());
      if (!url) continue;
      out.push({
        url,
        title: null,
        sourceLabel: 'brand_site',
        retrievalMethod: 'brand_site',
      });
    } catch {
      // skip
    }
  }
  return out;
}
