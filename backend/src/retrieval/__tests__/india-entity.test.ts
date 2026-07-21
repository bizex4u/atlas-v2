import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { expandBrandAliases } from '../aliases.js';
import { indiaPressSeedCandidates } from '../indiaPressSeeds.js';
import { discoverWikipediaCandidates } from '../wikipedia.js';

describe('wikipedia India entity preference', () => {
  it('does not return Bata_Corporation or Bataan for Bata India', async () => {
    const hits = await discoverWikipediaCandidates({
      brandName: 'Bata India',
    });
    for (const h of hits) {
      assert.doesNotMatch(h.url, /Bata_Corporation/i);
      assert.doesNotMatch(h.title ?? '', /Corporation/i);
      assert.doesNotMatch(h.title ?? '', /Bataan/i);
    }
  });

  it('resolves Britannia Industries wiki for Britannia', async () => {
    const hits = await discoverWikipediaCandidates({
      brandName: 'Britannia',
    });
    assert.ok(hits.length > 0);
    assert.match(hits[0].url, /Britannia_Industries/i);
  });
});

describe('india press seeds', () => {
  it('returns multiple India press URLs for Bata India', () => {
    const seeds = indiaPressSeedCandidates('Bata India');
    assert.ok(seeds.length >= 4);
    assert.ok(seeds.every((s) => /bata/i.test(s.url)));
    assert.ok(
      seeds.some((s) =>
        /mediabrief|exchange4media|afaqs|economictimes/i.test(s.url),
      ),
    );
    assert.ok(seeds.every((s) => !/Bata_Corporation/i.test(s.url)));
  });

  it('expands Bata India aliases without Corporation', () => {
    const aliases = expandBrandAliases('Bata India');
    assert.ok(aliases.some((a) => /bata/i.test(a)));
    assert.ok(aliases.every((a) => !/corporation/i.test(a)));
  });
});
