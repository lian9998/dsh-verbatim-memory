/**
 * In-memory stand-in for the consumed `ctx.sessionQuery` surface.
 *
 * @module dsh-verbatim-memory/tests/fake-session-query
 */

import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent, SessionHeader, SessionSeq } from '@deepseek-ai/dsh-session'
import type {
  SessionEventReadRequest,
  SessionEventResultFilter,
  SessionEventSearchDocument,
  SessionEventSurface,
  SessionEventWindow,
} from '@deepseek-ai/dsh-session-query'
import type { SessionQueryLike } from '../src/scan.js'

/** One fake event document. */
export interface FakeEvent {
  /** Event sequence number. */
  readonly seq: number
  /** Event discriminant. */
  readonly type: string
  /** Event timestamp. */
  readonly time: number
  /** Surface classification. */
  readonly surface: SessionEventSurface
  /** Exact semantic text. */
  readonly text: string
}

/** One fake session. */
export interface FakeSession {
  /** Session header. */
  readonly header: SessionHeader
  /** Events in ascending seq order. */
  readonly events: readonly FakeEvent[]
  /** When set, `filterEvents` rejects with this message. */
  readonly failScan?: string
}

/** Build a fake session header. */
export function fakeHeader(id: string, cwd: string | undefined, createdAt = 1_700_000_000_000): SessionHeader {
  return {
    version: 0,
    id: SessionId(id),
    createdAt,
    ...cwd === undefined ? {} : { cwd },
    isSeeded: false,
  }
}

/** Brand a number as a session seq for fixtures. */
export function seq(value: number): SessionSeq {
  return value as SessionSeq
}

/**
 * Project a fake event into the discriminated session-event union.
 * @param event - fake event fixture.
 * @returns the structural event the query service would return.
 */
function asEvent(event: FakeEvent): SessionEvent {
  return {
    type: event.type,
    seq: seq(event.seq),
    time: event.time,
    data: { text: event.text },
  } as unknown as SessionEvent
}

/** Escape a literal phrase into a case-insensitive, whitespace-flexible regex. */
function literalPattern(text: string): RegExp {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
  return new RegExp(escaped, 'iu')
}

/** A minimal but faithful single-session session-query fake. */
export function fakeSessionQuery(session: FakeSession): SessionQueryLike {
  return {
    async filterEvents(
      id: SessionId,
      filters: readonly SessionEventResultFilter[],
    ): Promise<readonly SessionEventSearchDocument[]> {
      if (id !== session.header.id) throw new Error(`unknown session ${id}`)
      if (session.failScan !== undefined) throw new Error(session.failScan)
      const text = filters.find(filter => filter.kind === 'text')
      const pattern = text?.kind === 'text' ? literalPattern(text.text) : undefined
      return session.events
        .filter(event => pattern === undefined || pattern.test(event.text))
        .map(event => ({
          sessionId: id,
          seq: seq(event.seq),
          type: event.type as SessionEventSearchDocument['type'],
          time: event.time,
          surface: event.surface,
          text: event.text,
        }))
    },
    async readEvent(request: SessionEventReadRequest): Promise<SessionEventWindow> {
      if (request.sessionId !== session.header.id) throw new Error(`unknown session ${request.sessionId}`)
      const target = session.events.find(event => event.seq === request.seq)
      if (target === undefined) throw new Error('missing event')
      const before = request.before ?? 0
      const after = request.after ?? 0
      const start = Math.max(0, request.seq - before)
      const end = Math.min(session.events.length - 1, request.seq + after)
      return {
        session: session.header,
        inheritedEventCount: 0 as SessionEventWindow['inheritedEventCount'],
        target: asEvent(target),
        events: session.events.slice(start, end + 1).map(asEvent),
        startSeq: seq(start),
        endSeq: seq(end),
      }
    },
  }
}
