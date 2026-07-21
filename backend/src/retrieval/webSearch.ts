import { fetchHtml } from '../utils/scrape.js';
import { logInfo, logWarn } from '../utils/logger.js';
import { expandBrandAliases, brandRootToken } from './aliases.js';
import { normalizeUrl } from './normalize.js';
import type { CandidateLink } from './types.js';

/** Indian trade / business press hosts we accept from web search. */
export const INDIA_PUBLISHER_HOSTS = [
  'mediabrief.com',
  'exchange4media.com',
  'afaqs.com',
  'medianews4u.com',
  'moneycontrol.com',
  'economictimes.indiatimes.com',
  'business-standard.com',
  'livemint.com',
  'financialexpress.com',
  'hindustantimes.com',
  'indianexpress.com',
  'businesstoday.in',
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function isAllowedPublisher(url: string): boolean {
  const host = hostOf(url);
  return INDIA_PUBLISHER_HOSTS.some(
    (h) => host === h || host.endsWith(`.${h}`),
  );
}

function mentionsBrand(url: string, title: string | null, aliases: string[]): boolean {
  const hay = `${title ?? ''} ${url}`.toLowerCase();
  return aliases.some((a) => {
    const t = a.toLowerCase().trim();
    return t.length >= 3 && hay.includes(t);
  });
}

function extractDdgUrls(html: string): Array<{ url: string; title: string | null }> {
  const out: Array<{ url: string; title: string | null }> = [];
  const seen = new Set<string>();

  // DuckDuckGo HTML wraps destinations in uddg=
  for (const m of html.matchAll(/uddg=([^&"]+)/gi)) {
    try {
      const url = decodeURIComponent(m[1]);
      if (!/^https?:/i.test(url) || seen.has(url)) continue;
      seen.add(url);
      out.push({ url, title: null });
    } catch {
      // skip
    }
  }

  // Fallback: plain absolute links
  for (const m of html.matchAll(/href="(https?:\/\/[^"]+)"/gi)) {
    const url = m[1];
    if (/duckduckgo\.com/i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title: null });
  }

  return out;
}

/**
 * Discover India-trade-press article URLs via DuckDuckGo HTML (no API key).
 * Publisher on-site search pages are often JS/robots-blocked; DDG surfaces real articles.
 */
export async function discoverPublisherViaWebSearch(options: {
  brandName: string;
  maxCandidates?: number;
  signal?: AbortSignal;
}): Promise<CandidateLink[]> {
  const { brandName, signal } = options;
  const maxCandidates = options.maxCandidates ?? 16;
  const aliases = expandBrandAliases(brandName);
  const root = brandRootToken(brandName);

  const queries = [
    `"${brandName}" India`,
    `"${brandName}" footwear OR retail OR campaign OR stores`,
    `site:mediabrief.com "${brandName}"`,
    `site:exchange4media.com "${brandName}"`,
    `site:afaqs.com "${root}"`,
    `"${brandName}" site:moneycontrol.com`,
  ];

  const found: CandidateLink[] = [];
  const seen = new Set<string>();

  for (const q of queries) {
    if (signal?.aborted || found.length >= maxCandidates) break;
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const page = await fetchHtml(searchUrl, { signal, timeoutMs: 12_000 });
    if (!page.ok) {
      logWarn('[retrieval] web search failed', { query: q, reason: page.reason });
      continue;
    }

    // DuckDuckGo often serves an anomaly/bot challenge instead of results
    if (
      /anomaly-modal|bots use DuckDuckGo|challenge-form/i.test(page.html)
    ) {
      logWarn('[retrieval] web search bot-challenged — skipping DDG', {
        query: q,
      });
      break;
    }

    for (const hit of extractDdgUrls(page.html)) {
      if (found.length >= maxCandidates) break;
      const norm = normalizeUrl(hit.url) ?? hit.url;
      if (seen.has(norm)) continue;
      if (!isAllowedPublisher(norm)) continue;
      if (!mentionsBrand(norm, hit.title, aliases)) continue;
      seen.add(norm);
      found.push({
        url: norm,
        title: hit.title,
        sourceLabel: hostOf(norm) || 'web_search',
        retrievalMethod: 'publisher_search',
      });
    }
  }

  logInfo('[retrieval] web search candidates', {
    brand: brandName,
    count: found.length,
    sample: found.slice(0, 5).map((c) => c.url),
  });

  return found;
}
