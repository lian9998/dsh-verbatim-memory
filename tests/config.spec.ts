import { describe, expect, it } from 'vitest'
import {
  bound,
  DEFAULT_MAX_READ_WINDOW,
  DEFAULT_SESSION_LIMIT,
  resolveConfig,
} from '../src/config.js'

describe('resolveConfig', () => {
  it('applies the documented defaults', () => {
    const resolved = resolveConfig()
    expect(resolved.defaultSessionLimit).toBe(DEFAULT_SESSION_LIMIT)
    expect(resolved.maxReadWindow).toBe(DEFAULT_MAX_READ_WINDOW)
    expect(resolved.promptGuidance).toContain('never summarize')
  })

  it('honours deployment overrides', () => {
    const resolved = resolveConfig({ defaultSessionLimit: 5, maxSessionLimit: 10, promptGuidance: 'custom' })
    expect(resolved.defaultSessionLimit).toBe(5)
    expect(resolved.maxSessionLimit).toBe(10)
    expect(resolved.promptGuidance).toBe('custom')
  })

  it('rejects a default above its own maximum', () => {
    expect(() => resolveConfig({ defaultSessionLimit: 10, maxSessionLimit: 5 }))
      .toThrowError(/defaultSessionLimit must not exceed maxSessionLimit/)
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
