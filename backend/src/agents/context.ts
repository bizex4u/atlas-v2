import type {
  Confidence,
  Evidence,
  EvidenceReference,
  ExtractionMethod,
  Field,
} from '@atlas/shared';
import type { AgentName } from '@atlas/shared';
import type { EvidenceStore } from '../evidence/types.js';
import type { AgentContext } from './types.js';

export type RunTelemetry = {
  requestId: string;
  startedAt: number;
  evidenceRetrieved: number;
  evidenceStored: number;
  evidencePassedToAgent: Partial<Record<AgentName | 'Retrieval', number>>;
  provider?: string | null;
  model?: string | null;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
};

export type FieldOptions = {
  sources?: string[];
  evidenceIds?: string[];
  extractionMethod?: ExtractionMethod;
  freshness?: Field<unknown>['freshness'];
  reasoningNotes?: string;
  reason?: string;
};

export function refsFromIds(ids: string[]): EvidenceReference[] {
  return [...new Set(ids.filter(Boolean))].map((evidenceId) => ({
    evidenceId,
  }));
}

export function field<T>(
  value: T | null,
  confidence: Confidence,
  sourcesOrOpts?: string[] | FieldOptions,
): Field<T> {
  if (Array.isArray(sourcesOrOpts) || sourcesOrOpts === undefined) {
    const sources = sourcesOrOpts;
    return {
      value,
      confidence,
      evidence: [],
      ...(sources?.length ? { sources } : {}),
    };
  }

  const opts = sourcesOrOpts;
  const evidence = refsFromIds(opts.evidenceIds ?? []);
  return {
    value,
    confidence,
    evidence,
    ...(opts.sources?.length ? { sources: opts.sources } : {}),
    ...(opts.extractionMethod
      ? { extractionMethod: opts.extractionMethod }
      : {}),
    ...(opts.freshness ? { freshness: opts.freshness } : {}),
    ...(opts.reasoningNotes ? { reasoningNotes: opts.reasoningNotes } : {}),
    ...(opts.reason ? { reason: opts.reason } : {}),
  };
}

export function needsInput<T>(reason?: string): Field<T> {
  return {
    value: null,
    confidence: 'needs_input',
    evidence: [],
    ...(reason ? { reason } : {}),
  };
}

/** Evidence available to the current agent (from the request-scoped store). */
export function getAgentEvidence(context: AgentContext): Evidence[] {
  if (!context.evidenceStore) return [];
  try {
    const docs = context.evidenceStore.all({ signal: context.signal });
    if (context.telemetry && context.currentAgent) {
      context.telemetry.evidencePassedToAgent[context.currentAgent] =
        docs.length;
    }
    return docs;
  } catch {
    return [];
  }
}

export function confidenceFromEvidence(evidenceIds: string[]): Confidence {
  if (evidenceIds.length >= 1) return 'verified';
  return 'estimated';
}

export type { EvidenceStore };
