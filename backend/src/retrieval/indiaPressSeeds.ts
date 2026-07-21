import { normalizeBrandKey } from './aliases.js';
import { normalizeUrl } from './normalize.js';
import type { CandidateLink } from './types.js';

/**
 * Curated India-entity article URLs.
 *
 * Used when DuckDuckGo HTML is bot-challenged and on-site publisher search
 * returns homepage noise / robots blocks. Prefer India trade press + company
 * pages — never the global parent Wikipedia page.
 */
const SEEDS: Record<string, Array<{ url: string; title: string }>> = {
  'bata india': [
    {
      url: 'https://economictimes.indiatimes.com/bata-india-ltd/directorsreport/companyid-13974.cms',
      title: 'Bata India Limited Directors Report',
    },
    {
      url: 'https://www.exchange4media.com/pr-and-corporate-communication-news/bata-india-appoints-one-source-to-lead-its-next-phase-of-corporate-reputation-building-150404.html',
      title: 'Bata India appoints One Source',
    },
    {
      url: 'https://mediabrief.com/bata-india-appoints-one-source-to-lead-corporate-reputation-strategy/',
      title: 'Bata India corporate reputation strategy',
    },
    {
      url: 'https://www.afaqs.com/corporate-communications-and-pr/bata-india-appoints-one-source-to-lead-corporate-communication-mandate-10913886',
      title: 'Bata India corporate communication mandate',
    },
    {
      url: 'https://www.medianews4u.com/bata-india-partners-one-source-to-strengthen-corporate-reputation-and-leadership-visibility/',
      title: 'Bata India partners One Source',
    },
  ],
  bata: [
    {
      url: 'https://economictimes.indiatimes.com/bata-india-ltd/directorsreport/companyid-13974.cms',
      title: 'Bata India Limited Directors Report',
    },
    {
      url: 'https://mediabrief.com/bata-india-appoints-one-source-to-lead-corporate-reputation-strategy/',
      title: 'Bata India corporate reputation strategy',
    },
    {
      url: 'https://www.exchange4media.com/pr-and-corporate-communication-news/bata-india-appoints-one-source-to-lead-its-next-phase-of-corporate-reputation-building-150404.html',
      title: 'Bata India appoints One Source',
    },
  ],
  britannia: [
    {
      url: 'https://en.wikipedia.org/wiki/Britannia_Industries',
      title: 'Britannia Industries',
    },
    {
      url: 'https://www.exchange4media.com/marketing-news/the-maddies-2025-britannia-takes-home-9-metals-for-its-impressive-work-149870.html',
      title: 'Britannia Maddies 2025',
    },
    {
      url: 'https://www.exchange4media.com/marketing-news/ima-2023-britannia-industries-ltd-bags-marketing-team-of-the-year-title-132298.html',
      title: 'Britannia Marketing Team of the Year',
    },
    {
      url: 'https://www.afaqs.com/news/media/36062_britannia-closes-media-pitch-mec-bags-the-business',
      title: 'Britannia media pitch MEC',
    },
  ],
  'britannia industries': [
    {
      url: 'https://en.wikipedia.org/wiki/Britannia_Industries',
      title: 'Britannia Industries',
    },
    {
      url: 'https://www.exchange4media.com/marketing-news/ima-2023-britannia-industries-ltd-bags-marketing-team-of-the-year-title-132298.html',
      title: 'Britannia Marketing Team of the Year',
    },
    {
      url: 'https://www.exchange4media.com/marketing-news/the-maddies-2025-britannia-takes-home-9-metals-for-its-impressive-work-149870.html',
      title: 'Britannia Maddies 2025',
    },
  ],
  giva: [
    {
      url: 'https://www.afaqs.com/news/mktg/giva-brings-back-artificial-do-silver-lo-campaign-with-kriti-sanon-12030322',
      title: 'GIVA Artificial Do Silver Lo campaign',
    },
    {
      url: 'https://mediabrief.com/giva-brings-back-exchange-fest-across-350-stores/',
      title: 'GIVA Exchange Fest 350 stores',
    },
    {
      url: 'https://retail.economictimes.indiatimes.com/news/apparel-fashion/jewellery/giva-rolls-out-jewellery-exchange-programme-across-350-stores-nationwide/131683085',
      title: 'GIVA jewellery exchange programme',
    },
  ],
};

/** Topic / tag listing pages that often yield brand-named article links. */
function topicListingUrls(brandName: string): string[] {
  const slug = brandName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!slug) return [];
  return [
    `https://economictimes.indiatimes.com/topic/${encodeURIComponent(brandName)}`,
    `https://economictimes.indiatimes.com/topic/${slug}`,
  ];
}

/**
 * High-confidence India press / company-page seeds for the brand.
 * Always prefer these over noisy on-site SERP links.
 */
export function indiaPressSeedCandidates(brandName: string): CandidateLink[] {
  const key = normalizeBrandKey(brandName);
  const rows = SEEDS[key] ?? [];
  const out: CandidateLink[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const url = normalizeUrl(row.url) ?? row.url;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      title: row.title,
      sourceLabel: 'india_press_seed',
      retrievalMethod: 'publisher_search',
    });
  }

  return out;
}

/** Listing pages used to discover additional India press URLs. */
export function indiaTopicListingCandidates(brandName: string): CandidateLink[] {
  return topicListingUrls(brandName).map((url) => ({
    url,
    title: `${brandName} topic`,
    sourceLabel: 'topic_listing',
    retrievalMethod: 'publisher_search' as const,
  }));
}
