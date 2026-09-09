import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEventType } from '@deepseek-ai/dsh-session'
import { readSessionEvent, requireQuery, scanSession } from '../src/scan.js'
import { fakeHeader, fakeSessionQuery, type FakeSession } from './fake-session-query.js'

const SESSION_ID = SessionId('s-self')

/** Brand fixture event types for the filter contract. */
function types(...values: string[]): readonly SessionEventType[] {
  return values as readonly SessionEventType[]
}

function session(): FakeSession {
  return {
    header: fakeHeader('s-self', '/w'),
    events: [
      { seq: 0, type: 'user/message', time: 1, surface: 'current', text: 'hello world' },
      { seq: 1, type: 'user/message', time: 2, surface: 'shadowed', text: 'We chose Postgres because of constraints.' },
      { seq: 2, type: 'assistant/message', time: 3, surface: 'log-only', text: 'Later we reversed the postgres decision.' },
    ],
  }
}

describe('requireQuery', () => {
  it('trims and rejects whitespace-only input', () => {
    expect(requireQuery('  postgres  ')).toBe('postgres')
    expect(() => requireQuery('   ')).toThrowError(/at least one non-whitespace/)
  })
})

describe('scanSession', () => {
  it('returns exact matches with surface and provenance', async () => {
    const outcome = await scanSession(fakeSessionQuery(session()), SESSION_ID, 'postgres', 10)
    expect(outcome.hits.map(hit => hit.seq)).toEqual([1, 2])
    expect(outcome.hits[0]?.text).toBe('We chose Postgres because of constraints.')
    expect(outcome.hits[0]?.surface).toBe('shadowed')
    expect(outcome.truncated).toBe(false)
  })

  it('matches whitespace flexibly and case-insensitively', async () => {
    const outcome = await scanSession(fakeSessionQuery(session()), SESSION_ID, 'CHOSE   postgres', 10)
    expect(outcome.hits).toHaveLength(1)
  })

  it('caps matches and reports truncation', async () => {
    const outcome = await scanSession(fakeSessionQuery(session()), SESSION_ID, 'postgres', 1)
    expect(outcome.hits).toHaveLength(1)
    expect(outcome.truncated).toBe(true)
  })

  it('returns nothing when the phrase is absent', async () => {
    const outcome = await scanSession(fakeSessionQuery(session()), SESSION_ID, 'absent', 10)
    expect(outcome.hits).toEqual([])
    expect(outcome.matched).toBe(0)
    expect(outcome.truncated).toBe(false)
  })

  it('enumerates every event when no phrase is supplied', async () => {
    const outcome = await scanSession(fakeSessionQuery(session()), SESSION_ID, undefined, 10)
    expect(outcome.hits.map(hit => hit.seq)).toEqual([0, 1, 2])
    expect(outcome.matched).toBe(3)
    expect(outcome.truncated).toBe(false)
    expect(outcome.nextOffset).toBeUndefined()
  })

  it('ANDs metadata predicates with the phrase', async () => {
    const outcome = await scanSession(fakeSessionQuery(session()), SESSION_ID, 'postgres', 10, {
      filters: { surfaces: ['shadowed'] },
    })
    expect(outcome.hits.map(hit => hit.seq)).toEqual([1])
    expect(outcome.matched).toBe(1)
  })

  it('selects by type without any phrase', async () => {
    const outcome = await scanSession(fakeSessionQuery(session()), SESSION_ID, undefined, 10, {
      filters: { types: types('assistant/message') },
    })
    expect(outcome.hits.map(hit => hit.seq)).toEqual([2])
  })

  it('applies inclusive seq and time ranges', async () => {
    const bySeq = await scanSession(fakeSessionQuery(session()), SESSION_ID, undefined, 10, {
      filters: { seqFrom: 1, seqTo: 2 },
    })
    expect(bySeq.hits.map(hit => hit.seq)).toEqual([1, 2])
    const byTime = await scanSession(fakeSessionQuery(session()), SESSION_ID, undefined, 10, {
      filters: { timeFrom: 3 },
    })
    expect(byTime.hits.map(hit => hit.seq)).toEqual([2])
  })

  it('returns the newest matches first when ordered descending', async () => {
    const outcome = await scanSession(fakeSessionQuery(session()), SESSION_ID, 'postgres', 10, { order: 'desc' })
    expect(outcome.hits.map(hit => hit.seq)).toEqual([2, 1])
  })

  it('pages with offset and reports how to continue', async () => {
    const outcome = await scanSession(fakeSessionQuery(session()), SESSION_ID, undefined, 1, { offset: 1 })
    expect(outcome.hits.map(hit => hit.seq)).toEqual([1])
    expect(outcome.matched).toBe(3)
    expect(outcome.truncated).toBe(true)
    expect(outcome.nextOffset).toBe(2)
  })

  it('reports an offset past the end without claiming a continuation', async () => {
    const outcome = await scanSession(fakeSessionQuery(session()), SESSION_ID, undefined, 10, { offset: 9 })
    expect(outcome.hits).toEqual([])
    expect(outcome.matched).toBe(3)
    expect(outcome.truncated).toBe(false)
    expect(outcome.offset).toBe(9)
  })

  it('refuses to read any session other than the one bound to the service', async () => {
    await expect(scanSession(fakeSessionQuery(session()), SessionId('s-other'), 'postgres', 10))
      .rejects.toThrowError(/unknown session/)
  })

  it('propagates a service read failure', async () => {
    const failing: FakeSession = { ...session(), failScan: 'index unavailable' }
    await expect(scanSession(fakeSessionQuery(failing), SESSION_ID, 'postgres', 10))
      .rejects.toThrowError(/index unavailable/)
  })
})

describe('readSessionEvent', () => {
  it('returns the exact window around the target', async () => {
    const window = await readSessionEvent(fakeSessionQuery(session()), SESSION_ID, 2, 1, 0)
    expect(window.startSeq).toBe(1)
    expect(window.endSeq).toBe(2)
    expect(window.events).toHaveLength(2)
    expect(window.target.seq).toBe(2)
  })

  it('propagates a missing event', async () => {
    await expect(readSessionEvent(fakeSessionQuery(session()), SESSION_ID, 99, 0, 0))
      .rejects.toThrowError(/missing event/)
  })
})
