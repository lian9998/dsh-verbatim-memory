import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEventWindow } from '@deepseek-ai/dsh-session-query'
import { buildEvidenceBundle } from '../src/evidence.js'
import { renderEvidence, renderHits, renderSessions, renderWindow } from '../src/format.js'
import type { ScanOutcome, SessionSummary } from '../src/scan.js'

const OUTCOME: ScanOutcome = {
  hits: [{
    sessionId: SessionId('s-1'),
    seq: 2,
    type: 'user/message',
    time: 1_700_000_000_000,
    surface: 'current',
    text: 'exact text',
  }],
  scannedSessions: 1,
  skipped: [],
  truncated: false,
}

describe('renderSessions', () => {
  it('reports an empty workspace', () => {
    expect(renderSessions([], 0)).toContain('No sessions are readable')
  })

  it('reports a title-filter miss', () => {
    expect(renderSessions([], 4)).toContain('No session matched the title filter (4 readable')
  })

  it('renders id, timestamps, cwd, and title', () => {
    const summary: SessionSummary = {
      id: SessionId('s-1'),
      cwd: '/w',
      createdAt: 1_700_000_000_000,
      title: 'Design notes',
      live: true,
      persisted: true,
    }
    const text = renderSessions([summary], 3)
    expect(text).toContain('1 of 3 readable session(s)')
    expect(text).toContain('session: s-1')
    expect(text).toContain('title: Design notes')
    expect(text).toContain('live=true persisted=true')
  })

  it('renders an untitled session without cwd', () => {
    const summary: SessionSummary = { id: SessionId('s-2'), createdAt: 0, live: false, persisted: false }
    const text = renderSessions([summary], 1)
    expect(text).toContain('(untitled)')
    expect(text).toContain('cwd: (none)')
  })
})

describe('renderHits', () => {
  it('reports diagnostics when nothing matched', () => {
    const text = renderHits('q', { hits: [], scannedSessions: 2, skipped: ['a: b'], truncated: true })
    expect(text).toContain('No literal match for "q"')
    expect(text).toContain('skipped 1: a: b')
    expect(text).toContain('truncated')
  })

  it('renders provenance and exact text', () => {
    const text = renderHits('exact', OUTCOME)
    expect(text).toContain('[s-1#2] user/message')
    expect(text).toContain('exact text')
    expect(text).toContain('scanned 1 session(s)')
  })
})

describe('renderWindow', () => {
  it('renders the exact raw event JSON', () => {
    const window: SessionEventWindow = {
      session: { version: 0, id: SessionId('s-1'), createdAt: 0, cwd: '/w', isSeeded: false },
      inheritedEventCount: 0 as SessionEventWindow['inheritedEventCount'],
      target: { type: 'user/message', seq: 3 as never, time: 5, data: { text: 'raw' } as never },
      events: [{ type: 'user/message', seq: 3 as never, time: 5, data: { text: 'raw' } as never }],
      startSeq: 3 as never,
      endSeq: 3 as never,
    }
    const text = renderWindow(window)
    expect(text).toContain('session s-1  cwd=/w')
    expect(text).toContain('window 3..3  target #3')
    expect(text).toContain('"text": "raw"')
  })
})

describe('renderEvidence', () => {
  it('serializes the bundle as stable JSON', () => {
    const bundle = buildEvidenceBundle('exact', OUTCOME, 1000)
    const parsed = JSON.parse(renderEvidence(bundle)) as { results: unknown[] }
    expect(parsed.results).toHaveLength(1)
  })
})
