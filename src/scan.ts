/**
 * Literal, verbatim scanning of the calling session's own log.
 *
 * The scan is deliberately a literal text predicate rather than a full-text
 * ranking query: it needs no search index, returns the same result on every
 * deployment, and never rewrites matched text. Its corpus is exactly one
 * session — the caller's — so a compacted-away event can be recovered without
 * reaching into any other session's history.
 *
 * @module dsh-verbatim-memory/scan
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import type {
  SessionEventReadRequest,
  SessionEventResultFilter,
  SessionEventSearchDocument,
  SessionEventSurface,
  SessionEventWindow,
} from '@deepseek-ai/dsh-session-query'
import { toClauses } from './filters.js'
import type { ScanFilters } from './filters.js'

/** The `ctx.sessionQuery` surface this plugin consumes. */
export interface SessionQueryLike {
  /** Scan first-party semantic event documents with provider-independent filters. */
  filterEvents(
    sessionId: SessionId,
    filters: readonly SessionEventResultFilter[],
  ): Promise<readonly SessionEventSearchDocument[]>
  /** Read one full event plus a bounded raw-log context window. */
  readEvent(request: SessionEventReadRequest, signal?: AbortSignal): Promise<SessionEventWindow>
}

/** One exact literal match inside one event of the calling session. */
export interface ScanHit {
  /** Event sequence number inside the session. */
  readonly seq: number
  /** Session event discriminant. */
  readonly type: string
  /** Event timestamp in Unix epoch milliseconds. */
  readonly time: number
  /** Whether the event is current context, replaced context, or raw-log-only. */
  readonly surface: SessionEventSurface
  /** The event's semantic text, exactly as extracted from the log. */
  readonly text: string
}

/** Options that shape one scan without changing what it may read. */
export interface ScanOptions {
  /** Metadata predicates AND-ed with the literal phrase. */
  readonly filters?: ScanFilters
  /** Result order by seq: `asc` is log order (default), `desc` is newest first. */
  readonly order?: 'asc' | 'desc'
  /** Matches to skip before the returned window, for paging a large set. */
  readonly offset?: number
}

/** The complete outcome of one literal scan. */
export interface ScanOutcome {
  /** Matches in requested order, capped by the requested limit. */
  readonly hits: readonly ScanHit[]
  /** Total matching documents before `limit` and `offset`. */
  readonly matched: number
  /** Offset applied before the returned window. */
  readonly offset: number
  /** Whether `limit` or `offset` withheld any match. */
  readonly truncated: boolean
  /** Offset that continues this result set, absent when nothing was withheld. */
  readonly nextOffset?: number
}

/**
 * Reject an unusable literal query before touching the log.
 * @param raw - caller-supplied query text.
 * @returns the trimmed query text.
 * @throws HarnessError when the query is empty.
 */
export function requireQuery(raw: string): string {
  const query = raw.trim()
  if (query.length === 0) {
    throw new HarnessError('query must contain at least one non-whitespace character', 'VERBATIM_MEMORY_EMPTY_QUERY')
  }
  return query
}

/**
 * Scan one session's log for a literal phrase and/or metadata predicates.
 *
 * A missing phrase makes this an enumeration: the predicates alone select the
 * result set, which is how a set question is answered in one call.
 * @param query - session-query service.
 * @param sessionId - the calling session's id.
 * @param queryText - already-trimmed literal phrase, or `undefined` to enumerate by metadata only.
 * @param limit - maximum matches returned.
 * @param options - metadata predicates, result order, and paging offset.
 * @returns matches with surface classification, total count, and truncation state.
 */
export async function scanSession(
  query: SessionQueryLike,
  sessionId: SessionId,
  queryText: string | undefined,
  limit: number,
  options: ScanOptions = {},
): Promise<ScanOutcome> {
  const clauses: SessionEventResultFilter[] = [
    ...toClauses(options.filters ?? {}),
    ...queryText === undefined ? [] : [{ kind: 'text' as const, text: queryText }],
  ]
  const documents = await query.filterEvents(sessionId, clauses)
  const ordered = options.order === 'desc' ? [...documents].reverse() : documents
  const offset = Math.max(0, Math.trunc(options.offset ?? 0))
  const hits: ScanHit[] = []
  for (const document of ordered.slice(offset, offset + limit)) {
    hits.push({
      seq: document.seq,
      type: document.type,
      time: document.time,
      surface: document.surface,
      text: document.text,
    })
  }
  const consumed = offset + hits.length
  const truncated = consumed < documents.length
  return {
    hits,
    matched: documents.length,
    offset,
    truncated,
    ...truncated ? { nextOffset: consumed } : {},
  }
}

/**
 * Read one exact raw-event window from the calling session.
 * @param query - session-query service.
 * @param sessionId - the calling session's id.
 * @param seq - target event sequence number.
 * @param before - neighboring events before the target.
 * @param after - neighboring events after the target.
 * @returns the exact event window.
 */
export async function readSessionEvent(
  query: SessionQueryLike,
  sessionId: SessionId,
  seq: number,
  before: number,
  after: number,
): Promise<SessionEventWindow> {
  // The tool body validates a non-negative safe integer before branding; the
  // session-query service owns the exact-seq contract beyond that.
  return await query.readEvent({ sessionId, seq: seq as SessionSeq, before, after })
}
