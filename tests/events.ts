/**
 * Shared session-event fixtures.
 *
 * @module dsh-verbatim-memory/tests/events
 */

import { compactCheckpointSource } from '@deepseek-ai/dsh-compaction/checkpoint'
import type { CompactionId } from '@deepseek-ai/dsh-compaction'
import type { MessageId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { seq } from './fake-session-query.js'

/** A compaction surface-replacement event. */
export function checkpointEvent(): SessionEvent {
  return {
    type: 'user/message',
    seq: seq(9),
    time: 0,
    data: {
      id: 'm-checkpoint' as MessageId,
      role: 'user',
      content: [{ type: 'text', text: 'checkpoint' }],
      source: compactCheckpointSource('compaction-1' as CompactionId),
    },
  } as unknown as SessionEvent
}

/** An ordinary user message event. */
export function userEvent(text: string): SessionEvent {
  return {
    type: 'user/message',
    seq: seq(1),
    time: 0,
    data: {
      id: 'm-user' as MessageId,
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: 'user' },
    },
  } as unknown as SessionEvent
}

/** A tool-result event with no semantic text. */
export function toolResultEvent(): SessionEvent {
  return {
    type: 'tool/result',
    seq: seq(2),
    time: 0,
    data: { turn: 1, step: 1, message: {} },
  } as unknown as SessionEvent
}
