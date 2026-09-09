import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEventWindow } from '@deepseek-ai/dsh-session-query'
import { buildEvidenceBundle } from '../src/evidence.js'
import { renderEvidence, renderHits, renderRows, renderWindow } from '../src/format.js'
import type { ScanOutcome } from '../src/scan.js'

const OUTCOME: ScanOutcome = {
  hits: [{
    seq: 2,
    type: 'user/message',
    time: 1_700_000_000_000,
    surface: 'current',
    text: 'exact text',
  }],
  matched: 1,
  offset: 0,
  truncated: false,
}

/** An empty result set over a non-empty corpus. */
const EMPTY: ScanOutcome = { hits: [], matched: 0, offset: 0, truncated: false }

describe('renderHits', () => {
  it('reports no match inside this session', () => {
    const text = renderHits('q', EMPTY)
    expect(text).toBe('No literal match for "q" in this session\'s log.')
  })

  it('renders provenance and exact text', () => {
    const text = renderHits('exact', OUTCOME)
    expect(text).toContain('[#2] user/message')
    expect(text).toContain('exact text')
    expect(text).toContain('1 exact match(es)')
  })

  it('reports truncation with the shown range and how to continue', () => {
    const text = renderHits('exact', { ...OUTCOME, matched: 5, truncated: true, nextOffset: 1 })
    expect(text).toContain('truncated: showing rows 0-0 of 5')
    expect(text).toContain('continue with offset 1')
  })

  it('explains an empty window past the end of the result set', () => {
    const text = renderHits('exact', { hits: [], matched: 5, offset: 9, truncated: false })
    expect(text).toContain('5 exact match(es)')
    expect(text).toContain('no rows at offset 9')
  })
})

describe('renderRows', () => {
  it('names the selection and renders exact text', () => {
    const text = renderRows({}, OUTCOME)
    expect(text).toContain('1 event(s) matched all events')
    expect(text).toContain('exact text')
    expect(text).toContain('surface=current')
  })

  it('names every applied predicate', () => {
    const text = renderRows({ surfaces: ['shadowed'] }, OUTCOME)
    expect(text).toContain('matched surface=shadowed')
  })

  it('says so when the selection is empty', () => {
    expect(renderRows({ surfaces: ['log-only'] }, EMPTY))
      .toBe('No logged event matches surface=log-only in this session\'s log.')
  })

  it('truncates a long row only at a marker that names its seq', () => {
    const long: ScanOutcome = {
      ...OUTCOME,
      hits: [{ ...OUTCOME.hits[0]!, text: 'x'.repeat(1000) }],
    }
    const text = renderRows({}, long, { rowChars: 10, totalChars: 8000 })
    expect(text).toContain('…[+990 chars; memory_read({ seq: 2 })]')
  })

  it('omits rows past the total budget with an explicit count', () => {
    const text = renderRows({}, OUTCOME, { rowChars: 280, totalChars: 10 })
    expect(text).toContain('1 row(s) omitted')
    expect(text).toContain('raise max_chars')
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
    const bundle = buildEvidenceBundle('exact', SessionId('s-1'), OUTCOME, 1000)
    const parsed = JSON.parse(renderEvidence(bundle)) as { results: unknown[]; session_id: string }
    expect(parsed.results).toHaveLength(1)
    expect(parsed.session_id).toBe('s-1')
  })
})
