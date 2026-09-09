import { describe, expect, it } from 'vitest'
import { hasCompactionCheckpoint, isCheckpointEvent } from '../src/checkpoint.js'
import { checkpointEvent, toolResultEvent, userEvent } from './events.js'

describe('isCheckpointEvent', () => {
  it('recognizes the compaction surface replacement', () => {
    expect(isCheckpointEvent(checkpointEvent())).toBe(true)
  })

  it('ignores ordinary user messages and other event types', () => {
    expect(isCheckpointEvent(userEvent('hello'))).toBe(false)
    expect(isCheckpointEvent(toolResultEvent())).toBe(false)
  })
})

describe('hasCompactionCheckpoint', () => {
  it('is false for an empty or never-compacted log', () => {
    expect(hasCompactionCheckpoint([])).toBe(false)
    expect(hasCompactionCheckpoint([userEvent('hi'), toolResultEvent()])).toBe(false)
  })

  it('is true once any checkpoint exists, including a shadowed one', () => {
    expect(hasCompactionCheckpoint([userEvent('hi'), checkpointEvent(), userEvent('later')])).toBe(true)
  })
})
