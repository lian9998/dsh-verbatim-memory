import { describe, expect, it } from 'vitest'
import type { SessionEventType } from '@deepseek-ai/dsh-session'
import { describeFilters, parseFilters, SURFACE_VALUES, toClauses } from '../src/filters.js'

/** Brand a fixture event type for the filter contract. */
function types(...values: string[]): readonly SessionEventType[] {
  return values as readonly SessionEventType[]
}

describe('parseFilters', () => {
  it('omits every absent predicate', () => {
    expect(parseFilters({})).toEqual({})
    expect(parseFilters({ type: undefined, seq_from: null })).toEqual({})
  })

  it('trims array values', () => {
    expect(parseFilters({ type: [' user/message ', 'assistant/message'] }).types)
      .toEqual(['user/message', 'assistant/message'])
  })

  it('accepts a bare scalar for convenience', () => {
    expect(parseFilters({ surface: 'shadowed' }).surfaces).toEqual(['shadowed'])
  })

  it('rejects an unknown surface', () => {
    expect(() => parseFilters({ surface: ['ghost'] })).toThrowError(/surface must be one of current, shadowed, log-only/)
  })

  it('rejects a present but empty list', () => {
    expect(() => parseFilters({ type: [] })).toThrowError(/at least one non-empty string/)
    expect(() => parseFilters({ type: ['   '] })).toThrowError(/at least one non-empty string/)
  })

  it('rejects a negative or non-numeric bound', () => {
    expect(() => parseFilters({ seq_from: -1 })).toThrowError(/seq_from must be a non-negative number/)
    expect(() => parseFilters({ time_to: 'soon' })).toThrowError(/time_to must be a non-negative number/)
  })

  it('keeps inclusive ranges', () => {
    expect(parseFilters({ seq_from: 3, seq_to: 9, time_from: 100 })).toEqual({ seqFrom: 3, seqTo: 9, timeFrom: 100 })
  })
})

describe('toClauses', () => {
  it('emits one clause per predicate in a fixed order', () => {
    const clauses = toClauses({
      types: types('user/message'),
      surfaces: ['shadowed'],
      seqFrom: 1,
      timeTo: 9,
    })
    expect(clauses).toEqual([
      { kind: 'type', values: ['user/message'] },
      { kind: 'surface', values: ['shadowed'] },
      { kind: 'seq', from: 1 },
      { kind: 'time', to: 9 },
    ])
  })

  it('emits nothing without predicates', () => {
    expect(toClauses({})).toEqual([])
  })
})

describe('describeFilters', () => {
  it('names every applied predicate', () => {
    expect(describeFilters({
      types: types('user/message'),
      surfaces: ['current', 'shadowed'],
      seqFrom: 2,
      seqTo: 7,
      timeFrom: 10,
      timeTo: 20,
    })).toBe('type=user/message surface=current|shadowed seq>=2 seq<=7 time>=10 time<=20')
  })

  it('reports an unfiltered selection', () => {
    expect(describeFilters({})).toBe('all events')
  })

  it('publishes the accepted surfaces', () => {
    expect(SURFACE_VALUES).toEqual(['current', 'shadowed', 'log-only'])
  })
})
