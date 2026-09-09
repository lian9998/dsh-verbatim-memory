import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { buildEvidenceBundle, estimateTokens } from '../src/evidence.js'
import type { ScanOutcome } from '../src/scan.js'

function outcome(partial: Partial<ScanOutcome>): ScanOutcome {
  return {
    hits: [],
    scannedSessions: 0,
    skipped: [],
    truncated: false,
    ...partial,
  }
}

describe('estimateTokens', () => {
  it('is a conservative character-based estimate', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })
})

describe('buildEvidenceBundle', () => {
  it('returns exact excerpts with provenance', () => {
    const bundle = buildEvidenceBundle('postgres', outcome({
      scannedSessions: 2,
      hits: [{
        sessionId: SessionId('s-1'),
        seq: 4,
        type: 'user/message',
        time: 1_700_000_000_000,
        surface: 'shadowed',
        text: 'We chose Postgres because of constraints.',
      }],
    }), 1000)
    expect(bundle.results).toHaveLength(1)
    expect(bundle.results[0]).toMatchObject({
      id: 's-1#4',
      session_id: 's-1',
      seq: 4,
      surface: 'shadowed',
      exact_text: 'We chose Postgres because of constraints.',
      matched_phrase: 'postgres',
    })
    expect(bundle.results[0]?.time).toBe('2023-11-14T22:13:20.000Z')
    expect(bundle.missing).toEqual([])
    expect(bundle.truncated).toBe(false)
  })

  it('reports an explicit gap when nothing matched', () => {
    const bundle = buildEvidenceBundle('nothing', outcome({ scannedSessions: 3 }), 1000)
    expect(bundle.results).toEqual([])
    expect(bundle.missing[0]).toContain('no literal match')
    expect(bundle.scanned_sessions).toBe(3)
  })

  it('drops whole excerpts rather than truncating text', () => {
    const hit = (seq: number, text: string) => ({
      sessionId: SessionId('s-1'),
      seq,
      type: 'user/message',
      time: 0,
      surface: 'current' as const,
      text,
    })
    const bundle = buildEvidenceBundle('x', outcome({
      hits: [hit(1, 'x'.repeat(40)), hit(2, 'y'.repeat(40))],
    }), 12)
    expect(bundle.results).toHaveLength(1)
    expect(bundle.results[0]?.exact_text).toBe('x'.repeat(40))
    expect(bundle.truncated).toBe(true)
    expect(bundle.missing[0]).toContain('1 exact match(es) omitted')
  })

  it('carries per-session read failures through', () => {
    const bundle = buildEvidenceBundle('x', outcome({ skipped: ['s-9: unavailable'] }), 1000)
    expect(bundle.skipped).toEqual(['s-9: unavailable'])
  })
})
