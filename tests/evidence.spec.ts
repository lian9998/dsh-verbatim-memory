import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { buildEvidenceBundle, estimateTokens } from '../src/evidence.js'
import type { ScanOutcome } from '../src/scan.js'

const SESSION_ID = SessionId('s-self')

function outcome(partial: Partial<ScanOutcome>): ScanOutcome {
  return { hits: [], truncated: false, ...partial }
}

describe('estimateTokens', () => {
  it('is a conservative character-based estimate', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcde')).toBe(2)
  })
})

describe('buildEvidenceBundle', () => {
  it('returns exact excerpts bound to the calling session', () => {
    const bundle = buildEvidenceBundle('postgres', SESSION_ID, outcome({
      hits: [{
        seq: 4,
        type: 'user/message',
        time: 1_700_000_000_000,
        surface: 'shadowed',
        text: 'We chose Postgres because of constraints.',
      }],
    }), 1000)
    expect(bundle.session_id).toBe('s-self')
    expect(bundle.results).toHaveLength(1)
    expect(bundle.results[0]).toMatchObject({
      id: 's-self#4',
      session_id: 's-self',
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
    const bundle = buildEvidenceBundle('nothing', SESSION_ID, outcome({}), 1000)
    expect(bundle.results).toEqual([])
    expect(bundle.missing[0]).toContain('no literal match')
  })

  it('drops whole excerpts rather than truncating text', () => {
    const hit = (seq: number, text: string) => ({
      seq,
      type: 'user/message',
      time: 0,
      surface: 'current' as const,
      text,
    })
    const bundle = buildEvidenceBundle('x', SESSION_ID, outcome({
      hits: [hit(1, 'x'.repeat(40)), hit(2, 'y'.repeat(40))],
    }), 12)
    expect(bundle.results).toHaveLength(1)
    expect(bundle.results[0]?.exact_text).toBe('x'.repeat(40))
    expect(bundle.truncated).toBe(true)
    expect(bundle.missing[0]).toContain('1 exact match(es) omitted')
  })
})
