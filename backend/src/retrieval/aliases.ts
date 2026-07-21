/**
 * Brand alias expansion for retrieval relevance and website resolution.
 *
 * Prefer curated aliases for known brands; always derive structural aliases
 * (strip geo / legal suffixes, shorten multi-word names).
 */

const GEO_AND_LEGAL_SUFFIXES = new Set([
  'india',
  'indian',
  'limited',
  'ltd',
  'pvt',
  'private',
  'company',
  'co',
  'inc',
  'corp',
  'corporation',
  'plc',
  'llc',
  'group',
  'holdings',
]);

/** First tokens too generic to be a brand root alone. */
const WEAK_ROOT_TOKENS = new Set([
  'third',
  'blue',
  'best',
  'new',
  'the',
  'my',
  'our',
  'red',
  'green',
  'black',
  'white',
  'big',
  'top',
  'pro',
  'one',
  'all',
]);

/** Curated aliases keyed by normalized brand (lowercase, collapsed spaces). */
const CURATED: Record<string, string[]> = {
  'bata india': ['Bata', 'Bata Limited', 'Bata India Ltd', 'Bata Shoes', 'Bata India Limited'],
  bata: ['Bata', 'Bata Limited', 'Bata Shoes'],
  'third wave coffee': [
    'Third Wave',
    'Third Wave Coffee',
    'Third Wave Coffee Roasters',
    'ThirdWave Coffee',
  ],
  'third wave': ['Third Wave', 'Third Wave Coffee', 'Third Wave Coffee Roasters'],
  britannia: ['Britannia', 'Britannia Industries', 'Britannia Industries Limited'],
  'britannia industries': [
    'Britannia',
    'Britannia Industries',
    'Britannia Industries Limited',
  ],
  giva: ['Giva', 'Giva Jewellery'],
  portronics: ['Portronics'],
  'apple india': ['Apple', 'Apple Inc', 'Apple India'],
  apple: ['Apple', 'Apple Inc'],
  'decathlon india': ['Decathlon', 'Decathlon India', 'Decathlon Sports'],
  decathlon: ['Decathlon', 'Decathlon Sports'],
  'blue tokai': ['Blue Tokai', 'Blue Tokai Coffee', 'Blue Tokai Coffee Roasters'],
  'blue tokai coffee': [
    'Blue Tokai',
    'Blue Tokai Coffee',
    'Blue Tokai Coffee Roasters',
  ],
};

export function normalizeBrandKey(brandName: string): string {
  return brandName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniquePreserve(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const t = v.trim();
    if (!t) continue;
    const key = normalizeBrandKey(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

function stripSuffixes(brandName: string): string[] {
  const tokens = brandName
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const out: string[] = [];
  let working = [...tokens];
  while (working.length > 1) {
    const last = working[working.length - 1].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!GEO_AND_LEGAL_SUFFIXES.has(last)) break;
    working = working.slice(0, -1);
    out.push(working.join(' '));
  }
  if (tokens.length >= 2) {
    // First token alone when it's a distinctive brand root (Bata, Apple, …)
    const first = tokens[0];
    const firstClean = first.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (
      first.length >= 3 &&
      !GEO_AND_LEGAL_SUFFIXES.has(firstClean) &&
      !WEAK_ROOT_TOKENS.has(firstClean)
    ) {
      out.push(first);
    }
    // Drop trailing product word: "Third Wave Coffee" → "Third Wave"
    if (
      tokens.length >= 3 &&
      !GEO_AND_LEGAL_SUFFIXES.has(tokens[tokens.length - 1].toLowerCase())
    ) {
      out.push(tokens.slice(0, -1).join(' '));
    }
  }
  return out;
}

/**
 * Expand a brand into aliases used for relevance + domain resolution.
 * Always includes the original name.
 */
export function expandBrandAliases(brandName: string): string[] {
  const trimmed = brandName.trim();
  if (!trimmed) return [];

  const key = normalizeBrandKey(trimmed);
  const curated = CURATED[key] ?? [];
  const structural = stripSuffixes(trimmed);

  // Coffee / specialty: add "… Roasters" form when useful
  const extras: string[] = [];
  if (/\bcoffee\b/i.test(trimmed) && !/\broasters\b/i.test(trimmed)) {
    extras.push(`${trimmed} Roasters`);
    const withoutCoffee = trimmed.replace(/\s+coffee\s*$/i, '').trim();
    if (withoutCoffee) extras.push(withoutCoffee);
  }

  return uniquePreserve([trimmed, ...curated, ...structural, ...extras]);
}

/**
 * Primary brand root for domain heuristics — first non-geo/legal token,
 * or curated short form when available.
 */
export function brandRootToken(brandName: string): string {
  const aliases = expandBrandAliases(brandName);
  const short = aliases
    .map((a) => a.trim())
    .filter((a) => {
      if (a.split(/\s+/).length !== 1 || a.length < 3) return false;
      const clean = a.toLowerCase().replace(/[^a-z0-9]/g, '');
      return !WEAK_ROOT_TOKENS.has(clean) && !GEO_AND_LEGAL_SUFFIXES.has(clean);
    })
    .sort((a, b) => a.length - b.length)[0];
  if (short) return short;

  const tokens = brandName.trim().split(/\s+/).filter(Boolean);
  for (const t of tokens) {
    const clean = t.replace(/[^a-zA-Z0-9]/g, '');
    if (
      clean.length >= 3 &&
      !GEO_AND_LEGAL_SUFFIXES.has(clean.toLowerCase()) &&
      !WEAK_ROOT_TOKENS.has(clean.toLowerCase())
    ) {
      return clean;
    }
  }
  for (let i = tokens.length - 1; i >= 0; i--) {
    const clean = tokens[i].replace(/[^a-zA-Z0-9]/g, '');
    if (
      clean.length >= 3 &&
      !GEO_AND_LEGAL_SUFFIXES.has(clean.toLowerCase()) &&
      !WEAK_ROOT_TOKENS.has(clean.toLowerCase())
    ) {
      return clean;
    }
  }
  return tokens[0]?.replace(/[^a-zA-Z0-9]/g, '') || brandName.trim();
}

export function isGeoOrLegalToken(token: string): boolean {
  return GEO_AND_LEGAL_SUFFIXES.has(
    token.toLowerCase().replace(/[^a-z0-9]/g, ''),
  );
}
