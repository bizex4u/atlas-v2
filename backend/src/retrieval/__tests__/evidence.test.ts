import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Evidence } from '@atlas/shared';
import { hashContent, stableEvidenceId } from '../../evidence/ids.js';
import {
  extractArticleLinksFromHtml,
  extractArticleMeta,
  extractArticleText,
} from '../parse.js';
import { materializeEvidence, MIN_ARTICLE_CHARS } from '../materialize.js';
import { isBrandRelevant } from '../relevance.js';
import type { CandidateLink } from '../types.js';

const CANDIDATE: CandidateLink = {
  url: 'https://news.example.com/business/bata-india-fy24-results.html',
  title: 'Fallback title from SERP',
  sourceLabel: 'Example News',
  retrievalMethod: 'publisher_search',
};

function articleHtml(opts?: {
  title?: string;
  publishedAt?: string;
  lang?: string;
  body?: string;
}): string {
  const title = opts?.title ?? 'Bata India reports FY24 revenue growth';
  const published = opts?.publishedAt ?? '2024-05-15T10:00:00Z';
  const lang = opts?.lang ?? 'en-IN';
  const body =
    opts?.body ??
    'Bata India Limited posted strong revenue in the footwear retail segment across India. '.repeat(
      8,
    );

  return `<!doctype html>
<html lang="${lang}">
  <head>
    <meta property="og:title" content="${title}" />
    <meta property="article:published_time" content="${published}" />
    <title>Ignored title tag</title>
  </head>
  <body>
    <nav>Home About</nav>
    <article>${body}</article>
    <footer>Copyright</footer>
  </body>
</html>`;
}

describe('extractArticleMeta', () => {
  it('reads og:title, published time, and language', () => {
    const meta = extractArticleMeta(
      articleHtml({
        title: 'Bata India Q4',
        publishedAt: '2024-01-02T00:00:00Z',
        lang: 'en',
      }),
    );
    assert.equal(meta.title, 'Bata India Q4');
    assert.equal(meta.publishedAt, '2024-01-02T00:00:00Z');
    assert.equal(meta.language, 'en');
  });
});

describe('extractArticleText', () => {
  it('prefers article body and strips nav/footer', () => {
    const text = extractArticleText(articleHtml());
    assert.match(text, /Bata India Limited/);
    assert.doesNotMatch(text, /Copyright/);
    assert.ok(text.length > 400);
  });

  it('respects maxChars', () => {
    const text = extractArticleText(articleHtml(), 50);
    assert.equal(text.length, 50);
  });
});

describe('extractArticleLinksFromHtml', () => {
  it('extracts same-domain article links and skips search/social/hubs', () => {
    const html = `
      <html><body>
        <a href="/marketing-news/bata-india-opens-store-12345.html">Bata India opens store in Pune</a>
        <a href="/?s=bata">Search bata</a>
        <a href="https://facebook.com/share">Share</a>
        <a href="/advertising-news.html">Advertising news hub</a>
        <a href="https://other-publisher.com/story/x.html">Other domain</a>
      </body></html>
    `;
    const links = extractArticleLinksFromHtml(
      html,
      'https://www.exchange4media.com/?s=bata',
      'Exchange4media',
    );

    assert.equal(links.length, 1);
    assert.equal(
      links[0].url,
      'https://www.exchange4media.com/marketing-news/bata-india-opens-store-12345.html',
    );
    assert.equal(links[0].retrievalMethod, 'publisher_search');
    assert.equal(links[0].sourceLabel, 'Exchange4media');
    assert.match(links[0].title ?? '', /Bata India opens store/);
  });
});

describe('materializeEvidence', () => {
  it('builds a complete Evidence object from HTML', () => {
    const html = articleHtml();
    const doc = materializeEvidence({
      html,
      finalUrl: CANDIDATE.url + '?utm_source=test',
      candidate: CANDIDATE,
      brand: 'Bata India',
      retrievedAt: '2026-07-20T12:00:00.000Z',
    });

    assert.ok(doc);
    assert.equal(
      doc!.canonicalUrl,
      'https://news.example.com/business/bata-india-fy24-results.html',
    );
    assert.equal(doc!.normalizedUrl, doc!.canonicalUrl);
    assert.equal(doc!.domain, 'news.example.com');
    assert.equal(doc!.title, 'Bata India reports FY24 revenue growth');
    assert.equal(doc!.publishedAt, '2024-05-15T10:00:00Z');
    assert.equal(doc!.language, 'en-IN');
    assert.equal(doc!.brand, 'Bata India');
    assert.equal(doc!.retrievalMethod, 'publisher_search');
    assert.equal(doc!.retrievedAt, '2026-07-20T12:00:00.000Z');
    assert.equal(doc!.id, stableEvidenceId(doc!.canonicalUrl));
    assert.equal(doc!.contentHash, hashContent(doc!.extractedText));
    assert.equal(doc!.metadata.sourceLabel, 'Example News');
    assert.ok(doc!.extractedText.length >= MIN_ARTICLE_CHARS);
    assert.ok(doc!.rawContent.includes('<article>'));
  });

  it('returns null when body is too short', () => {
    const html = articleHtml({ body: 'Too short.' });
    const doc = materializeEvidence({
      html,
      finalUrl: CANDIDATE.url,
      candidate: CANDIDATE,
      brand: 'Bata India',
    });
    assert.equal(doc, null);
  });

  it('falls back to candidate title when meta title missing', () => {
    const html = `<html><body><article>${'x'.repeat(300)}</article></body></html>`;
    const doc = materializeEvidence({
      html,
      finalUrl: CANDIDATE.url,
      candidate: CANDIDATE,
      brand: 'Bata India',
    });
    assert.ok(doc);
    assert.equal(doc!.title, 'Fallback title from SERP');
  });
});

describe('isBrandRelevant', () => {
  function doc(
    partial: Partial<Evidence> & Pick<Evidence, 'extractedText'>,
  ): Evidence {
    return {
      id: 'x',
      title: null,
      canonicalUrl: 'https://example.com/a',
      normalizedUrl: 'https://example.com/a',
      domain: 'example.com',
      publishedAt: null,
      retrievedAt: '2026-07-20T00:00:00.000Z',
      retrievalMethod: 'publisher_search',
      language: 'en',
      brand: 'Bata India',
      contentHash: 'abc',
      rawContent: '',
      metadata: {},
      ...partial,
    };
  }

  it('always accepts brand_site documents', () => {
    assert.equal(
      isBrandRelevant(
        doc({
          retrievalMethod: 'brand_site',
          extractedText: 'Welcome to our store locator',
        }),
        'Bata India',
      ),
      true,
    );
  });

  it('requires primary brand token for publisher docs', () => {
    assert.equal(
      isBrandRelevant(
        doc({ extractedText: 'UltraTech Cement reappoints CMO' }),
        'Bata India',
      ),
      false,
    );
  });

  it('accepts Bata alone via alias without requiring India', () => {
    assert.equal(
      isBrandRelevant(
        doc({ extractedText: 'Bata reported growth in Europe markets and new shoe lines' }),
        'Bata India',
      ),
      true,
    );
    assert.equal(
      isBrandRelevant(
        doc({
          title: 'Bata Limited FY24',
          extractedText: 'Footwear retail results for Bata Limited across stores',
        }),
        'Bata India',
      ),
      true,
    );
    assert.equal(
      isBrandRelevant(
        doc({
          title: 'Bata India FY24',
          extractedText: 'Footwear retail results for Bata India Limited',
        }),
        'Bata India',
      ),
      true,
    );
  });
});
