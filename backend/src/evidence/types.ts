import type { Evidence, EvidenceMetadata, RetrievalMethod } from '@atlas/shared';

/**
 * Input accepted by EvidenceStore.add.
 * Store fills id, normalizedUrl, contentHash when omitted.
 */
export type EvidenceInput = {
  canonicalUrl: string;
  /** Optional; store will normalize from canonicalUrl when omitted. */
  normalizedUrl?: string;
  title: string | null;
  domain?: string;
  publishedAt: string | null;
  retrievedAt?: string;
  retrievalMethod: RetrievalMethod;
  language: string | null;
  brand: string;
  rawContent: string;
  extractedText: string;
  metadata?: EvidenceMetadata;
  /** Optional precomputed id — must match stableEvidenceId(canonicalUrl). */
  id?: string;
  contentHash?: string;
};

export type StoreOptions = {
  signal?: AbortSignal;
};

/**
 * Request-scoped evidence repository.
 *
 * Backing store is pluggable: today in-memory; later Redis / Postgres / vector DB
 * without changing agent call sites.
 */
export interface EvidenceStore {
  /**
   * Insert or merge evidence. Returns the stored record (may be an existing
   * higher-quality duplicate with the same stable id).
   */
  add(input: EvidenceInput, options?: StoreOptions): Evidence;

  get(id: string, options?: StoreOptions): Evidence | undefined;

  getMany(ids: string[], options?: StoreOptions): Evidence[];

  findByBrand(brand: string, options?: StoreOptions): Evidence[];

  findByDomain(domain: string, options?: StoreOptions): Evidence[];

  findByRetrievalMethod(
    method: RetrievalMethod,
    options?: StoreOptions,
  ): Evidence[];

  /** Snapshot of all evidence (insertion / merge order not guaranteed). */
  all(options?: StoreOptions): Evidence[];

  size(options?: StoreOptions): number;

  /** Drop all entries — used at end of a run / in tests. */
  clear(options?: StoreOptions): void;
}
