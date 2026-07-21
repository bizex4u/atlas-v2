import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CampaignBrief, Market } from '@atlas/shared';
import { emptyField, provenancedField } from '@atlas/shared';
import { validateCampaignBrief } from '../validateBrief.js';

function market(overrides: Partial<Market>): Market {
  return {
    name: 'Mumbai',
    priority: 'P1',
    storeCount: 12,
    clusters: [{ zone: 'Mumbai core', count: 6, areas: ['CBD'] }],
    highways: [],
    inventory: emptyField('vendor inventory not yet loaded'),
    zeptoOverlap: 3,
    rationale: 'High store density',
    budgetAllocation: '40%',
    geoMarketId: 'Mumbai',
    ...overrides,
  };
}

function brief(overrides?: Partial<CampaignBrief>): CampaignBrief {
  return {
    meta: { requestId: 'r1', generatedAt: '2026-07-20T00:00:00Z', orchestratorVersion: '0.1.0' },
    brand: {
      name: provenancedField('Bata India', 'estimated', [{ evidenceId: 'e1', relevance: 0.9 }]),
      category: provenancedField('Footwear', 'estimated', [{ evidenceId: 'e2' }]),
      hq: emptyField(),
      revenue: emptyField(),
      cagr: emptyField(),
      totalStores: emptyField(),
      pricePoint: emptyField(),
      ambassador: emptyField(),
      activeCampaign: emptyField(),
      pillars: emptyField(),
    },
    markets: [market({})],
    competitors: provenancedField([{ name: 'Liberty', positioning: 'value' }], 'estimated', [{ evidenceId: 'e3' }]),
    mediaPlan: {
      sequencing: [{ weeks: '1-4', channel: 'OOH', budgetShare: '30%', goal: 'Awareness' }],
      seasonalPhases: [],
    },
    budget: { total: emptyField(), barterSavings: emptyField(), lineItems: emptyField() },
    ...overrides,
  };
}

describe('validateCampaignBrief — provenance gate', () => {
  it('accepts a brief whose markets carry real geo signal', () => {
    const res = validateCampaignBrief(brief());
    assert.equal(res.ok, true);
  });

  it('rejects when every market is hollow (zero stores, no clusters) — the invented-metros signature', () => {
    const res = validateCampaignBrief(
      brief({
        markets: [
          market({ name: 'Gurugram', storeCount: 0, clusters: [] }),
          market({ name: 'Delhi NCR', storeCount: 0, clusters: [] }),
          market({ name: 'Mumbai', storeCount: 0, clusters: [] }),
        ],
      }),
    );
    assert.equal(res.ok, false);
    assert.match(res.reason ?? '', /geo signal|footprint/i);
  });

  it('accepts a brief where at least one market has store signal even if others are hollow', () => {
    const res = validateCampaignBrief(
      brief({
        markets: [
          market({ name: 'Kolkata', storeCount: 8, clusters: [{ zone: 'core', count: 4, areas: ['x'] }] }),
          market({ name: 'Patna', storeCount: 0, clusters: [] }),
        ],
      }),
    );
    assert.equal(res.ok, true);
  });

  it('still rejects a near-empty brief (only brand name)', () => {
    const res = validateCampaignBrief(
      brief({
        markets: [],
        competitors: emptyField(),
        mediaPlan: { sequencing: [], seasonalPhases: [] },
        brand: {
          name: provenancedField('Bata India', 'estimated', [{ evidenceId: 'e1' }]),
          category: emptyField(),
          hq: emptyField(),
          revenue: emptyField(),
          cagr: emptyField(),
          totalStores: emptyField(),
          pricePoint: emptyField(),
          ambassador: emptyField(),
          activeCampaign: emptyField(),
          pillars: emptyField(),
        },
      }),
    );
    assert.equal(res.ok, false);
  });
});
