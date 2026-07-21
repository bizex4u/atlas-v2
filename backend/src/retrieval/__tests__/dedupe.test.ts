import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Evidence } from '@atlas/shared';
import { hashContent, stableEvidenceId } from '../../evidence/ids.js';
import { dedupeCandidateUrls, dedupeEvidence } from '../dedupe.js';

function makeEvidence(
  overrides: Partial<Evidence> &
    Pick<Evidence, 'id' | 'canonicalUrl' | 'extractedText'>,
): Evidence {
  const canonicalUrl = overrides.canonicalUrl;
  const normalizedUrl =
    overrides.normalizedUrl ?? canonicalUrl.replace(/\/?\?.*$/, '');
  const extractedText = overrides.extractedText;
  return {
    title: 't',
    domain: 'example.com',
    publishedAt: null,
    retrievedAt: '2026-07-20T00:00:00.000Z',
    retrievalMethod: 'publisher_search',
    language: 'en',
    brand: 'Bata India',
    contentHash: hashContent(extractedText),
    rawContent: '<html></html>',
    normalizedUrl,
    metadata: {},
    ...overrides,
    canonicalUrl,
    extractedText,
  };
}

describe('stableEvidenceId / hashContent', () => {
  it('is stable for the same URL', () => {
    const a = stableEvidenceId('https://example.com/a');
    const b = stableEvidenceId('https://example.com/a');
    assert.equal(a, b);
    assert.equal(a.length, 24);
  });

  it('differs across URLs', () => {
    assert.notEqual(
      stableEvidenceId('https://example.com/a'),
      stableEvidenceId('https://example.com/b'),
    );
  });

  it('fingerprints normalize whitespace and case', () => {
    const a = hashContent('Bata India  Revenue');
    const b = hashContent('  bata india revenue  ');
    assert.equal(a, b);
  });
});

describe('dedupeCandidateUrls', () => {
  it('dedupes by normalized URL and drops invalids', () => {
    const out = dedupeCandidateUrls([
      'https://Example.com/a/?utm_source=x',
      'https://example.com/a',
      'javascript:void(0)',
      'https://example.com/b',
    ]);
    assert.deepEqual(out, [
      'https://example.com/a',
      'https://example.com/b',
    ]);
  });
});

describe('dedupeEvidence', () => {
  it('keeps a single doc per normalized URL, preferring longer text', () => {
    const short = makeEvidence({
      id: '1',
      canonicalUrl: 'https://example.com/story/?utm_campaign=x',
      normalizedUrl: 'https://example.com/story',
      extractedText: 'a'.repeat(100),
    });
    const longer = makeEvidence({
      id: '2',
      canonicalUrl: 'https://example.com/story',
      normalizedUrl: 'https://example.com/story',
      extractedText: 'b'.repeat(500),
    });

    const out = dedupeEvidence([short, longer]);
    assert.equal(out.length, 1);
    assert.equal(out[0].id, '2');
    assert.equal(out[0].extractedText.length, 500);
  });

  it('collapses near-identical bodies across different URLs', () => {
    const body = 'Bata India reported revenue growth in FY24. '.repeat(20);
    const a = makeEvidence({
      id: 'a',
      canonicalUrl: 'https://publisher-a.com/article-1',
      extractedText: body,
    });
    const b = makeEvidence({
      id: 'b',
      canonicalUrl: 'https://publisher-b.com/article-1-mirror',
      extractedText: `  ${body.toUpperCase()}  `,
    });

    const out = dedupeEvidence([a, b]);
    assert.equal(out.length, 1);
  });

  it('keeps short docs distinct even with similar text', () => {
    const a = makeEvidence({
      id: 's1',
      canonicalUrl: 'https://example.com/short-1',
      extractedText: 'short body one',
    });
    const b = makeEvidence({
      id: 's2',
      canonicalUrl: 'https://example.com/short-2',
      extractedText: 'short body one',
    });

    const out = dedupeEvidence([a, b]);
    assert.equal(out.length, 2);
  });
});
