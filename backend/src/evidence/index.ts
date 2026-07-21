/**
 * Evidence Store — request-scoped source of truth for retrieved documents.
 *
 * Agents consume Evidence by id via the EvidenceStore interface.
 * Do not import InMemoryEvidenceStore from agent code.
 */

export { createEvidenceStore } from './createStore.js';
export { InMemoryEvidenceStore, EvidenceStoreAbortedError } from './memoryStore.js';
export {
  stableEvidenceId,
  hashContent,
  evidenceQualityScore,
  preferEvidence,
} from './ids.js';
export type { EvidenceStore, EvidenceInput, StoreOptions } from './types.js';
