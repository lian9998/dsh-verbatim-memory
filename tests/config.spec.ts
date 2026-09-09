import { describe, expect, it } from 'vitest'
import { bound, DEFAULT_SEARCH_RESULTS, resolveConfig } from '../src/config.js'

describe('resolveConfig', () => {
  it('applies the documented defaults', () => {
    const resolved = resolveConfig()
    expect(resolved.defaultSearchResults).toBe(DEFAULT_SEARCH_RESULTS)
    expect(resolved.exposeAfterCompaction).toBe(true)
    expect(resolved.promptGuidance).toContain('only this session')
  })

  it('honours deployment overrides', () => {
    const resolved = resolveConfig({
      defaultSearchResults: 5,
      maxSearchResults: 10,
      exposeAfterCompaction: false,
      promptGuidance: 'custom',
    })
    expect(resolved.defaultSearchResults).toBe(5)
    expect(resolved.maxSearchResults).toBe(10)
    expect(resolved.exposeAfterCompaction).toBe(false)
    expect(resolved.promptGuidance).toBe('custom')
  })

  it('rejects a default above its own maximum', () => {
    expect(() => resolveConfig({ defaultSearchResults: 10, maxSearchResults: 5 }))
      .toThrowError(/defaultSearchResults/)
    expect(() => resolveConfig({ defaultReadWindow: 10, maxReadWindow: 5 }))
      .toThrowError(/defaultReadWindow/)
    expect(() => resolveConfig({ defaultEvidenceBudget: 10, maxEvidenceBudget: 5 }))
      .toThrowError(/defaultEvidenceBudget/)
  })

  it('rejects a non-integer or negative bound', () => {
    expect(() => resolveConfig({ maxSearchResults: -1 })).toThrowError(/non-negative safe integer/)
    expect(() => resolveConfig({ maxReadWindow: 1.5 })).toThrowError(/non-negative safe integer/)
  })
})

describe('bound', () => {
  it('clamps, truncates, and floors at zero', () => {
    expect(bound(5, 1, 10)).toBe(5)
    expect(bound(50, 1, 10)).toBe(10)
    expect(bound(-5, 1, 10)).toBe(0)
    expect(bound(3.9, 1, 10)).toBe(3)
  })

  it('falls back for absent or non-numeric input', () => {
    expect(bound(undefined, 7, 10)).toBe(7)
    expect(bound('abc', 7, 10)).toBe(7)
    expect(bound(Number.NaN, 7, 10)).toBe(7)
  })
})
