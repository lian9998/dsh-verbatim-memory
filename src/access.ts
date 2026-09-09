/**
 * Caller identity and workspace authorization.
 *
 * A tool call may read only sessions whose `cwd` exactly equals the calling
 * agent's session `cwd`, mirroring the harness's own session-query tools. A
 * caller without `cwd` may read only itself.
 *
 * @module dsh-verbatim-memory/access
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import type { SessionRecord } from '@deepseek-ai/dsh-session-query'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

/** The calling agent's session identity and header. */
export interface Caller {
  /** Calling session id. */
  readonly id: ReturnType<typeof SessionId>
  /** Calling session header, carrying the workspace `cwd`. */
  readonly header: SessionHeader
}

/**
 * Resolve the calling agent from a tool execution.
 * @param exec - tool run context supplied by the registry.
 * @returns the caller identity.
 * @throws HarnessError when the execution is not agent-bound.
 */
export function callerOf(exec: ToolRunContext): Caller {
  const agent = exec.agent
  if (agent === undefined) {
    throw new HarnessError(
      'verbatim memory tools require an agent-bound caller',
      'VERBATIM_MEMORY_MISSING_AGENT',
    )
  }
  return { id: agent.session.id, header: agent.session.header }
}

/**
 * Whether one observed session header is readable by the caller.
 * @param header - observed session header.
 * @param caller - calling identity.
 * @returns true when the session is the caller itself or shares its exact `cwd`.
 */
export function headerAuthorized(header: SessionHeader, caller: Caller): boolean {
  if (header.id === caller.id) return header.cwd === caller.header.cwd
  return caller.header.cwd !== undefined && header.cwd === caller.header.cwd
}

/**
 * Filter observed records down to the caller's workspace.
 * @param records - corpus records from the session-query service.
 * @param caller - calling identity.
 * @returns authorized records in their original order.
 */
export function authorizedRecords(
  records: readonly SessionRecord[],
  caller: Caller,
): SessionRecord[] {
  return records.filter(record => headerAuthorized(record.header, caller))
}

/**
 * The single authorization failure surfaced to the model.
 * @returns a HarnessError that does not reveal whether the target exists.
 */
export function unauthorized(): HarnessError {
  return new HarnessError(
    'target session is not readable from this workspace',
    'VERBATIM_MEMORY_UNAUTHORIZED',
  )
}

/**
 * Parse a model-supplied session id.
 * @param raw - raw argument value.
 * @returns the branded session id.
 */
export function requireSessionId(raw: string): ReturnType<typeof SessionId> {
  return SessionId(raw)
}
