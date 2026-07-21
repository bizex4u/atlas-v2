import { fetchHtml } from '../utils/scrape.js';
import { logWarn } from '../utils/logger.js';
import { expandBrandAliases, normalizeBrandKey } from './aliases.js';
import type { CandidateLink } from './types.js';

/** Curated Wikipedia pages for brands whose open-search is ambiguous. */
const KNOWN_WIKI: Record<string, string> = {
  bata: 'https://en.wikipedia.org/wiki/Bata_Corporation',
  'bata india': 'https://en.wikipedia.org/wiki/Bata_Corporation',
  'third wave coffee': 'https://en.wikipedia.org/wiki/Third_Wave_Coffee',
  britannia: 'https://en.wikipedia.org/wiki/Britannia_Industries',
  'britannia industries': 'https://en.wikipedia.org/wiki/Britannia_Industries',
  apple: 'https://en.wikipedia.org/wiki/Apple_Inc.',
  'apple india': 'https://en.wikipedia.org/wiki/Apple_Inc.',
  decathlon: 'https://en.wikipedia.org/wiki/Decathlon_(retailer)',
  'decathlon india': 'https://en.wikipedia.org/wiki/Decathlon_(retailer)',
  'blue tokai': 'https://en.wikipedia.org/wiki/Blue_Tokai',
  portronics: 'https://en.wikipedia.org/wiki/Portronics',
  giva: 'https://en.wikipedia.org/wiki/Giva',
};

function titleMatchesBrand(title: string, aliases: string[]): boolean {
  const hay = title.toLowerCase();
  return aliases.some((alias) => {
    const a = alias.toLowerCase().trim();
    if (a.length < 3) return false;
    if (hay === a || hay.startsWith(a + ' ') || hay.includes(' ' + a + ' ')) {
      return true;
    }
    // Allow "Bata Corporation" for alias "Bata"
    if (!a.includes(' ') && new RegExp(`(?:^|[^a-z0-9])${a}(?:[^a-z0-9]|$)`, 'i').test(hay)) {
      return true;
    }
    return hay.includes(a);
  });
}

/**
 * Resolve a Wikipedia article URL for the brand (entity evidence fallback).
 */
export async function discoverWikipediaCandidate(options: {
  brandName: string;
  signal?: AbortSignal;
}): Promise<CandidateLink | null> {
  const { brandName, signal } = options;
  const aliases = expandBrandAliases(brandName);
  const key = normalizeBrandKey(brandName);

  // 1) Curated page
  const known =
    KNOWN_WIKI[key] ??
    aliases.map((a) => KNOWN_WIKI[normalizeBrandKey(a)]).find(Boolean);
  if (known) {
    const page = await fetchHtml(known, { signal, timeoutMs: 15_000 });
    if (page.ok) {
      return {
        url: page.url,
        title: decodeURIComponent(page.url.split('/wiki/')[1] ?? brandName).replace(/_/g, ' '),
        sourceLabel: 'Wikipedia',
        retrievalMethod: 'publisher_search',
      };
    }
  }

  // 2) OpenSearch — require title to match an alias (never take first hit blindly)
  const queries = [brandName, ...aliases.slice(0, 3)];
  for (const q of queries) {
    if (signal?.aborted) return null;
    const api = `https://en.wikipedia.org/w/api.php?action=opensearch&limit=5&namespace=0&format=json&search=${encodeURIComponent(q)}`;
    try {
      const res = await fetch(api, {
        headers: {
          'User-Agent': 'AtlasBot/0.1 (market-intelligence; +https://bizex4u.com)',
          Accept: 'application/json',
        },
        signal: signal ?? AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as [
        string,
        string[],
        string[],
        string[],
      ];
      const titles = data[1] ?? [];
      const urls = data[3] ?? [];
      for (let i = 0; i < urls.length; i++) {
        const title = titles[i] ?? '';
        const url = urls[i];
        if (!url || !titleMatchesBrand(title, aliases)) continue;
        return {
          url,
          title,
          sourceLabel: 'Wikipedia',
          retrievalMethod: 'publisher_search',
        };
      }
    } catch (err) {
      logWarn('[retrieval] wikipedia search failed', {
        query: q,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return null;
}
