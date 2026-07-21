import type { Evidence, RetrievalMethod } from '@atlas/shared';
import { hashContent, stableEvidenceId } from '../evidence/ids.js';

export type EvidenceQueryIntent =
  | 'entity'
  | 'financial'
  | 'store'
  | 'campaign'
  | 'competitor'
  | 'general';

export type RetrieveOptions = {
  brandName: string;
  /** Canonical website from Discovery when known */
  website?: string | null;
  intents?: EvidenceQueryIntent[];
  /** Max article pages to fetch after link discovery */
  maxDocuments?: number;
  signal?: AbortSignal;
};

export type CandidateLink = {
  url: string;
  title: string | null;
  sourceLabel: string;
  retrievalMethod: RetrievalMethod;
};

/** @deprecated Prefer stableEvidenceId from ../evidence/ids.js */
export function evidenceIdForUrl(url: string): string {
  return stableEvidenceId(url);
}

/** @deprecated Prefer hashContent from ../evidence/ids.js */
export function contentFingerprint(text: string): string {
  return hashContent(text);
}

export type { Evidence, RetrievalMethod };
