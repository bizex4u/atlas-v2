import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createEvidenceStore,
  EvidenceStoreAbortedError,
  hashContent,
  stableEvidenceId,
} from '../../evidence/index.js';
import type { EvidenceInput } from '../../evidence/types.js';

function draft(
  overrides: Partial<EvidenceInput> &
    Pick<EvidenceInput, 'canonicalUrl' | 'extractedText'>,
): EvidenceInput {
  return {
    title: 'Bata India story',
    publishedAt: '2024-01-01T00:00:00Z',
    retrievalMethod: 'publisher_search',
    language: 'en',
    brand: 'Bata India',
    rawContent: '<html><article>body</article></html>',
    metadata: { sourceLabel: 'Test' },
    ...overrides,
  };
}

describe('EvidenceStore', () => {
  it('add + get round-trip with stable id', () => {
    const store = createEvidenceStore();
    const url = 'https://news.example.com/business/bata-fy24.html';
    const stored = store.add(
      draft({
        canonicalUrl: url,
        extractedText: 'Bata India revenue grew in FY24. '.repeat(20),
      }),
    );

    assert.equal(stored.id, stableEvidenceId(stored.canonicalUrl));
    assert.equal(store.get(stored.id)?.canonicalUrl, stored.canonicalUrl);
    assert.equal(store.size(), 1);
  });

  it('getMany returns only known ids in request order', () => {
    const store = createEvidenceStore();
    const a = store.add(
      draft({
        canonicalUrl: 'https://example.com/a',
        extractedText: 'alpha '.repeat(50),
      }),
    );
    const b = store.add(
      draft({
        canonicalUrl: 'https://example.com/b',
        extractedText: 'bravo '.repeat(50),
      }),
    );

    const many = store.getMany([b.id, 'missing', a.id]);
    assert.deepEqual(
      many.map((d) => d.id),
      [b.id, a.id],
    );
  });

  it('dedupes duplicate normalized URLs and keeps higher quality', () => {
    const store = createEvidenceStore();
    const first = store.add(
      draft({
        canonicalUrl: 'https://Example.com/story/?utm_source=x',
        title: null,
        publishedAt: null,
        extractedText: 'short body '.repeat(30),
      }),
    );
    const second = store.add(
      draft({
        canonicalUrl: 'https://example.com/story',
        title: 'Full title',
        publishedAt: '2024-06-01T00:00:00Z',
        extractedText: 'much longer richer article body '.repeat(40),
      }),
    );

    assert.equal(store.size(), 1);
    assert.equal(second.id, first.id);
    const kept = store.get(first.id)!;
    assert.equal(kept.title, 'Full title');
    assert.ok(kept.extractedText.length > first.extractedText.length);
  });

  it('dedupes duplicate content hashes across different URLs', () => {
    const store = createEvidenceStore();
    const body = 'Identical Bata India article body content. '.repeat(25);
    const a = store.add(
      draft({
        canonicalUrl: 'https://publisher-a.com/one',
        extractedText: body,
      }),
    );
    const b = store.add(
      draft({
        canonicalUrl: 'https://publisher-b.com/two',
        extractedText: `  ${body.toUpperCase()}  `,
        title: 'Richer title',
      }),
    );

    assert.equal(hashContent(body), hashContent(`  ${body.toUpperCase()}  `));
    assert.equal(store.size(), 1);
    assert.equal(b.id, a.id);
    assert.equal(store.get(a.id)?.title, 'Richer title');
  });

  it('canonical merge preserves earliest retrievedAt', () => {
    const store = createEvidenceStore();
    store.add(
      draft({
        canonicalUrl: 'https://example.com/merge',
        extractedText: 'x'.repeat(300),
        retrievedAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    const merged = store.add(
      draft({
        canonicalUrl: 'https://example.com/merge',
        extractedText: 'y'.repeat(600),
        retrievedAt: '2026-07-01T00:00:00.000Z',
        title: 'Later fetch',
      }),
    );

    assert.equal(merged.retrievedAt, '2026-01-01T00:00:00.000Z');
    assert.equal(merged.title, 'Later fetch');
  });

  it('findByBrand is case-insensitive', () => {
    const store = createEvidenceStore();
    store.add(
      draft({
        canonicalUrl: 'https://example.com/bata',
        brand: 'Bata India',
        extractedText: 'Bata '.repeat(80),
      }),
    );
    store.add(
      draft({
        canonicalUrl: 'https://example.com/campus',
        brand: 'Campus Shoes',
        extractedText: 'Campus '.repeat(80),
      }),
    );

    assert.equal(store.findByBrand('bata india').length, 1);
    assert.equal(store.findByBrand('Campus Shoes').length, 1);
  });

  it('findByDomain strips www', () => {
    const store = createEvidenceStore();
    store.add(
      draft({
        canonicalUrl: 'https://www.news.example.com/a',
        domain: 'news.example.com',
        extractedText: 'd '.repeat(100),
      }),
    );

    assert.equal(store.findByDomain('www.news.example.com').length, 1);
    assert.equal(store.findByDomain('news.example.com').length, 1);
  });

  it('findByRetrievalMethod filters correctly', () => {
    const store = createEvidenceStore();
    store.add(
      draft({
        canonicalUrl: 'https://brand.example/about',
        retrievalMethod: 'brand_site',
        extractedText: 'about '.repeat(80),
      }),
    );
    store.add(
      draft({
        canonicalUrl: 'https://news.example/story',
        retrievalMethod: 'publisher_search',
        extractedText: 'story '.repeat(80),
      }),
    );

    assert.equal(store.findByRetrievalMethod('brand_site').length, 1);
    assert.equal(store.findByRetrievalMethod('publisher_search').length, 1);
    assert.equal(store.findByRetrievalMethod('direct_url').length, 0);
  });

  it('all() + size() + clear() iteration contract', () => {
    const store = createEvidenceStore();
    store.add(
      draft({
        canonicalUrl: 'https://example.com/1',
        extractedText: 'one '.repeat(80),
      }),
    );
    store.add(
      draft({
        canonicalUrl: 'https://example.com/2',
        extractedText: 'two '.repeat(80),
      }),
    );

    assert.equal(store.size(), 2);
    assert.equal(store.all().length, 2);
    store.clear();
    assert.equal(store.size(), 0);
    assert.deepEqual(store.all(), []);
  });

  it('throws EvidenceStoreAbortedError when signal is aborted', () => {
    const store = createEvidenceStore();
    const controller = new AbortController();
    controller.abort();

    assert.throws(
      () =>
        store.add(
          draft({
            canonicalUrl: 'https://example.com/aborted',
            extractedText: 'x'.repeat(300),
          }),
          { signal: controller.signal },
        ),
      (err: unknown) => err instanceof EvidenceStoreAbortedError,
    );

    assert.throws(
      () => store.size({ signal: controller.signal }),
      (err: unknown) => err instanceof EvidenceStoreAbortedError,
    );

    assert.equal(store.size(), 0);
  });

  it('same article twice returns the same id', () => {
    const store = createEvidenceStore();
    const url = 'https://news.example.com/identical-article';
    const body = 'Stable id body for Bata India. '.repeat(30);
    const a = store.add(
      draft({ canonicalUrl: url, extractedText: body }),
    );
    const b = store.add(
      draft({
        canonicalUrl: url + '?utm_medium=email',
        extractedText: body,
      }),
    );

    assert.equal(a.id, b.id);
    assert.equal(store.size(), 1);
  });
});
