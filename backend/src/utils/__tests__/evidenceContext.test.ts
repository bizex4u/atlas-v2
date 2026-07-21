import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Evidence } from '@atlas/shared';
import { hashContent, stableEvidenceId } from '../../evidence/ids.js';
import {
  buildEvidenceContext,
  dedupeForContext,
  scoreEvidence,
} from '../evidenceContext.js';
import { buildUserMessage } from '../llm.js';

function makeDoc(
  overrides: Partial<Evidence> &
    Pick<Evidence, 'canonicalUrl' | 'extractedText' | 'title'>,
): Evidence {
  const canonicalUrl = overrides.canonicalUrl;
  const extractedText = overrides.extractedText;
  return {
    id: stableEvidenceId(canonicalUrl),
    normalizedUrl: canonicalUrl,
    domain: 'example.com',
    publishedAt: '2024-06-01T00:00:00Z',
    retrievedAt: '2026-07-20T00:00:00Z',
    retrievalMethod: 'publisher_search',
    language: 'en',
    brand: 'Bata India',
    contentHash: hashContent(extractedText),
    rawContent: `<html>${extractedText}</html>`,
    metadata: {},
    ...overrides,
    canonicalUrl,
    extractedText,
  };
}

describe('scoreEvidence / dedupeForContext', () => {
  it('ranks query-relevant docs higher', () => {
    const query = ['bata', 'india', 'revenue'];
    const relevant = makeDoc({
      canonicalUrl: 'https://a.com/1',
      title: 'Bata India revenue',
      extractedText: 'Bata India revenue grew in FY24 across India stores. '.repeat(10),
    });
    const irrelevant = makeDoc({
      canonicalUrl: 'https://a.com/2',
      title: 'Unrelated cement news',
      extractedText: 'Cement industry outlook for Europe. '.repeat(10),
      publishedAt: '2024-06-01T00:00:00Z',
    });

    assert.ok(scoreEvidence(relevant, query) > scoreEvidence(irrelevant, query));
  });

  it('dedupes by URL keeping higher score', () => {
    const weak = makeDoc({
      canonicalUrl: 'https://example.com/story',
      title: null,
      extractedText: 'short bata india note. '.repeat(5),
    });
    const strong = makeDoc({
      canonicalUrl: 'https://example.com/story',
      title: 'Bata India deep dive',
      extractedText: 'Bata India revenue and stores detailed analysis. '.repeat(20),
    });
    const scoreOf = (d: Evidence) => scoreEvidence(d, ['bata', 'india']);
    const out = dedupeForContext([weak, strong], scoreOf);
    assert.equal(out.length, 1);
    assert.equal(out[0].title, 'Bata India deep dive');
  });

  it('dedupes by content hash across URLs', () => {
    const body = 'Identical Bata India article body for testing. '.repeat(20);
    const a = makeDoc({
      canonicalUrl: 'https://pub-a.com/1',
      title: 'A',
      extractedText: body,
    });
    const b = makeDoc({
      canonicalUrl: 'https://pub-b.com/2',
      title: 'B richer',
      extractedText: `  ${body.toUpperCase()}  `,
    });
    const scoreOf = (d: Evidence) => scoreEvidence(d, ['bata']);
    const out = dedupeForContext([a, b], scoreOf);
    assert.equal(out.length, 1);
  });
});

describe('buildEvidenceContext', () => {
  it('formats title, url, publishedAt, id — never raw HTML', () => {
    const doc = makeDoc({
      canonicalUrl: 'https://news.example.com/bata-fy24',
      title: 'Bata India FY24',
      extractedText: 'Bata India Limited revenue results. '.repeat(30),
      publishedAt: '2024-05-15T00:00:00Z',
      rawContent: '<html><script>evil()</script><article>secret</article></html>',
    });

    const ctx = buildEvidenceContext([doc], { query: 'Bata India revenue' });
    assert.ok(ctx.text.includes('id=' + doc.id));
    assert.ok(ctx.text.includes('url: https://news.example.com/bata-fy24'));
    assert.ok(ctx.text.includes('publishedAt: 2024-05-15T00:00:00Z'));
    assert.ok(ctx.text.includes('Bata India Limited revenue'));
    assert.equal(ctx.text.includes('<script>'), false);
    assert.equal(ctx.text.includes('evil()'), false);
    assert.deepEqual(ctx.evidenceIds, [doc.id]);
  });

  it('respects token budget / truncation', () => {
    const docs = Array.from({ length: 10 }, (_, i) =>
      makeDoc({
        canonicalUrl: `https://example.com/doc-${i}`,
        title: `Bata India piece ${i}`,
        extractedText: `Bata India content block ${i}. `.repeat(200),
        publishedAt: `2024-0${(i % 9) + 1}-01T00:00:00Z`,
      }),
    );

    const ctx = buildEvidenceContext(docs, {
      query: 'Bata India',
      maxTokens: 800,
      maxDocuments: 10,
      maxCharsPerDoc: 500,
    });

    assert.ok(ctx.estimatedTokens <= 850);
    assert.ok(ctx.selected.length >= 1);
    assert.ok(ctx.selected.length < docs.length);
  });

  it('returns empty evidence guidance when no docs', () => {
    const ctx = buildEvidenceContext([]);
    assert.match(ctx.text, /none provided/i);
    assert.deepEqual(ctx.evidenceIds, []);
  });

  it('is provider-independent (pure function of Evidence[])', () => {
    const docs = [
      makeDoc({
        canonicalUrl: 'https://example.com/a',
        title: 'Bata',
        extractedText: 'Bata India stores in Mumbai. '.repeat(20),
      }),
    ];
    const a = buildEvidenceContext(docs, { query: 'Bata' });
    const b = buildEvidenceContext(docs, { query: 'Bata' });
    assert.equal(a.text, b.text);
    assert.deepEqual(a.evidenceIds, b.evidenceIds);
  });
});

describe('buildUserMessage', () => {
  it('orders evidence then prompt then schema', () => {
    const msg = buildUserMessage({
      evidenceText: 'EVIDENCE:\n[Evidence 1]',
      prompt: 'Extract revenue.',
      schema: '{ "revenue": string|null }',
    });
    const evidenceAt = msg.indexOf('EVIDENCE:');
    const promptAt = msg.indexOf('Extract revenue.');
    const schemaAt = msg.indexOf('{ "revenue"');
    assert.ok(evidenceAt < promptAt && promptAt < schemaAt);
  });
});
