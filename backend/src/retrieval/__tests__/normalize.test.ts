import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  domainOf,
  isProbablyArticleUrl,
  isSearchOrListingUrl,
  normalizeUrl,
} from '../normalize.js';

describe('normalizeUrl', () => {
  it('strips hash and tracking params', () => {
    const out = normalizeUrl(
      'https://WWW.Example.com/path/article/?utm_source=x&utm_medium=y&fbclid=1#section',
    );
    assert.equal(out, 'https://www.example.com/path/article');
  });

  it('resolves relative hrefs against a base', () => {
    const out = normalizeUrl(
      '/news/bata-india-q4-results-2024.html',
      'https://www.exchange4media.com/?s=bata',
    );
    assert.equal(
      out,
      'https://www.exchange4media.com/news/bata-india-q4-results-2024.html',
    );
  });

  it('rejects non-http protocols', () => {
    assert.equal(normalizeUrl('javascript:alert(1)'), null);
    assert.equal(normalizeUrl('mailto:a@b.com'), null);
  });

  it('returns null for invalid URLs', () => {
    assert.equal(normalizeUrl('not a url'), null);
  });

  it('removes trailing slash except root', () => {
    assert.equal(
      normalizeUrl('https://example.com/a/b/'),
      'https://example.com/a/b',
    );
    assert.equal(normalizeUrl('https://example.com/'), 'https://example.com/');
  });
});

describe('domainOf', () => {
  it('strips www prefix', () => {
    assert.equal(domainOf('https://www.bata.in/about'), 'bata.in');
  });

  it('returns empty string for invalid URL', () => {
    assert.equal(domainOf(':::'), '');
  });
});

describe('isProbablyArticleUrl', () => {
  it('accepts multi-segment article paths', () => {
    assert.equal(
      isProbablyArticleUrl(
        'https://www.exchange4media.com/marketing-news/bata-india-campaign-156493.html',
      ),
      true,
    );
  });

  it('rejects search, topic, and hub pages', () => {
    assert.equal(
      isProbablyArticleUrl('https://economictimes.indiatimes.com/topic/bata'),
      false,
    );
    assert.equal(
      isProbablyArticleUrl('https://www.exchange4media.com/advertising-news.html'),
      false,
    );
    assert.equal(
      isProbablyArticleUrl('https://www.example.com/search/results'),
      false,
    );
  });

  it('rejects root and asset URLs', () => {
    assert.equal(isProbablyArticleUrl('https://www.bata.in/'), false);
    assert.equal(
      isProbablyArticleUrl('https://www.example.com/image.jpg'),
      false,
    );
  });
});

describe('isSearchOrListingUrl', () => {
  it('detects query and path search pages', () => {
    assert.equal(
      isSearchOrListingUrl('https://www.exchange4media.com/?s=bata'),
      true,
    );
    assert.equal(
      isSearchOrListingUrl('https://www.example.com/search?q=bata'),
      true,
    );
    assert.equal(
      isSearchOrListingUrl(
        'https://economictimes.indiatimes.com/topic/Bata%20India',
      ),
      true,
    );
  });

  it('allows article URLs', () => {
    assert.equal(
      isSearchOrListingUrl(
        'https://www.exchange4media.com/marketing-news/bata-story-1.html',
      ),
      false,
    );
  });
});
