/**
 * Atlas Retrieval Layer
 *
 * Sits between Discovery and downstream agents.
 * Produces structured Evidence documents — never SERP-as-content.
 */

export { retrieveEvidence } from './retrieve.js';
export type { RetrievalTelemetry } from './retrieve.js';
export { discoverCandidateLinks, brandSiteCandidates } from './search.js';
export {
  resolveBrandWebsite,
  buildDomainCandidates,
  searchOfficialDomain,
  probeWebsite,
} from './resolveWebsite.js';
export type {
  ResolveReason,
  WebsiteResolveTelemetry,
  ResolveBrandWebsiteResult,
} from './resolveWebsite.js';
export {
  expandBrandAliases,
  brandRootToken,
  normalizeBrandKey,
} from './aliases.js';
export {
  getCachedBrandWebsite,
  setCachedBrandWebsite,
  clearBrandWebsiteCache,
} from './websiteCache.js';
export { fetchEvidenceDocument, fetchEvidenceDocuments } from './fetchEvidence.js';
export { materializeEvidence, MIN_ARTICLE_CHARS } from './materialize.js';
export {
  discoverWikipediaCandidate,
  discoverWikipediaCandidates,
} from './wikipedia.js';
export { discoverPublisherViaWebSearch, INDIA_PUBLISHER_HOSTS } from './webSearch.js';
export {
  indiaPressSeedCandidates,
  indiaTopicListingCandidates,
} from './indiaPressSeeds.js';
export { dedupeEvidence, dedupeCandidateUrls } from './dedupe.js';
export {
  normalizeUrl,
  domainOf,
  isProbablyArticleUrl,
  isSearchOrListingUrl,
} from './normalize.js';
export {
  extractArticleLinksFromHtml,
  extractArticleMeta,
  extractArticleText,
} from './parse.js';
export type {
  RetrieveOptions,
  EvidenceQueryIntent,
  CandidateLink,
  Evidence,
  RetrievalMethod,
} from './types.js';
export { evidenceIdForUrl, contentFingerprint } from './types.js';
export { createEvidenceStore } from '../evidence/index.js';
