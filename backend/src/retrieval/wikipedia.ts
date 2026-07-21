import { fetchHtml } from '../utils/scrape.js';
import { logWarn } from '../utils/logger.js';
import {
  brandRootToken,
  expandBrandAliases,
  normalizeBrandKey,
} from './aliases.js';
import type { CandidateLink } from './types.js';

/**
 * Curated Wikipedia pages — prefer India / local entity pages over global parents.
 * "Bata India" must NOT map to Bata_Corporation (global Czech parent).
 */
const KNOWN_WIKI_INDIA: Record<string, string> = {
  // No dedicated "Bata India" wiki page exists — leave unset so we skip global parent
  britannia: 'https://en.wikipedia.org/wiki/Britannia_Industries',
  'britannia industries': 'https://en.wikipedia.org/wiki/Britannia_Industries',
  'third wave coffee': 'https://en.wikipedia.org/wiki/Third_Wave_Coffee',
  'blue tokai': 'https://en.wikipedia.org/wiki/Blue_Tokai',
  portronics: 'https://en.wikipedia.org/wiki/Portronics',
  // Giva jewellery has no dedicated enwiki company page (disambiguation only)
  'decathlon india': 'https://en.wikipedia.org/wiki/Decathlon_(retailer)',
};

/** Global parents we refuse for "* India" queries unless no India hit exists and caller opts in. */
const GLOBAL_PARENT_TITLE_RE =
  /\b(corporation|inc\.?|gmbh|s\.?a\.?|holdings|international|worldwide|group)\b/i;

function isIndiaQuery(brandName: string): boolean {
  return /\bindia\b/i.test(brandName.trim());
}

function indiaPreferenceScore(title: string, brandName: string): number {
  const t = title.toLowerCase();
  const brand = brandName.toLowerCase();
  let score = 0;
  if (t.includes('india')) score += 50;
  if (t.includes(brand)) score += 30;
  if (/\blimited\b|\bltd\b|\bindustries\b|\bcompany\b/.test(t)) score += 45;
  if (/\blimited\b|\bltd\b/.test(t) && isIndiaQuery(brandName)) score += 20;
  if (GLOBAL_PARENT_TITLE_RE.test(title) && isIndiaQuery(brandName)) score -= 40;
  if (t.includes('corporation') && isIndiaQuery(brandName)) score -= 60;
  // Exact bare title (e.g. "Britannia" island) — weaker than company pages
  if (t.replace(/[^a-z0-9]+/g, ' ').trim() === brand.replace(/[^a-z0-9]+/g, ' ').trim()) {
    score += 10;
  }
  // Disambiguation / geography / mythology titles are weak brand hits
  if (/\b(island|roman|mythology|disambiguation)\b/i.test(title)) score -= 80;
  return score;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strict title match — "Bata" must not match "Bataan" / "Batanda".
 * Prefer whole-word / phrase boundaries over substring includes.
 */
function titleMatchesBrand(title: string, aliases: string[]): boolean {
  const hay = title.toLowerCase();
  return aliases.some((alias) => {
    const a = alias.toLowerCase().trim();
    if (a.length < 3) return false;
    if (hay === a) return true;
    const re = new RegExp(
      `(?:^|[^a-z0-9])${escapeRegExp(a)}(?:[^a-z0-9]|$)`,
      'i',
    );
    return re.test(hay);
  });
}

async function openSearch(
  query: string,
  signal?: AbortSignal,
): Promise<Array<{ title: string; url: string }>> {
  const api = `https://en.wikipedia.org/w/api.php?action=opensearch&limit=10&namespace=0&format=json&search=${encodeURIComponent(query)}`;
  try {
    const res = await fetch(api, {
      headers: {
        'User-Agent': 'AtlasBot/0.1 (market-intelligence; +https://bizex4u.com)',
        Accept: 'application/json',
      },
      signal: signal ?? AbortSignal.timeout(12_000),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as [string, string[], string[], string[]];
    const titles = data[1] ?? [];
    const urls = data[3] ?? [];
    const out: Array<{ title: string; url: string }> = [];
    for (let i = 0; i < urls.length; i++) {
      if (urls[i] && titles[i]) out.push({ title: titles[i], url: urls[i] });
    }
    return out;
  } catch (err) {
    logWarn('[retrieval] wikipedia opensearch failed', {
      query,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Resolve Wikipedia article(s) for the brand — India entity preferred.
 * Returns ranked candidates (best first). May be empty when only a global
 * parent exists for an "* India" query (caller should rely on India press).
 */
export async function discoverWikipediaCandidates(options: {
  brandName: string;
  signal?: AbortSignal;
  /** When true, allow global parent as last resort (default false for * India). */
  allowGlobalParent?: boolean;
}): Promise<CandidateLink[]> {
  const { brandName, signal } = options;
  const allowGlobal =
    options.allowGlobalParent ?? !isIndiaQuery(brandName);
  const aliases = expandBrandAliases(brandName);
  const key = normalizeBrandKey(brandName);
  const out: CandidateLink[] = [];
  const seen = new Set<string>();

  const push = (url: string, title: string) => {
    if (seen.has(url)) return;
    seen.add(url);
    out.push({
      url,
      title,
      sourceLabel: 'Wikipedia',
      retrievalMethod: 'publisher_search',
    });
  };

  // 1) Curated India / local pages only
  const known = KNOWN_WIKI_INDIA[key];
  if (known) {
    const page = await fetchHtml(known, { signal, timeoutMs: 15_000 });
    if (page.ok && !/disambiguation|may refer to/i.test(page.html.slice(0, 8000))) {
      const title = decodeURIComponent(
        page.url.split('/wiki/')[1] ?? brandName,
      ).replace(/_/g, ' ');
      push(page.url, title);
    }
  }

  // 2) OpenSearch with India-biased queries
  const root = brandRootToken(brandName);
  const queries = [
    brandName,
    `${brandName} Limited`,
    `${root} India`,
    `${root} India Limited`,
    ...aliases.slice(0, 2),
  ];

  const ranked: Array<{ title: string; url: string; score: number }> = [];
  for (const q of queries) {
    if (signal?.aborted) break;
    const hits = await openSearch(q, signal);
    for (const hit of hits) {
      if (!titleMatchesBrand(hit.title, aliases)) continue;
      const score = indiaPreferenceScore(hit.title, brandName);
      ranked.push({ ...hit, score });
    }
  }

  ranked.sort((a, b) => b.score - a.score);

  for (const hit of ranked) {
    // Drop weak / false-friend OpenSearch hits (e.g. Bataan for Bata)
    if (hit.score < 20) continue;
    if (isIndiaQuery(brandName)) {
      // Reject global parents for India queries unless score is strongly India-flavored
      if (
        GLOBAL_PARENT_TITLE_RE.test(hit.title) &&
        !/\bindia\b/i.test(hit.title) &&
        !allowGlobal
      ) {
        continue;
      }
      if (/\bcorporation\b/i.test(hit.title) && !/\bindia\b/i.test(hit.title)) {
        continue;
      }
      // Prefer India-flavored titles; skip unrelated history / people pages
      if (!/\bindia\b|\blimited\b|\bltd\b|\bindustries\b/i.test(hit.title)) {
        // Allow exact brand match only when not a known junk pattern
        if (/death|march|battle|war|biography/i.test(hit.title)) continue;
        if (hit.score < 50) continue;
      }
    }
    // Prefer company pages over bare geographic/disambiguation titles
    // e.g. Britannia Industries > Britannia (island)
    if (
      out.some((c) => /_Industries|_Limited|_Ltd/i.test(c.url)) &&
      !/Industries|Limited|Ltd|India|Company/i.test(hit.title)
    ) {
      continue;
    }
    push(hit.url, hit.title);
    if (out.length >= 2) break;
  }

  // 3) Last resort global parent only when explicitly allowed
  if (out.length === 0 && allowGlobal && root) {
    const hits = await openSearch(root, signal);
    for (const hit of hits) {
      if (!titleMatchesBrand(hit.title, aliases)) continue;
      push(hit.url, hit.title);
      break;
    }
  }

  return out;
}

/** Back-compat: single best Wikipedia candidate (or null). */
export async function discoverWikipediaCandidate(options: {
  brandName: string;
  signal?: AbortSignal;
}): Promise<CandidateLink | null> {
  const list = await discoverWikipediaCandidates(options);
  return list[0] ?? null;
}
