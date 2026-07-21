/**
 * Process-local cache of resolved official brand websites.
 * Survives across retrieveEvidence calls within the same backend process.
 */

export type CachedBrandWebsite = {
  website: string;
  reason: string;
  resolvedAt: number;
};

const cache = new Map<string, CachedBrandWebsite>();

function keyFor(brandName: string): string {
  return brandName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getCachedBrandWebsite(
  brandName: string,
): CachedBrandWebsite | null {
  return cache.get(keyFor(brandName)) ?? null;
}

export function setCachedBrandWebsite(
  brandName: string,
  website: string,
  reason: string,
): void {
  const key = keyFor(brandName);
  if (!key || !website) return;
  cache.set(key, {
    website,
    reason,
    resolvedAt: Date.now(),
  });
}

/** Test helper — clears the in-memory cache. */
export function clearBrandWebsiteCache(): void {
  cache.clear();
}
