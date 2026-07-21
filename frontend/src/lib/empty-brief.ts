import type { CampaignBrief, Field } from '@atlas/shared';

function needsInput<T>(): Field<T> {
  return { value: null, confidence: 'needs_input' };
}

/** Placeholder helper so shared types are verified as importable. */
export function emptyBrief(): CampaignBrief {
  return {
    brand: {
      name: needsInput(),
      category: needsInput(),
      hq: needsInput(),
      revenue: needsInput(),
      cagr: needsInput(),
      totalStores: needsInput(),
      pricePoint: needsInput(),
      ambassador: needsInput(),
      activeCampaign: needsInput(),
      pillars: needsInput(),
    },
    markets: [],
    competitors: needsInput(),
    mediaPlan: {
      sequencing: [],
      seasonalPhases: [],
    },
    budget: {
      total: needsInput(),
      barterSavings: needsInput(),
      lineItems: needsInput(),
    },
  };
}
