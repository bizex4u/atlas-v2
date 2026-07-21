import { fetchHtml } from '../utils/scrape.js';
import { logInfo, logWarn } from '../utils/logger.js';
import { brandRootToken, expandBrandAliases } from './aliases.js';
import { normalizeUrl } from './normalize.js';
import {
  getCachedBrandWebsite,
  setCachedBrandWebsite,
} from './websiteCache.js';

export type ResolveReason =
  | 'discovery'
  | 'cache'
  | 'official_search'
  | 'cctld'
  | 'alias'
  | 'heuristic'
  | 'none';

export type WebsiteResolveTelemetry = {
  candidateDomains: string[];
  domainsAttempted: string[];
  domainsResolved: string[];
  selected: string | null;
  reasonSelected: ResolveReason;
};

export type ResolveBrandWebsiteResult = {
  website: string | null;
  reason: ResolveReason;
  telemetry: WebsiteResolveTelemetry;
};

const CCTLD_SUFFIXES = ['.in', '.com', '.co.in'] as const;


/** Known official domains — prefer India TLD / /in/ storefronts. */
const KNOWN_OFFICIAL_DOMAINS: Record<string, string> = {
  bata: 'https://www.bata.in/',
  'bata india': 'https://www.bata.in/',
  'third wave coffee': 'https://www.thirdwavecoffeeroasters.com',
  'third wave': 'https://www.thirdwavecoffeeroasters.com',
  britannia: 'https://www.britannia.co.in',
  'britannia industries': 'https://www.britannia.co.in',
  giva: 'https://www.giva.co',
  portronics: 'https://www.portronics.com',
  apple: 'https://www.apple.com/in/',
  'apple india': 'https://www.apple.com/in/',
  decathlon: 'https://www.decathlon.in',
  'decathlon india': 'https://www.decathlon.in',
  'blue tokai': 'https://bluetokaicoffee.com',
  'blue tokai coffee': 'https://bluetokaicoffee.com',
};

function normalizeKey(brand: string): string {
  return brand
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toHttpsUrl(input: string): string {
  const t = input.trim();
  if (!t) return t;
  if (/^https?:\/\//i.test(t)) return t;
  return `https://${t.replace(/^\/\//, '')}`;
}

function hostOf(url: string): string | null {
  try {
    return new URL(toHttpsUrl(url)).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

function pushUnique(list: string[], value: string) {
  const url = toHttpsUrl(value);
  if (!url) return;
  if (!list.includes(url)) list.push(url);
}

/**
 * Probe whether a candidate homepage is reachable.
 * Returns the final URL after redirects when ok.
 */
export async function probeWebsite(
  website: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; finalUrl: string | null; reason: string }> {
  const url = toHttpsUrl(website);
  const page = await fetchHtml(url, { signal, timeoutMs: 15_000 });
  if (page.ok) {
    return { ok: true, finalUrl: page.url, reason: 'http_ok' };
  }

  // Regional .in → .com/in fallback
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    if (host.endsWith('.in') && !host.endsWith('.co.in')) {
      const alt = `https://www.${host.replace(/\.in$/, '.com')}/in/`;
      const altPage = await fetchHtml(alt, { signal, timeoutMs: 15_000 });
      if (altPage.ok) {
        return { ok: true, finalUrl: altPage.url, reason: 'regional_redirect' };
      }
    }
  } catch {
    // ignore
  }

  return { ok: false, finalUrl: null, reason: page.reason };
}

function looksLikeBrandHost(host: string, brandName: string): boolean {
  const h = host.replace(/^www\./, '').toLowerCase();
  // Non-commercial TLDs are almost never the retail brand site
  if (/\.(org|gov|edu|mil)(\.|$)/i.test(h)) return false;

  const root = brandRootToken(brandName).toLowerCase().replace(/[^a-z0-9]/g, '');
  const compactAliases = expandBrandAliases(brandName)
    .filter((a) => a.split(/\s+/).length <= 2)
    .map((a) => a.toLowerCase().replace(/[^a-z0-9]+/g, ''))
    .filter((a) => a.length >= 3);
  const hay = h.replace(/\./g, '');
  if (root.length >= 3 && (h.includes(root) || hay.includes(root))) return true;
  return compactAliases.some((a) => h.includes(a) || hay.includes(a));
}

function candidateFromKnownMap(brandName: string): string | null {
  const key = normalizeKey(brandName);
  if (KNOWN_OFFICIAL_DOMAINS[key]) return KNOWN_OFFICIAL_DOMAINS[key];
  for (const alias of expandBrandAliases(brandName)) {
    const k = normalizeKey(alias);
    if (KNOWN_OFFICIAL_DOMAINS[k]) return KNOWN_OFFICIAL_DOMAINS[k];
  }
  return null;
}

/**
 * Build ccTLD / alias domain candidates from the brand ROOT token and short aliases.
 * Never concatenates the full multi-word brand into one slug (no bataindia.com).
 */
export function buildDomainCandidates(brandName: string): string[] {
  const out: string[] = [];
  const root = brandRootToken(brandName).toLowerCase().replace(/[^a-z0-9]/g, '');
  // Only single-token aliases become apex domains (bata.com) — never
  // concatenate "Bata India" → bataindia.com.
  const aliasSlugs = expandBrandAliases(brandName)
    .filter((a) => a.trim().split(/\s+/).length === 1)
    .map((a) => a.toLowerCase().replace(/[^a-z0-9]+/g, ''))
    .filter(
      (s) =>
        s.length >= 3 &&
        s.length <= 24 &&
        !['third', 'blue', 'best', 'new', 'the'].includes(s),
    );

  const slugs = [...new Set([root, ...aliasSlugs].filter(Boolean))];

  for (const slug of slugs) {
    for (const tld of CCTLD_SUFFIXES) {
      pushUnique(out, `https://www.${slug}${tld}`);
      pushUnique(out, `https://${slug}${tld}`);
    }
  }

  // Multi-word short aliases as dashed domains only (blue-tokai, third-wave)
  for (const alias of expandBrandAliases(brandName)) {
    const parts = alias
      .toLowerCase()
      .split(/\s+/)
      .map((p) => p.replace(/[^a-z0-9]/g, ''))
      .filter((p) => p.length >= 2);
    if (parts.length === 2) {
      const dashed = parts.join('-');
      for (const tld of ['.com', '.in', '.co.in'] as const) {
        pushUnique(out, `https://www.${dashed}${tld}`);
        pushUnique(out, `https://${dashed}${tld}`);
      }
    }
    if (parts.length >= 2 && parts.length <= 3) {
      // Specialty coffee compound domains (not legal/geo concat)
      if (parts.includes('coffee') || parts.includes('tokai') || parts.includes('wave')) {
        const compound = parts.join('');
        pushUnique(out, `https://www.${compound}.com`);
        pushUnique(out, `https://${compound}.com`);
        if (!parts.includes('roasters')) {
          pushUnique(out, `https://www.${compound}roasters.com`);
        }
      }
    }
  }

  return out.slice(0, 24);
}

/**
 * Lightweight official-site discovery via DuckDuckGo HTML SERP.
 * Extracts outbound homepage-like URLs that match brand root / aliases.
 */
export async function searchOfficialDomain(
  brandName: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const queries = [
    `${brandName} official website`,
    `${brandName} official site India`,
    `${brandRootToken(brandName)} official website`,
  ];
  const found: string[] = [];
  const aliasHosts = expandBrandAliases(brandName).map((a) =>
    a.toLowerCase().replace(/[^a-z0-9]+/g, ''),
  );
  const root = brandRootToken(brandName).toLowerCase().replace(/[^a-z0-9]/g, '');

  for (const q of queries.slice(0, 2)) {
    if (signal?.aborted) break;
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const page = await fetchHtml(url, { signal, timeoutMs: 10000 });
    if (!page.ok) {
      logWarn('[retrieval] official domain search failed', {
        query: q,
        reason: page.reason,
      });
      continue;
    }

    const hrefs = [...page.html.matchAll(/uddg=([^&"]+)/gi)].map((m) => {
      try {
        return decodeURIComponent(m[1]);
      } catch {
        return null;
      }
    });
    const plain = [
      ...page.html.matchAll(/https?:\/\/[^\s"'<>]+/gi),
    ].map((m) => m[0]);

    for (const raw of [...hrefs, ...plain]) {
      if (!raw) continue;
      const norm = normalizeUrl(raw) ?? raw;
      const host = hostOf(norm);
      if (!host) continue;
      if (
        /duckduckgo|google\.|bing\.|yahoo\.|facebook\.|instagram\.|linkedin\.|twitter\.|wikipedia\.|youtube\./i.test(
          host,
        )
      ) {
        continue;
      }
      const compact = host.replace(/\./g, '');
      const matchesBrand =
        host.includes(root) ||
        compact.includes(root) ||
        aliasHosts.some((a) => a.length >= 3 && (host.includes(a) || compact.includes(a)));
      if (!matchesBrand) continue;
      // Prefer apex / www homepages
      try {
        const u = new URL(toHttpsUrl(norm));
        if (u.pathname !== '/' && u.pathname !== '/in/' && u.pathname.split('/').filter(Boolean).length > 1) {
          // still allow /in/ storefronts
          if (!/^\/in\/?$/i.test(u.pathname) && u.pathname !== '/') {
            // keep only shallow paths
            if (u.pathname.split('/').filter(Boolean).length > 1) continue;
          }
        }
        pushUnique(found, u.origin + (u.pathname.startsWith('/in') ? '/in/' : '/'));
      } catch {
        // skip
      }
    }
    if (found.length >= 3) break;
  }

  return found.slice(0, 5);
}

async function tryCandidates(
  candidates: string[],
  brandName: string,
  signal: AbortSignal | undefined,
  telemetry: WebsiteResolveTelemetry,
): Promise<string | null> {
  for (const candidate of candidates) {
    if (signal?.aborted) return null;
    const host = hostOf(candidate);
    if (host && !looksLikeBrandHost(host, brandName)) continue;
    if (telemetry.domainsAttempted.includes(candidate)) continue;
    telemetry.domainsAttempted.push(candidate);
    const probed = await probeWebsite(candidate, signal);
    if (probed.ok && probed.finalUrl) {
      const finalHost = hostOf(probed.finalUrl);
      if (finalHost && !looksLikeBrandHost(finalHost, brandName)) continue;
      telemetry.domainsResolved.push(probed.finalUrl);
      return probed.finalUrl;
    }
  }
  return null;
}

/**
 * Multi-stage official website resolver.
 *
 * Order: Discovery → cache → known/official search → ccTLDs → aliases → heuristic.
 */
export async function resolveBrandWebsite(options: {
  brandName: string;
  discoveryWebsite?: string | null;
  signal?: AbortSignal;
}): Promise<ResolveBrandWebsiteResult> {
  const { brandName, discoveryWebsite, signal } = options;
  const telemetry: WebsiteResolveTelemetry = {
    candidateDomains: [],
    domainsAttempted: [],
    domainsResolved: [],
    selected: null,
    reasonSelected: 'none',
  };

  const finish = (
    website: string | null,
    reason: ResolveReason,
  ): ResolveBrandWebsiteResult => {
    telemetry.selected = website;
    telemetry.reasonSelected = reason;
    if (website) {
      setCachedBrandWebsite(brandName, website, reason);
    }
    logInfo('[retrieval] website resolve', {
      brand: brandName,
      selected: website,
      reason,
      candidateDomains: telemetry.candidateDomains.slice(0, 12),
      domainsAttempted: telemetry.domainsAttempted.length,
      domainsResolved: telemetry.domainsResolved,
    });
    return { website, reason, telemetry };
  };

  // 1. Discovery official website
  if (discoveryWebsite?.trim()) {
    const url = toHttpsUrl(discoveryWebsite.trim());
    pushUnique(telemetry.candidateDomains, url);
    telemetry.domainsAttempted.push(url);
    const probed = await probeWebsite(url, signal);
    if (probed.ok && probed.finalUrl) {
      telemetry.domainsResolved.push(probed.finalUrl);
      return finish(probed.finalUrl, 'discovery');
    }
  }

  // 2. Existing brand-site cache
  const cached = getCachedBrandWebsite(brandName);
  if (cached?.website) {
    pushUnique(telemetry.candidateDomains, cached.website);
    telemetry.domainsAttempted.push(cached.website);
    const probed = await probeWebsite(cached.website, signal);
    if (probed.ok && probed.finalUrl) {
      telemetry.domainsResolved.push(probed.finalUrl);
      return finish(probed.finalUrl, 'cache');
    }
  }

  // 3. Official domain search — curated registry first (instant), then DDG
  const known = candidateFromKnownMap(brandName);
  if (known) {
    pushUnique(telemetry.candidateDomains, known);
    telemetry.domainsAttempted.push(known);
    // Curated official domains are trusted without a blocking probe.
    // Downstream brand_site fetch will validate reachability.
    return finish(known, 'official_search');
  }

  let officialHits: string[] = [];
  try {
    officialHits = await searchOfficialDomain(brandName, signal);
  } catch (err) {
    logWarn('[retrieval] official search error', err);
  }
  for (const hit of officialHits) pushUnique(telemetry.candidateDomains, hit);

  const stageSearch = await tryCandidates(
    officialHits,
    brandName,
    signal,
    telemetry,
  );
  if (stageSearch) return finish(stageSearch, 'official_search');

  // 4 + 5. Common ccTLDs + alias-based domains (root token only — never full concat)
  const domainCandidates = buildDomainCandidates(brandName);
  for (const c of domainCandidates) pushUnique(telemetry.candidateDomains, c);

  const root = brandRootToken(brandName).toLowerCase().replace(/[^a-z0-9]/g, '');
  const aliasOnly = domainCandidates.filter((c) => {
    const h = hostOf(c) ?? '';
    return (
      h === `${root}.in` ||
      h === `${root}.com` ||
      h === `${root}.co.in` ||
      h.startsWith(`${root}.`)
    );
  });
  const cctldRest = domainCandidates.filter((c) => !aliasOnly.includes(c));

  const stageAlias = await tryCandidates(
    aliasOnly,
    brandName,
    signal,
    telemetry,
  );
  if (stageAlias) return finish(stageAlias, 'alias');

  const stageCctld = await tryCandidates(
    cctldRest,
    brandName,
    signal,
    telemetry,
  );
  if (stageCctld) return finish(stageCctld, 'cctld');

  // 6. Heuristic fallback — remaining unattempted candidates
  const remaining = telemetry.candidateDomains.filter(
    (c) => !telemetry.domainsAttempted.includes(c),
  );
  const stageHeuristic = await tryCandidates(
    remaining,
    brandName,
    signal,
    telemetry,
  );
  if (stageHeuristic) return finish(stageHeuristic, 'heuristic');

  return finish(null, 'none');
}