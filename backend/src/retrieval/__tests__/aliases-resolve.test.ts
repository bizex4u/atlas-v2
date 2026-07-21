import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Evidence } from '@atlas/shared';
import {
  brandRootToken,
  expandBrandAliases,
} from '../aliases.js';
import { assessBrandRelevance } from '../relevance.js';
import { buildDomainCandidates } from '../resolveWebsite.js';

describe('expandBrandAliases', () => {
  it('expands Bata India', () => {
    const aliases = expandBrandAliases('Bata India');
    assert.ok(aliases.includes('Bata India'));
    assert.ok(aliases.includes('Bata'));
    assert.ok(aliases.some((a) => /limited/i.test(a)));
  });

  it('expands Third Wave Coffee', () => {
    const aliases = expandBrandAliases('Third Wave Coffee');
    assert.ok(aliases.includes('Third Wave'));
    assert.ok(aliases.some((a) => /roasters/i.test(a)));
  });

  it('expands Apple India to Apple', () => {
    const aliases = expandBrandAliases('Apple India');
    assert.ok(aliases.includes('Apple'));
  });
});

describe('brandRootToken', () => {
  it('uses Bata not India', () => {
    assert.equal(brandRootToken('Bata India').toLowerCase(), 'bata');
  });

  it('does not concatenate full brand for domain root', () => {
    assert.notEqual(brandRootToken('Bata India').toLowerCase(), 'bataindia');
  });
});

describe('buildDomainCandidates', () => {
  it('never emits bataindia.com-style concatenation', () => {
    const domains = buildDomainCandidates('Bata India');
    assert.ok(domains.some((d) => /bata\.in|bata\.com/i.test(d)));
    assert.ok(!domains.some((d) => /bataindia/i.test(d)));
  });
});

describe('assessBrandRelevance aliases', () => {
  function doc(text: string, title?: string): Evidence {
    return {
      id: '1',
      title: title ?? null,
      canonicalUrl: 'https://news.example.com/a',
      normalizedUrl: 'https://news.example.com/a',
      domain: 'news.example.com',
      publishedAt: null,
      retrievedAt: '2026-07-20T00:00:00.000Z',
      retrievalMethod: 'publisher_search',
      language: 'en',
      brand: 'Bata India',
      contentHash: 'x',
      rawContent: '',
      extractedText: text,
      metadata: {},
    };
  }

  it('matches Bata Shoes for Bata India', () => {
    const r = assessBrandRelevance(
      doc(
        'New collection from Bata Shoes hits shelves this week across metros.',
      ),
      'Bata India',
    );
    assert.equal(r.relevant, true);
    assert.match(r.reason, /^accepted_/);
  });

  it('rejects unrelated brands', () => {
    const r = assessBrandRelevance(
      doc('UltraTech Cement announces capacity expansion in Rajasthan.'),
      'Bata India',
    );
    assert.equal(r.relevant, false);
  });
});
