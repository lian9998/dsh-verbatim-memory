import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEventReadRequest, SessionEventWindow, SessionResultFilter } from '@deepseek-ai/dsh-session-query'
import type { Caller } from '../src/access.js'
import {
  listAuthorized,
  readAuthorized,
  requireQuery,
  scan,
  scanTargets,
} from '../src/scan.js'
import { fakeHeader, fakeSessionQuery, type FakeSession } from './fake-session-query.js'

const CALLER: Caller = { id: SessionId('s-self'), header: fakeHeader('s-self', '/w') }

function sessions(): FakeSession[] {
  return [
    {
      header: fakeHeader('s-self', '/w'),
      live: true,
      events: [
        { seq: 0, type: 'user/message', time: 1, surface: 'current', text: 'hello world' },
      ],
    },
    {
      header: fakeHeader('s-other', '/w', 1_600_000_000_000),
      title: 'Design notes',
      events: [
        { seq: 0, type: 'user/message', time: 1, surface: 'current', text: 'We chose Postgres because of constraints.' },
        { seq: 1, type: 'assistant/message', time: 2, surface: 'shadowed', text: 'Later we reversed the postgres decision.' },
      ],
    },
    {
      header: fakeHeader('s-foreign', '/elsewhere'),
      events: [
        { seq: 0, type: 'user/message', time: 1, surface: 'current', text: 'secret postgres note' },
      ],
    },
  ]
}

describe('requireQuery', () => {
  it('trims and rejects whitespace-only input', () => {
    expect(requireQuery('  postgres  ')).toBe('postgres')
    expect(() => requireQuery('   ')).toThrowError(/at least one non-whitespace/)
  })
})

describe('scanTargets', () => {
  it('scans workspace peers and excludes the caller session', async () => {
    const query = fakeSessionQuery(sessions())
    const targets = await scanTargets(query, CALLER, undefined, 10)
    expect(targets.map(record => record.header.id)).toEqual(['s-other'])
  })

  it('authorizes an explicit workspace peer', async () => {
    const query = fakeSessionQuery(sessions())
    const targets = await scanTargets(query, CALLER, SessionId('s-other'), 10)
    expect(targets.map(record => record.header.id)).toEqual(['s-other'])
  })

  it('denies an explicit foreign session', async () => {
    const query = fakeSessionQuery(sessions())
    await expect(scanTargets(query, CALLER, SessionId('s-foreign'), 10))
      .rejects.toThrowError(/not readable from this workspace/)
  })

  it('lets a caller without cwd read only itself', async () => {
    const caller: Caller = { id: SessionId('s-other'), header: fakeHeader('s-other', undefined) }
    const query = fakeSessionQuery(sessions())
    const targets = await scanTargets(query, caller, undefined, 10)
    expect(targets).toEqual([])
  })
})

describe('scan', () => {
  it('returns exact matches with provenance and no cross-workspace leak', async () => {
    const query = fakeSessionQuery(sessions())
    const outcome = await scan(query, CALLER, 'postgres', undefined, 10, 10)
    expect(outcome.hits).toHaveLength(2)
    expect(outcome.hits.map(hit => `${hit.sessionId}#${hit.seq}`)).toEqual(['s-other#0', 's-other#1'])
    expect(outcome.hits[0]?.text).toBe('We chose Postgres because of constraints.')
    expect(outcome.scannedSessions).toBe(1)
    expect(outcome.truncated).toBe(false)
  })

  it('matches whitespace flexibly and case-insensitively', async () => {
    const query = fakeSessionQuery(sessions())
    const outcome = await scan(query, CALLER, 'CHOSE   postgres', undefined, 10, 10)
    expect(outcome.hits).toHaveLength(1)
  })

  it('caps matches and reports truncation', async () => {
    const query = fakeSessionQuery(sessions())
    const outcome = await scan(query, CALLER, 'postgres', undefined, 1, 10)
    expect(outcome.hits).toHaveLength(1)
    expect(outcome.truncated).toBe(true)
  })

  it('reports a per-session read failure without failing the scan', async () => {
    const fixtures = sessions()
    const failing: FakeSession = { ...fixtures[1]!, failScan: 'index unavailable' }
    const query = fakeSessionQuery([fixtures[0]!, failing])
    const outcome = await scan(query, CALLER, 'postgres', undefined, 10, 10)
    expect(outcome.hits).toHaveLength(0)
    expect(outcome.skipped).toEqual(['s-other: index unavailable'])
  })

  it('returns nothing for an empty workspace corpus', async () => {
    const query = fakeSessionQuery([{ header: fakeHeader('s-self', '/w'), events: [] }])
    const outcome = await scan(query, CALLER, 'postgres', undefined, 10, 10)
    expect(outcome.hits).toEqual([])
    expect(outcome.scannedSessions).toBe(0)
  })
})

describe('listAuthorized', () => {
  it('lists workspace sessions with titles and the pre-limit total', async () => {
    const query = fakeSessionQuery(sessions())
    const listing = await listAuthorized(query, CALLER, undefined, 10)
    expect(listing.total).toBe(2)
    expect(listing.items.map(item => item.id)).toEqual(['s-self', 's-other'])
    expect(listing.items[1]?.title).toBe('Design notes')
  })

  it('filters by title substring and applies the limit', async () => {
    const query = fakeSessionQuery(sessions())
    const filtered = await listAuthorized(query, CALLER, 'design', 10)
    expect(filtered.items.map(item => item.id)).toEqual(['s-other'])
    const limited = await listAuthorized(query, CALLER, undefined, 1)
    expect(limited.items).toHaveLength(1)
    expect(limited.total).toBe(2)
  })
})

describe('readAuthorized', () => {
  it('returns the exact event window', async () => {
    const query = fakeSessionQuery(sessions())
    const window = await readAuthorized(query, CALLER, SessionId('s-other'), 1, 1, 0)
    expect(window.startSeq).toBe(0)
    expect(window.endSeq).toBe(1)
    expect(window.events).toHaveLength(2)
  })

  it('denies a foreign target', async () => {
    const query = fakeSessionQuery(sessions())
    await expect(readAuthorized(query, CALLER, SessionId('s-foreign'), 0, 0, 0))
      .rejects.toThrowError(/not readable/)
  })

  it('rejects an observed header the caller may not read', async () => {
    const foreign: SessionEventWindow = {
      session: fakeHeader('s-other', '/elsewhere'),
      inheritedEventCount: 0 as SessionEventWindow['inheritedEventCount'],
      target: { type: 'user/message', seq: 0 as never, time: 0, data: {} as never },
      events: [],
      startSeq: 0 as never,
      endSeq: 0 as never,
    }
    const mismatching = {
      ...fakeSessionQuery(sessions()),
      async readEvent(_request: SessionEventReadRequest): Promise<SessionEventWindow> {
        return foreign
      },
      async filterSessions(_filters: readonly SessionResultFilter[]) {
        return [{ header: fakeHeader('s-other', '/w'), live: false, persisted: true }]
      },
    }
    await expect(readAuthorized(mismatching, CALLER, SessionId('s-other'), 0, 0, 0))
      .rejects.toThrowError(/not readable/)
  })
})
