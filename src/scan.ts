/**
 * Authorized session resolution and literal, verbatim scanning.
 *
 * The scan is deliberately a literal text predicate rather than a full-text
 * ranking query: it needs no search index, returns the same result on every
 * deployment, and never rewrites matched text.
 *
 * @module dsh-verbatim-memory/scan
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SessionId, SessionHeader, SessionSeq } from '@deepseek-ai/dsh-session'
import type {
  SessionEventReadRequest,
  SessionEventResultFilter,
  SessionEventSearchDocument,
  SessionEventWindow,
  SessionRecord,
  SessionResultFilter,
  SessionTitleObservationResult,
} from '@deepseek-ai/dsh-session-query'
import type { SessionEventSurface } from '@deepseek-ai/dsh-session-query'
import type { Caller } from './access.js'
import { authorizedRecords, headerAuthorized, unauthorized } from './access.js'

/** The `ctx.sessionQuery` surface this plugin consumes. */
export interface SessionQueryLike {
  /** List the complete logical corpus. */
  listSessions(signal?: AbortSignal): Promise<SessionRecord[]>
  /** Filter the corpus with provider-independent predicates. */
  filterSessions(filters: readonly SessionResultFilter[], signal?: AbortSignal): Promise<SessionRecord[]>
  /** Fold titles for unique sessions from one corpus observation. */
  readTitleSnapshots(
    sessionIds: readonly SessionId[],
    signal?: AbortSignal,
  ): Promise<readonly SessionTitleObservationResult[]>
  /** Scan first-party semantic event documents with provider-independent filters. */
  filterEvents(
    sessionId: SessionId,
    filters: readonly SessionEventResultFilter[],
  ): Promise<readonly SessionEventSearchDocument[]>
  /** Read one full event plus a bounded raw-log context window. */
  readEvent(request: SessionEventReadRequest, signal?: AbortSignal): Promise<SessionEventWindow>
}

/** One exact literal match inside one event. */
export interface ScanHit {
  /** Session that owns the matched event. */
  readonly sessionId: SessionId
  /** Event sequence number inside that session. */
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

/** The complete outcome of one literal scan. */
export interface ScanOutcome {
  /** Matches in scan order, capped by the requested limit. */
  readonly hits: readonly ScanHit[]
  /** Number of authorized sessions actually scanned. */
  readonly scannedSessions: number
  /** Per-session read failures, reported without failing the whole scan. */
  readonly skipped: readonly string[]
  /** Whether the limit or the session cap stopped the scan early. */
  readonly truncated: boolean
}

/** A session summary for `memory_sessions`. */
export interface SessionSummary {
  /** Session id. */
  readonly id: SessionId
  /** Workspace path recorded in the session header. */
  readonly cwd?: string
  /** Creation timestamp in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Latest log-backed title, when one exists. */
  readonly title?: string
  /** Whether the id currently exists in `ctx.sessions`. */
  readonly live: boolean
  /** Whether the active persistence backend materializes the id. */
  readonly persisted: boolean
}

/**
 * Reject an unusable literal query before touching the corpus.
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

/** Filters selecting exactly one session id inside the caller's workspace. */
function targetFilters(id: SessionId, cwd: string | undefined): readonly SessionResultFilter[] {
  return cwd === undefined
    ? [{ kind: 'id', values: [id] }]
    : [{ kind: 'id', values: [id] }, { kind: 'cwd', values: [cwd] }]
}

/**
 * Authorize one explicit target session.
 * @param query - session-query service.
 * @param caller - calling identity.
 * @param id - requested session id.
 * @throws HarnessError when the target is unreadable from the caller's workspace.
 */
export async function authorizeTarget(
  query: SessionQueryLike,
  caller: Caller,
  id: SessionId,
): Promise<void> {
  if (id === caller.id) return
  const cwd = caller.header.cwd
  if (cwd === undefined) throw unauthorized()
  const records = await query.filterSessions(targetFilters(id, cwd))
  if (records.length !== 1) throw unauthorized()
}

/**
 * Resolve the authorized sessions one scan may read.
 * @param query - session-query service.
 * @param caller - calling identity.
 * @param explicit - optional explicit target session id.
 * @param maxSessions - cap on sessions returned.
 * @returns authorized records, newest first.
 */
export async function scanTargets(
  query: SessionQueryLike,
  caller: Caller,
  explicit: SessionId | undefined,
  maxSessions: number,
): Promise<SessionRecord[]> {
  if (explicit !== undefined) {
    await authorizeTarget(query, caller, explicit)
    const records = await query.filterSessions(targetFilters(explicit, caller.header.cwd))
    return records.slice(0, maxSessions)
  }
  const cwd = caller.header.cwd
  const records = cwd === undefined
    ? await query.filterSessions([{ kind: 'id', values: [caller.id] }])
    : await query.filterSessions([{ kind: 'cwd', values: [cwd] }])
  return authorizedRecords(records, caller)
    .filter(record => record.header.id !== caller.id)
    .slice(0, maxSessions)
}

/**
 * Run one literal scan across authorized sessions.
 * @param query - session-query service.
 * @param caller - calling identity.
 * @param queryText - already-trimmed literal phrase.
 * @param explicit - optional explicit target session id.
 * @param limit - maximum matches returned.
 * @param maxSessions - maximum sessions scanned.
 * @returns matches with provenance and per-session read failures.
 */
export async function scan(
  query: SessionQueryLike,
  caller: Caller,
  queryText: string,
  explicit: SessionId | undefined,
  limit: number,
  maxSessions: number,
): Promise<ScanOutcome> {
  const targets = await scanTargets(query, caller, explicit, maxSessions)
  const hits: ScanHit[] = []
  const skipped: string[] = []
  let scannedSessions = 0
  let truncated = false
  for (const record of targets) {
    if (hits.length >= limit) {
      truncated = true
      break
    }
    scannedSessions += 1
    try {
      const documents = await query.filterEvents(record.header.id, [{ kind: 'text', text: queryText }])
      for (const document of documents) {
        if (hits.length >= limit) {
          truncated = true
          break
        }
        hits.push({
          sessionId: document.sessionId,
          seq: document.seq,
          type: document.type,
          time: document.time,
          surface: document.surface,
          text: document.text,
        })
      }
    } catch (error: unknown) {
      skipped.push(`${record.header.id}: ${describe(error)}`)
    }
  }
  return { hits, scannedSessions, skipped, truncated }
}

/** Authorized session summaries plus the pre-limit count. */
export interface SessionListing {
  /** Ordered summaries, newest first, capped by the requested limit. */
  readonly items: readonly SessionSummary[]
  /** Number of authorized sessions that matched the title filter. */
  readonly total: number
}

/**
 * List the caller's authorized sessions with their latest titles.
 * @param query - session-query service.
 * @param caller - calling identity.
 * @param titleFilter - optional case-insensitive substring applied to titles.
 * @param limit - maximum sessions returned.
 * @returns ordered session summaries and the pre-limit match count.
 */
export async function listAuthorized(
  query: SessionQueryLike,
  caller: Caller,
  titleFilter: string | undefined,
  limit: number,
): Promise<SessionListing> {
  const cwd = caller.header.cwd
  const records = authorizedRecords(
    cwd === undefined
      ? await query.filterSessions([{ kind: 'id', values: [caller.id] }])
      : await query.filterSessions([{ kind: 'cwd', values: [cwd] }]),
    caller,
  )
  const observations = await query.readTitleSnapshots(records.map(record => record.header.id))
  const titles = new Map<SessionId, string>()
  for (const observation of observations) {
    if (observation.status !== 'fulfilled') continue
    const title = observation.value.title?.title
    if (title !== undefined) titles.set(observation.sessionId, title)
  }
  const needle = titleFilter?.toLowerCase()
  const matched = records
    .map((record): SessionSummary => {
      const title = titles.get(record.header.id)
      return {
        id: record.header.id,
        ...record.header.cwd === undefined ? {} : { cwd: record.header.cwd },
        createdAt: record.header.createdAt,
        ...title === undefined ? {} : { title },
        live: record.live,
        persisted: record.persisted,
      }
    })
    .filter(summary => needle === undefined
      || (summary.title ?? '').toLowerCase().includes(needle))
  return { items: matched.slice(0, limit), total: matched.length }
}

/**
 * Read one authorized raw-event window.
 * @param query - session-query service.
 * @param caller - calling identity.
 * @param id - target session id.
 * @param seq - target event sequence number.
 * @param before - neighboring events before the target.
 * @param after - neighboring events after the target.
 * @returns the exact event window.
 * @throws HarnessError when the target is unreadable.
 */
export async function readAuthorized(
  query: SessionQueryLike,
  caller: Caller,
  id: SessionId,
  seq: number,
  before: number,
  after: number,
): Promise<SessionEventWindow> {
  await authorizeTarget(query, caller, id)
  // The tool body validates a non-negative safe integer before branding; the
  // session-query service owns the exact-seq contract beyond that.
  const window = await query.readEvent({ sessionId: id, seq: seq as SessionSeq, before, after })
  if (!headerAuthorized(window.session, caller)) throw unauthorized()
  return window
}

/** Render one session header as a stable one-line identity. */
export function describeHeader(header: SessionHeader): string {
  return `${header.id}  cwd=${header.cwd ?? '(none)'}  created=${new Date(header.createdAt).toISOString()}`
}

/** Render an unknown failure as a short diagnostic. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
