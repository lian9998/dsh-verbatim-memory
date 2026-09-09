/**
 * Deterministic evidence bundles for the `memory_ask` curator contract.
 *
 * The bundle carries exact source text with provenance plus explicit gaps. It
 * never paraphrases, so a caller can forward it to another agent without a
 * lossy hop. `why_relevant` is intentionally absent: relevance is the caller's
 * judgment, and any generated explanation would be non-memory metadata.
 *
 * @module dsh-verbatim-memory/evidence
 */

import type { ScanHit, ScanOutcome } from './scan.js'

/** One exact excerpt with its provenance. */
export interface EvidenceItem {
  /** Stable `sessionId#seq` handle for a follow-up `memory_read`. */
  readonly id: string
  /** Session that owns the excerpt. */
  readonly session_id: string
  /** Event sequence number inside that session. */
  readonly seq: number
  /** Session event discriminant. */
  readonly type: string
  /** Event timestamp as an ISO-8601 string. */
  readonly time: string
  /** Whether the event is current context, replaced context, or raw-log-only. */
  readonly surface: string
  /** Exact event text; never truncated and never rewritten. */
  readonly exact_text: string
  /** The literal phrase the caller searched for. */
  readonly matched_phrase: string
}

/** The lossless handoff value returned by `memory_ask`. */
export interface EvidenceBundle {
  /** The caller's original query. */
  readonly query: string
  /** Exact excerpts that fit the token budget. */
  readonly results: readonly EvidenceItem[]
  /** Explicit gaps: nothing found, or excerpts dropped for budget. */
  readonly missing: readonly string[]
  /** Number of authorized sessions scanned. */
  readonly scanned_sessions: number
  /** Per-session read failures, reported without failing the request. */
  readonly skipped: readonly string[]
  /** Whether the budget or the match limit stopped the bundle early. */
  readonly truncated: boolean
  /** Estimated tokens across the returned excerpts. */
  readonly token_estimate: number
  /** The budget this bundle was built against. */
  readonly budget_tokens: number
}

/**
 * Estimate the token cost of one text block.
 * @param text - exact text.
 * @returns a conservative character-based estimate.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Build a lossless evidence bundle from one scan.
 * @param query - the caller's original query text.
 * @param outcome - matches and diagnostics from the literal scan.
 * @param budgetTokens - maximum estimated tokens of excerpt text.
 * @returns the evidence bundle, with dropped matches reported as gaps.
 */
export function buildEvidenceBundle(
  query: string,
  outcome: ScanOutcome,
  budgetTokens: number,
): EvidenceBundle {
  const results: EvidenceItem[] = []
  const missing: string[] = []
  let tokenEstimate = 0
  let dropped = 0
  for (const hit of outcome.hits) {
    const cost = estimateTokens(hit.text)
    if (tokenEstimate + cost > budgetTokens) {
      dropped += 1
      continue
    }
    tokenEstimate += cost
    results.push(toItem(hit, query))
  }
  if (outcome.hits.length === 0) {
    missing.push(`no literal match for ${JSON.stringify(query)} in the authorized corpus`)
  }
  if (dropped > 0) {
    missing.push(`${dropped} exact match(es) omitted to respect budget_tokens=${budgetTokens}`)
  }
  return {
    query,
    results,
    missing,
    scanned_sessions: outcome.scannedSessions,
    skipped: outcome.skipped,
    truncated: outcome.truncated || dropped > 0,
    token_estimate: tokenEstimate,
    budget_tokens: budgetTokens,
  }
}

/** Project one scan hit into an evidence item. */
function toItem(hit: ScanHit, query: string): EvidenceItem {
  return {
    id: `${hit.sessionId}#${hit.seq}`,
    session_id: hit.sessionId,
    seq: hit.seq,
    type: hit.type,
    time: new Date(hit.time).toISOString(),
    surface: hit.surface,
    exact_text: hit.text,
    matched_phrase: query,
  }
}
