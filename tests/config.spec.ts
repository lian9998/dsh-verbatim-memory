import { describe, expect, it } from 'vitest'
import { bound, DEFAULT_LIST_RESULTS, DEFAULT_SEARCH_RESULTS, resolveConfig } from '../src/config.js'

describe('resolveConfig', () => {
  it('applies the documented defaults', () => {
    const resolved = resolveConfig()
    expect(resolved.defaultSearchResults).toBe(DEFAULT_SEARCH_RESULTS)
    expect(resolved.defaultListResults).toBe(DEFAULT_LIST_RESULTS)
    expect(resolved.exposeAfterCompaction).toBe(true)
    expect(resolved.promptGuidance).toContain('only this session')
    expect(resolved.promptGuidance).toContain('memory_list')
  })

  it('honours deployment overrides', () => {
    const resolved = resolveConfig({
      defaultSearchResults: 5,
      maxSearchResults: 10,
      defaultListResults: 7,
      maxListResults: 9,
      defaultRowChars: 100,
      maxRowChars: 200,
      defaultOutputChars: 300,
      maxOutputChars: 400,
      exposeAfterCompaction: false,
      promptGuidance: 'custom',
    })
    expect(resolved.defaultSearchResults).toBe(5)
    expect(resolved.maxSearchResults).toBe(10)
    expect(resolved.defaultListResults).toBe(7)
    expect(resolved.maxListResults).toBe(9)
    expect(resolved.rowChars).toBe(100)
    expect(resolved.maxRowChars).toBe(200)
    expect(resolved.defaultOutputChars).toBe(300)
    expect(resolved.maxOutputChars).toBe(400)
    expect(resolved.exposeAfterCompaction).toBe(false)
    expect(resolved.promptGuidance).toBe('custom')
  })

  it('rejects a default above its own maximum', () => {
    expect(() => resolveConfig({ defaultSearchResults: 10, maxSearchResults: 5 }))
      .toThrowError(/defaultSearchResults/)
    expect(() => resolveConfig({ defaultListResults: 10, maxListResults: 5 }))
      .toThrowError(/defaultListResults/)
    expect(() => resolveConfig({ defaultRowChars: 10, maxRowChars: 5 }))
      .toThrowError(/defaultRowChars/)
    expect(() => resolveConfig({ defaultOutputChars: 10, maxOutputChars: 5 }))
      .toThrowError(/defaultOutputChars/)
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
