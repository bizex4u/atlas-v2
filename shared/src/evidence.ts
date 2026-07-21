/**
 * Structured evidence produced by the Retrieval Layer and held in Evidence Store.
 * Downstream agents consume evidence by id — they do not web-search.
 */
export type RetrievalMethod =
  | 'publisher_search'
  | 'brand_site'
  | 'direct_url';

/**
 * Opaque bag for retrieval provenance that is not part of the core fact model.
 * Keep this open so adapters (Playwright, search APIs) can attach fields later.
 */
export type EvidenceMetadata = {
  sourceLabel?: string;
  httpStatus?: number;
  contentType?: string;
  [key: string]: unknown;
};

export type Evidence = {
  id: string;
  /** Final resolved URL after redirects (stable identity basis). */
  canonicalUrl: string;
  /** Tracking-stripped, lowercased-host form used for URL dedupe. */
  normalizedUrl: string;
  title: string | null;
  domain: string;
  publishedAt: string | null;
  retrievedAt: string;
  retrievalMethod: RetrievalMethod;
  language: string | null;
  /** Brand this evidence was retrieved for (orchestration scope). */
  brand: string;
  contentHash: string;
  rawContent: string;
  extractedText: string;
  metadata: EvidenceMetadata;
};
