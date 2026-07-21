import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  BriefMeta,
  CampaignBrief,
  EvidenceReference,
  Field,
} from '../campaign-brief.js';
import { emptyField, provenancedField } from '../campaign-brief.js';

function sampleBrief(overrides?: Partial<CampaignBrief>): CampaignBrief {
  const name = provenancedField('Bata India Limited', 'estimated', [
    { evidenceId: 'abc123', relevance: 0.9 },
  ], { extractionMethod: 'llm_extract', freshness: 'fresh' });

  return {
    meta: {
      requestId: 'req_1',
      executionId: 'exec_1',
      generatedAt: '2026-07-20T12:00:00.000Z',
      provider: 'openrouter',
      model: 'openrouter/free',
      orchestratorVersion: '0.1.0',
      promptVersion: 'discovery@1',
      agentVersions: { Discovery: '1' },
      latencyMs: 1200,
      tokenUsage: { prompt: 100, completion: 50, total: 150 },
      estimatedCost: 0.002,
      cacheHits: 0,
    },
    brand: {
      name,
      category: emptyField('insufficient_sources'),
      hq: emptyField(),
      revenue: emptyField(),
      cagr: emptyField(),
      totalStores: emptyField(),
      pricePoint: emptyField(),
      ambassador: emptyField(),
      activeCampaign: emptyField(),
      pillars: emptyField(),
    },
    markets: [
      {
        name: 'Mumbai',
        priority: 'P1',
        storeCount: 12,
        clusters: [],
        highways: [],
        inventory: emptyField('vendor inventory not yet loaded'),
        zeptoOverlap: 3,
        rationale: 'High store density',
        budgetAllocation: '40%',
        geoMarketId: 'geo:mumbai',
        evidence: [{ evidenceId: 'geo-ev-1' }],
        reasoningNotes: 'Prioritized from Geo storeCount',
      },
    ],
    competitors: emptyField(),
    mediaPlan: {
      sequencing: [
        {
          weeks: '1-4',
          channel: 'OOH',
          budgetShare: '30%',
          goal: 'Awareness',
          reasoningNotes: 'Template flighting',
        },
      ],
      seasonalPhases: [],
    },
    budget: {
      total: emptyField(),
      barterSavings: emptyField(),
      lineItems: emptyField(),
    },
    ...overrides,
  };
}

describe('Field<T> provenance', () => {
  it('supports EvidenceReference arrays on populated fields', () => {
    const refs: EvidenceReference[] = [
      { evidenceId: 'e1', relevance: 1 },
      { evidenceId: 'e2', quote: 'revenue grew 12%' },
    ];
    const field: Field<string> = provenancedField('₹3,000 Cr', 'verified', refs, {
      freshness: 'fresh',
      extractionMethod: 'llm_extract',
    });

    assert.equal(field.value, '₹3,000 Cr');
    assert.equal(field.confidence, 'verified');
    assert.equal(field.evidence?.length, 2);
    assert.equal(field.evidence?.[1].quote, 'revenue grew 12%');
  });

  it('emptyField defaults evidence to [] and needs_input', () => {
    const f = emptyField<number>('missing');
    assert.equal(f.value, null);
    assert.equal(f.confidence, 'needs_input');
    assert.deepEqual(f.evidence, []);
    assert.equal(f.reason, 'missing');
  });

  it('accepts legacy Stage-4 fields without evidence (backwards compatible)', () => {
    const legacy: Field<string> = {
      value: 'Bata',
      confidence: 'estimated',
      sources: ['https://example.com'],
    };
    assert.equal(legacy.evidence, undefined);
    assert.deepEqual(legacy.sources, ['https://example.com']);
  });
});

describe('BriefMeta', () => {
  it('serializes round-trip with optional token/cost fields', () => {
    const meta: BriefMeta = {
      requestId: 'r1',
      generatedAt: '2026-07-20T00:00:00.000Z',
      orchestratorVersion: '0.1.0',
    };
    const json = JSON.stringify(meta);
    const parsed = JSON.parse(json) as BriefMeta;
    assert.equal(parsed.requestId, 'r1');
    assert.equal(parsed.tokenUsage, undefined);
  });
});

describe('CampaignBrief schema', () => {
  it('JSON serialization preserves provenance and meta', () => {
    const brief = sampleBrief();
    const parsed = JSON.parse(JSON.stringify(brief)) as CampaignBrief;

    assert.equal(parsed.meta?.requestId, 'req_1');
    assert.equal(parsed.meta?.executionId, 'exec_1');
    assert.equal(parsed.brand.name.value, 'Bata India Limited');
    assert.equal(parsed.brand.name.evidence?.[0].evidenceId, 'abc123');
    assert.equal(parsed.markets[0].geoMarketId, 'geo:mumbai');
    assert.equal(parsed.mediaPlan.sequencing[0].reasoningNotes, 'Template flighting');
  });

  it('allows briefs without meta (Stage 4 backwards compatibility)', () => {
    const brief = sampleBrief({ meta: undefined });
    assert.equal(brief.meta, undefined);
    const parsed = JSON.parse(JSON.stringify(brief)) as CampaignBrief;
    assert.equal(parsed.meta, undefined);
    assert.ok(parsed.brand.name.value);
  });

  it('markets keep plain geo geometry with optional evidence', () => {
    const brief = sampleBrief();
    const m = brief.markets[0];
    assert.equal(typeof m.storeCount, 'number');
    assert.equal(typeof m.zeptoOverlap, 'number');
    assert.ok(Array.isArray(m.clusters));
    assert.ok(m.inventory.confidence === 'needs_input');
    assert.ok(m.evidence?.[0].evidenceId);
  });
});
