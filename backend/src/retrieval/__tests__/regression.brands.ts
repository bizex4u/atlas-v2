/**
 * Live retrieval + research regression across priority brands.
 *
 * Usage:
 *   npx tsx src/retrieval/__tests__/regression.brands.ts
 *   REGRESSION_FULL=1 npx tsx src/retrieval/__tests__/regression.brands.ts
 *
 * REGRESSION_FULL=1 also hits /api/research/stream for validation metrics.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEvidenceStore } from '../../evidence/index.js';
import { expandBrandAliases } from '../aliases.js';
import { retrieveEvidence } from '../retrieve.js';
import { resolveBrandWebsite } from '../resolveWebsite.js';
import { clearBrandWebsiteCache } from '../websiteCache.js';

const BRANDS = [
  'Bata India',
  'Third Wave Coffee',
  'Britannia',
  'Giva',
  'Portronics',
  'Apple India',
  'Decathlon India',
  'Blue Tokai',
] as const;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../');
const OUT_DIR = join(ROOT, 'logs');
const FULL = process.env.REGRESSION_FULL === '1';
const BASE_URL = process.env.ATLAS_API ?? 'http://localhost:3001';

type BrandResult = {
  brand: string;
  aliases: string[];
  websiteSelected: string | null;
  websiteReason: string;
  candidateDomains: string[];
  domainsAttempted: number;
  domainsResolved: string[];
  evidenceRetrieved: number;
  evidenceStored: number;
  sampleUrls: string[];
  validation: 'pass' | 'fail' | 'skipped' | 'error';
  validationReason?: string;
  populatedFields: number;
  totalScoredFields: number;
  error?: string;
};

function countPopulated(brief: unknown): { filled: number; total: number } {
  if (!brief || typeof brief !== 'object') return { filled: 0, total: 14 };
  const b = brief as {
    brand?: Record<string, { value?: unknown; confidence?: string }>;
    competitors?: { value?: unknown; confidence?: string };
    budget?: Record<string, { value?: unknown; confidence?: string }>;
    markets?: unknown[];
    mediaPlan?: { sequencing?: unknown[] };
  };
  const scored = [
    b.brand?.name,
    b.brand?.category,
    b.brand?.hq,
    b.brand?.revenue,
    b.brand?.cagr,
    b.brand?.totalStores,
    b.brand?.pricePoint,
    b.brand?.ambassador,
    b.brand?.activeCampaign,
    b.brand?.pillars,
    b.competitors,
    b.budget?.total,
    b.budget?.barterSavings,
    b.budget?.lineItems,
  ];
  const total = scored.length;
  const filled = scored.filter((f) => {
    if (!f) return false;
    if (f.value == null) return false;
    if (Array.isArray(f.value) && f.value.length === 0) return false;
    if (typeof f.value === 'string' && !f.value.trim()) return false;
    return f.confidence !== 'needs_input';
  }).length;
  return { filled, total };
}

async function runResearch(brand: string): Promise<{
  validation: BrandResult['validation'];
  validationReason?: string;
  populatedFields: number;
  totalScoredFields: number;
}> {
  const url = `${BASE_URL}/api/research/stream?brand=${encodeURIComponent(brand)}`;
  const res = await fetch(url, {
    headers: { Accept: 'text/event-stream' },
    // Full research can exceed 5 minutes for sparse brands / free-tier LLM
    signal: AbortSignal.timeout(420_000),
  });
  if (!res.ok || !res.body) {
    return {
      validation: 'error',
      validationReason: `HTTP ${res.status}`,
      populatedFields: 0,
      totalScoredFields: 14,
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let validation: BrandResult['validation'] = 'error';
  let validationReason: string | undefined;
  let populatedFields = 0;
  let totalScoredFields = 14;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const chunks = buf.split('\n\n');
    buf = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      try {
        const ev = JSON.parse(line.slice(6)) as {
          type: string;
          brief?: unknown;
          message?: string;
        };
        if (ev.type === 'complete' && ev.brief) {
          validation = 'pass';
          const c = countPopulated(ev.brief);
          populatedFields = c.filled;
          totalScoredFields = c.total;
        } else if (ev.type === 'error') {
          validation = 'fail';
          validationReason = ev.message;
        }
      } catch {
        // ignore partial JSON
      }
    }
  }

  return { validation, validationReason, populatedFields, totalScoredFields };
}

async function runBrand(brand: string): Promise<BrandResult> {
  clearBrandWebsiteCache();
  const aliases = expandBrandAliases(brand);

  let resolved: Awaited<ReturnType<typeof resolveBrandWebsite>> | null = null;
  let docs: Awaited<ReturnType<typeof retrieveEvidence>> = [];
  let storeSize = 0;
  let retrievalError: string | undefined;

  try {
    resolved = await resolveBrandWebsite({ brandName: brand });
    docs = await retrieveEvidence({
      brandName: brand,
      website: resolved.website,
      maxDocuments: 10,
      intents: ['entity', 'financial', 'campaign', 'competitor', 'store'],
    });
    const store = createEvidenceStore();
    for (const doc of docs) {
      store.add({ ...doc, brand: doc.brand || brand });
    }
    storeSize = store.size();
  } catch (err) {
    retrievalError = err instanceof Error ? err.message : String(err);
  }

  let validation: BrandResult['validation'] = 'skipped';
  let validationReason: string | undefined;
  let populatedFields = 0;
  let totalScoredFields = 14;

  if (FULL) {
    try {
      const research = await runResearch(brand);
      validation = research.validation;
      validationReason = research.validationReason;
      populatedFields = research.populatedFields;
      totalScoredFields = research.totalScoredFields;
    } catch (err) {
      validation = 'error';
      validationReason = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    brand,
    aliases,
    websiteSelected: resolved?.website ?? null,
    websiteReason: resolved?.reason ?? 'none',
    candidateDomains: resolved?.telemetry.candidateDomains.slice(0, 16) ?? [],
    domainsAttempted: resolved?.telemetry.domainsAttempted.length ?? 0,
    domainsResolved: resolved?.telemetry.domainsResolved ?? [],
    evidenceRetrieved: docs.length,
    evidenceStored: storeSize,
    sampleUrls: docs.slice(0, 5).map((d) => d.canonicalUrl),
    validation,
    validationReason,
    populatedFields,
    totalScoredFields,
    error: retrievalError,
  };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(
    `Retrieval regression (${BRANDS.length} brands)${FULL ? ' + full research' : ' — retrieval only'}\n`,
  );

  const results: BrandResult[] = [];
  for (const brand of BRANDS) {
    console.log(`→ ${brand}`);
    const r = await runBrand(brand);
    results.push(r);
    console.log(
      `  website=${r.websiteSelected ?? '(none)'} (${r.websiteReason}) | evidence=${r.evidenceRetrieved} stored=${r.evidenceStored} | validation=${r.validation}${r.validationReason ? ` — ${r.validationReason.slice(0, 80)}` : ''}`,
    );
  }

  const outPath = join(OUT_DIR, 'retrieval-regression.json');
  writeFileSync(outPath, JSON.stringify({ at: new Date().toISOString(), full: FULL, results }, null, 2));

  console.log('\n=== Summary ===');
  console.log(
    '| Brand | Evidence retrieved | Stored | Website | Reason | Validation | Populated |',
  );
  console.log('|---|---:|---:|---|---|---|---|');
  for (const r of results) {
    console.log(
      `| ${r.brand} | ${r.evidenceRetrieved} | ${r.evidenceStored} | ${r.websiteSelected ?? '—'} | ${r.websiteReason} | ${r.validation} | ${r.populatedFields}/${r.totalScoredFields} |`,
    );
  }

  const failures = results.filter(
    (r) => r.evidenceRetrieved === 0 || r.validation === 'fail' || r.validation === 'error',
  );
  console.log(`\nWrote ${outPath}`);
  console.log(
    `Failures (0 evidence or validation fail/error): ${failures.length}/${results.length}`,
  );
  for (const f of failures) {
    console.log(`  - ${f.brand}: evidence=${f.evidenceRetrieved} validation=${f.validation} ${f.validationReason ?? f.error ?? ''}`);
  }

  // Exit non-zero if any brand retrieved zero evidence
  if (results.some((r) => r.evidenceRetrieved === 0)) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
