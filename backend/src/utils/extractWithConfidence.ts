import type { Confidence, Field } from '@atlas/shared';
import { field, needsInput } from '../agents/types.js';

function normalizeValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!s || /^n\/?a$/i.test(s) || /^unknown$/i.test(s) || /^null$/i.test(s)) {
    return null;
  }
  return s;
}

function tallyVotes(values: Array<string | null>): {
  top: string | null;
  topAgreement: number;
  nonNull: number;
} {
  const counts = new Map<string, number>();
  let nonNull = 0;
  for (const v of values) {
    const n = normalizeValue(v);
    if (!n) continue;
    nonNull += 1;
    const key = n.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  if (nonNull === 0) {
    return { top: null, topAgreement: 0, nonNull: 0 };
  }

  let bestKey = '';
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      bestKey = key;
      bestCount = count;
    }
  }

  const display =
    values
      .map((v) => normalizeValue(v))
      .find((v) => v && v.toLowerCase() === bestKey) ?? null;

  return {
    top: display,
    topAgreement: bestCount / nonNull,
    nonNull,
  };
}

/**
 * Never Empty, Never Wrong — multi-source extraction with vote + confidence.
 * Never invents values. Conflicts / missing sources → null + needs_input.
 */
export async function extractWithConfidence(
  query: string,
  sources: string[],
  llmExtract: (query: string, source: string) => Promise<string | null>,
): Promise<Field<string> & { reason?: string }> {
  if (sources.length === 0) {
    return needsInput('insufficient_sources');
  }

  const extractions = await Promise.all(
    sources.map(async (source) => {
      try {
        return await llmExtract(query, source);
      } catch {
        return null;
      }
    }),
  );

  const votes = tallyVotes(extractions);

  if (votes.topAgreement >= 0.6 && votes.top) {
    return field(votes.top, 'verified', sources);
  }
  if (votes.topAgreement >= 0.3 && votes.top) {
    return field(votes.top, 'estimated', sources);
  }
  return {
    ...needsInput('insufficient_sources'),
    reason: 'insufficient_sources',
    sources,
  };
}

export function confidenceFromAgreement(agreement: number): Confidence {
  if (agreement >= 0.6) return 'verified';
  if (agreement >= 0.3) return 'estimated';
  return 'needs_input';
}

export { tallyVotes, normalizeValue };
