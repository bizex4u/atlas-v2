import { InMemoryEvidenceStore } from './memoryStore.js';
import type { EvidenceStore } from './types.js';

/**
 * Create a request-scoped Evidence Store.
 *
 * Call once per orchestration run. Discard when the run ends.
 * Agents should depend on the EvidenceStore interface — not this factory's
 * concrete class — so Redis/Postgres backends can drop in later.
 */
export function createEvidenceStore(): EvidenceStore {
  return new InMemoryEvidenceStore();
}
