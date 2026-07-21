import type { Evidence, RetrievalMethod } from '@atlas/shared';
import { domainOf, normalizeUrl } from '../retrieval/normalize.js';
import {
  hashContent,
  preferEvidence,
  stableEvidenceId,
} from './ids.js';
import type { EvidenceInput, EvidenceStore, StoreOptions } from './types.js';

export class EvidenceStoreAbortedError extends Error {
  constructor(message = 'EvidenceStore operation aborted') {
    super(message);
    this.name = 'EvidenceStoreAbortedError';
  }
}

function assertNotAborted(options?: StoreOptions) {
  if (options?.signal?.aborted) {
    throw new EvidenceStoreAbortedError();
  }
}

function buildEvidence(input: EvidenceInput): Evidence {
  const normalized =
    input.normalizedUrl ??
    normalizeUrl(input.canonicalUrl) ??
    input.canonicalUrl;
  const canonical =
    normalizeUrl(input.canonicalUrl) ?? input.canonicalUrl;
  const contentHash =
    input.contentHash ?? hashContent(input.extractedText);
  const id = input.id ?? stableEvidenceId(canonical);

  return {
    id,
    canonicalUrl: canonical,
    normalizedUrl: normalized,
    title: input.title,
    domain: input.domain ?? domainOf(canonical),
    publishedAt: input.publishedAt,
    retrievedAt: input.retrievedAt ?? new Date().toISOString(),
    retrievalMethod: input.retrievalMethod,
    language: input.language,
    brand: input.brand.trim(),
    contentHash,
    rawContent: input.rawContent,
    extractedText: input.extractedText,
    metadata: { ...(input.metadata ?? {}) },
  };
}

/**
 * In-memory, request-scoped Evidence Store.
 * One instance per orchestration run — no persistence.
 */
export class InMemoryEvidenceStore implements EvidenceStore {
  readonly #byId = new Map<string, Evidence>();
  /** normalizedUrl → evidence id */
  readonly #byNormalizedUrl = new Map<string, string>();
  /** contentHash → evidence id (for near-duplicate bodies) */
  readonly #byContentHash = new Map<string, string>();

  add(input: EvidenceInput, options?: StoreOptions): Evidence {
    assertNotAborted(options);

    const incoming = buildEvidence(input);

    const urlExistingId = this.#byNormalizedUrl.get(incoming.normalizedUrl);
    const hashExistingId = this.#byContentHash.get(incoming.contentHash);

    const existingId = urlExistingId ?? hashExistingId;
    if (existingId) {
      const existing = this.#byId.get(existingId);
      if (existing) {
        const winner = this.#merge(existing, incoming);
        this.#index(winner, existing);
        return winner;
      }
    }

    this.#index(incoming);
    return incoming;
  }

  get(id: string, options?: StoreOptions): Evidence | undefined {
    assertNotAborted(options);
    return this.#byId.get(id);
  }

  getMany(ids: string[], options?: StoreOptions): Evidence[] {
    assertNotAborted(options);
    const out: Evidence[] = [];
    for (const id of ids) {
      const doc = this.#byId.get(id);
      if (doc) out.push(doc);
    }
    return out;
  }

  findByBrand(brand: string, options?: StoreOptions): Evidence[] {
    assertNotAborted(options);
    const key = brand.trim().toLowerCase();
    return this.all(options).filter((d) => d.brand.toLowerCase() === key);
  }

  findByDomain(domain: string, options?: StoreOptions): Evidence[] {
    assertNotAborted(options);
    const key = domain.replace(/^www\./, '').toLowerCase();
    return this.all(options).filter(
      (d) => d.domain.replace(/^www\./, '').toLowerCase() === key,
    );
  }

  findByRetrievalMethod(
    method: RetrievalMethod,
    options?: StoreOptions,
  ): Evidence[] {
    assertNotAborted(options);
    return this.all(options).filter((d) => d.retrievalMethod === method);
  }

  all(options?: StoreOptions): Evidence[] {
    assertNotAborted(options);
    return [...this.#byId.values()];
  }

  size(options?: StoreOptions): number {
    assertNotAborted(options);
    return this.#byId.size;
  }

  clear(options?: StoreOptions): void {
    assertNotAborted(options);
    this.#byId.clear();
    this.#byNormalizedUrl.clear();
    this.#byContentHash.clear();
  }

  /**
   * Merge duplicates while preserving the stable id of the first indexed
   * record for that canonical article (URL identity wins over content identity).
   */
  #merge(existing: Evidence, incoming: Evidence): Evidence {
    const preferred = preferEvidence(existing, incoming);
    // Keep stable id from URL-keyed existing record when URL matched;
    // otherwise keep existing id so callers holding ids stay valid.
    return {
      ...preferred,
      id: existing.id,
      // Preserve earliest retrieval timestamp for freshness audits
      retrievedAt:
        existing.retrievedAt <= preferred.retrievedAt
          ? existing.retrievedAt
          : preferred.retrievedAt,
      metadata: { ...existing.metadata, ...preferred.metadata },
    };
  }

  #index(doc: Evidence, previous?: Evidence): void {
    if (previous && previous.id !== doc.id) {
      this.#byId.delete(previous.id);
    }
    if (previous) {
      if (
        previous.normalizedUrl !== doc.normalizedUrl &&
        this.#byNormalizedUrl.get(previous.normalizedUrl) === previous.id
      ) {
        this.#byNormalizedUrl.delete(previous.normalizedUrl);
      }
      if (
        previous.contentHash !== doc.contentHash &&
        this.#byContentHash.get(previous.contentHash) === previous.id
      ) {
        this.#byContentHash.delete(previous.contentHash);
      }
    }

    this.#byId.set(doc.id, doc);
    this.#byNormalizedUrl.set(doc.normalizedUrl, doc.id);
    // Only index non-trivial bodies for content-hash dedupe
    if (doc.extractedText.length >= 200) {
      this.#byContentHash.set(doc.contentHash, doc.id);
    }
  }
}
