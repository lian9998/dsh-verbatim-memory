/**
 * Detection of a compacted session.
 *
 * The memory tools exist to recover context that compaction removed, so they
 * stay hidden until this session's own surface actually carries a compaction
 * checkpoint. The marker is read from the durable log, which is why a resumed
 * session shows the tools immediately.
 *
 * @module dsh-verbatim-memory/checkpoint
 */

import { isCompactCheckpointSource } from '@deepseek-ai/dsh-compaction/checkpoint'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * Whether one logged event is the surface replacement written by a compaction.
 * @param event - raw logged session event.
 * @returns true when the event is a compaction checkpoint message.
 */
export function isCheckpointEvent(event: SessionEvent): boolean {
  if (event.type !== 'user/message') return false
  return isCompactCheckpointSource(event.data.source)
}

/**
 * Whether a session has ever compacted its context.
 * @param events - the session's raw log in ascending seq order.
 * @returns true when at least one compaction checkpoint is present.
 */
export function hasCompactionCheckpoint(events: readonly SessionEvent[]): boolean {
  for (const event of events) {
    if (isCheckpointEvent(event)) return true
  }
  return false
}
