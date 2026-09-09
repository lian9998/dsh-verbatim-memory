import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEventWindow } from '@deepseek-ai/dsh-session-query'
import { buildEvidenceBundle } from '../src/evidence.js'
import { renderEvidence, renderHits, renderWindow } from '../src/format.js'
import type { ScanOutcome } from '../src/scan.js'

const OUTCOME: ScanOutcome = {
  hits: [{
    seq: 2,
    type: 'user/message',
    time: 1_700_000_000_000,
    surface: 'current',
    text: 'exact text',
  }],
  truncated: false,
}

describe('renderHits', () => {
  it('reports no match inside this session', () => {
    const text = renderHits('q', { hits: [], truncated: false })
    expect(text).toBe('No literal match for "q" in this session\'s log.')
  })

  it('renders provenance and exact text', () => {
    const text = renderHits('exact', OUTCOME)
    expect(text).toContain('[#2] user/message')
    expect(text).toContain('exact text')
    expect(text).toContain('1 exact match(es)')
  })

  it('reports truncation', () => {
    expect(renderHits('exact', { ...OUTCOME, truncated: true })).toContain('truncated')
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
