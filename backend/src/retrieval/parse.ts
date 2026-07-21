import * as cheerio from 'cheerio';
import {
  domainOf,
  isProbablyArticleUrl,
  isSearchOrListingUrl,
  normalizeUrl,
} from './normalize.js';
import type { CandidateLink } from './types.js';

const BLOCKED_HOST_FRAGMENTS = [
  'facebook.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'youtube.com',
  'linkedin.com',
  'whatsapp.com',
];

/**
 * Extract candidate article links from a publisher search/topic HTML page.
 * Does NOT treat the search page itself as article evidence.
 */
export function extractArticleLinksFromHtml(
  html: string,
  pageUrl: string,
  sourceLabel: string,
): CandidateLink[] {
  const $ = cheerio.load(html);
  const baseDomain = domainOf(pageUrl);
  const found: CandidateLink[] = [];
  const seen = new Set<string>();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const absolute = normalizeUrl(href, pageUrl);
    if (!absolute) return;
    if (seen.has(absolute)) return;

    const host = domainOf(absolute);
    if (BLOCKED_HOST_FRAGMENTS.some((b) => host.includes(b))) return;

    // Prefer same publisher domain for topic/search pages
    if (baseDomain && host && !host.endsWith(baseDomain) && !baseDomain.endsWith(host)) {
      return;
    }

    if (isSearchOrListingUrl(absolute)) return;
    if (!isProbablyArticleUrl(absolute)) return;

    seen.add(absolute);
    const title = $(el).text().replace(/\s+/g, ' ').trim() || null;
    found.push({
      url: absolute,
      title: title && title.length > 8 ? title.slice(0, 200) : null,
      sourceLabel,
      retrievalMethod: 'publisher_search',
    });
  });

  return found;
}

/**
 * Best-effort title + published time from article HTML.
 */
export function extractArticleMeta(html: string): {
  title: string | null;
  publishedAt: string | null;
  language: string | null;
  description: string | null;
} {
  const $ = cheerio.load(html);

  const ogTitle =
    $('meta[property="og:title"]').attr('content')?.trim() ||
    $('meta[name="twitter:title"]').attr('content')?.trim() ||
    $('title').first().text().replace(/\s+/g, ' ').trim() ||
    null;

  const description =
    $('meta[property="og:description"]').attr('content')?.trim() ||
    $('meta[name="description"]').attr('content')?.trim() ||
    $('meta[name="twitter:description"]').attr('content')?.trim() ||
    null;

  const published =
    $('meta[property="article:published_time"]').attr('content')?.trim() ||
    $('meta[name="publish-date"]').attr('content')?.trim() ||
    $('meta[name="pubdate"]').attr('content')?.trim() ||
    $('time[datetime]').first().attr('datetime')?.trim() ||
    null;

  const lang =
    $('html').attr('lang')?.trim() ||
    $('meta[http-equiv="content-language"]').attr('content')?.trim() ||
    null;

  return {
    title: ogTitle,
    publishedAt: published,
    language: lang ? lang.slice(0, 16) : null,
    description: description || null,
  };
}

/**
 * Prefer article body containers when present; fall back to visible body text.
 */
export function extractArticleText(html: string, maxChars = 14000): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg, iframe, nav, footer, header, aside').remove();

  const candidates = [
    'article',
    '[role="main"]',
    'main',
    '.article-body',
    '.story-content',
    '.content',
  ];

  for (const sel of candidates) {
    const node = $(sel).first();
    if (node.length) {
      const text = node.text().replace(/\s+/g, ' ').trim();
      if (text.length > 400) return text.slice(0, maxChars);
    }
  }

  return $('body').text().replace(/\s+/g, ' ').trim().slice(0, maxChars);
}
