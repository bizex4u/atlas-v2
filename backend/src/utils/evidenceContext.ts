import type { Evidence } from '@atlas/shared';

export type EvidenceRankStrategy = 'relevance_recency_quality';

export type BuildEvidenceContextOptions = {
  /** Free-text query used for lexical relevance scoring */
  query?: string;
  /** Approx token budget for the evidence block (1 token ≈ 4 chars) */
  maxTokens?: number;
  /** Hard cap on number of documents after ranking */
  maxDocuments?: number;
  /** Max chars per document body */
  maxCharsPerDoc?: number;
  strategy?: EvidenceRankStrategy;
};

export type EvidenceContext = {
  /** Formatted block for the user prompt — never raw HTML */
  text: string;
  evidenceIds: string[];
  selected: Evidence[];
  /** Approximate character length of `text` */
  charCount: number;
  /** Approximate tokens (chars / 4) */
  estimatedTokens: number;
};

const DEFAULT_MAX_TOKENS = 6_000;
const DEFAULT_MAX_DOCS = 8;
const DEFAULT_MAX_CHARS_PER_DOC = 2_500;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

function relevanceScore(doc: Evidence, queryTokens: string[]): number {
  if (queryTokens.length === 0) return 0.5;
  const hay = `${doc.title ?? ''} ${doc.extractedText}`.toLowerCase();
  let hits = 0;
  for (const t of queryTokens) {
    if (hay.includes(t)) hits += 1;
  }
  return hits / queryTokens.length;
}

function recencyScore(doc: Evidence): number {
  if (!doc.publishedAt) return 0.3;
  const t = Date.parse(doc.publishedAt);
  if (Number.isNaN(t)) return 0.3;
  const ageDays = (Date.now() - t) / (1000 * 60 * 60 * 24);
  if (ageDays <= 30) return 1;
  if (ageDays <= 180) return 0.8;
  if (ageDays <= 365) return 0.55;
  if (ageDays <= 730) return 0.35;
  return 0.15;
}

function qualityScore(doc: Evidence): number {
  const len = doc.extractedText.length;
  let score = Math.min(len / 2000, 1);
  if (doc.title) score += 0.1;
  if (doc.publishedAt) score += 0.1;
  if (doc.retrievalMethod === 'brand_site') score += 0.15;
  return Math.min(score, 1.25);
}

export function scoreEvidence(
  doc: Evidence,
  queryTokens: string[],
): number {
  const rel = relevanceScore(doc, queryTokens);
  const rec = recencyScore(doc);
  const qual = qualityScore(doc);
  // Weighted: relevance dominant, then recency, then extraction quality
  return rel * 0.55 + rec * 0.25 + qual * 0.2;
}

/**
 * Deduplicate by normalizedUrl then contentHash, keeping higher-scored docs.
 */
export function dedupeForContext(
  docs: Evidence[],
  scoreOf: (d: Evidence) => number,
): Evidence[] {
  const byUrl = new Map<string, Evidence>();
  for (const doc of docs) {
    const key = doc.normalizedUrl || doc.canonicalUrl;
    const existing = byUrl.get(key);
    if (!existing || scoreOf(doc) > scoreOf(existing)) {
      byUrl.set(key, doc);
    }
  }

  const byHash = new Map<string, Evidence>();
  for (const doc of byUrl.values()) {
    if (doc.extractedText.length < 200) {
      byHash.set(`short:${doc.id}`, doc);
      continue;
    }
    const existing = byHash.get(doc.contentHash);
    if (!existing || scoreOf(doc) > scoreOf(existing)) {
      byHash.set(doc.contentHash, doc);
    }
  }
  return [...byHash.values()];
}

function formatEvidenceBlock(doc: Evidence, body: string, index: number): string {
  const title = doc.title?.trim() || '(untitled)';
  const published = doc.publishedAt ?? 'unknown';
  return [
    `[Evidence ${index}] id=${doc.id}`,
    `title: ${title}`,
    `url: ${doc.canonicalUrl}`,
    `publishedAt: ${published}`,
    `domain: ${doc.domain}`,
    `---`,
    body,
  ].join('\n');
}

/**
 * Build a ranked, deduplicated, token-budgeted evidence context for LLM prompts.
 *
 * Extensible via `strategy` — currently `relevance_recency_quality`.
 * Providers never see this logic; callLLM injects the resulting text.
 */
export function buildEvidenceContext(
  docs: Evidence[],
  options: BuildEvidenceContextOptions = {},
): EvidenceContext {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const maxDocuments = options.maxDocuments ?? DEFAULT_MAX_DOCS;
  const maxCharsPerDoc = options.maxCharsPerDoc ?? DEFAULT_MAX_CHARS_PER_DOC;
  const maxChars = maxTokens * 4;
  const queryTokens = tokenize(options.query ?? '');

  const scoreOf = (d: Evidence) => scoreEvidence(d, queryTokens);
  const unique = dedupeForContext(docs, scoreOf);

  const ranked = [...unique].sort((a, b) => scoreOf(b) - scoreOf(a));
  const selected: Evidence[] = [];
  const parts: string[] = [];
  let usedChars = 0;

  const header = 'EVIDENCE (use only these sources; cite evidence ids; null if unsupported):\n';
  usedChars += header.length;

  for (const doc of ranked) {
    if (selected.length >= maxDocuments) break;

    let body = doc.extractedText.replace(/\s+/g, ' ').trim();
    if (!body) continue;
    if (body.length > maxCharsPerDoc) {
      body = `${body.slice(0, maxCharsPerDoc)}…`;
    }

    const block = formatEvidenceBlock(doc, body, selected.length + 1);
    const sep = parts.length ? '\n\n' : '';
    if (usedChars + sep.length + block.length > maxChars) {
      // Try a shorter snippet to fit remaining budget
      const remaining = maxChars - usedChars - sep.length - 120;
      if (remaining < 200) break;
      const shortBody = `${body.slice(0, remaining)}…`;
      const shortBlock = formatEvidenceBlock(doc, shortBody, selected.length + 1);
      if (usedChars + sep.length + shortBlock.length > maxChars) break;
      parts.push(shortBlock);
      selected.push(doc);
      usedChars += sep.length + shortBlock.length;
      break;
    }

    parts.push(block);
    selected.push(doc);
    usedChars += sep.length + block.length;
  }

  const text =
    selected.length === 0
      ? 'EVIDENCE: (none provided — return null for all factual fields; do not invent.)'
      : header + parts.join('\n\n');

  return {
    text,
    evidenceIds: selected.map((d) => d.id),
    selected,
    charCount: text.length,
    estimatedTokens: Math.ceil(text.length / 4),
  };
}
