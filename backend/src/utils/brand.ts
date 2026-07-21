/**
 * Canonicalize raw user brand input before research.
 * "bata india" → "Bata India"
 */
export function normalizeBrandInput(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  if (!cleaned) return cleaned;

  const lowerParticles = new Set([
    'and',
    'or',
    'of',
    'the',
    'a',
    'an',
    'in',
    'for',
    'to',
  ]);

  return cleaned
    .split(' ')
    .map((word, index) => {
      if (!word) return word;
      const lower = word.toLowerCase();
      if (index > 0 && lowerParticles.has(lower)) return lower;
      // Preserve known all-caps tokens (TVC, FM, OOH) and short acronyms
      if (/^[A-Z0-9]{2,5}$/.test(word) && word === word.toUpperCase()) {
        return word;
      }
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/**
 * Prefer Discovery's officialName when verified/estimated; else normalized input.
 */
export function resolveCanonicalBrand(
  normalizedInput: string,
  officialName: string | null | undefined,
): string {
  const official = officialName?.trim();
  if (official) return official;
  return normalizedInput;
}
