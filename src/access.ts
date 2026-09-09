/**
 * Caller identity.
 *
 * The tools read exactly one session — the caller's own — so no cross-session
 * authorization decision exists here. The caller is resolved from the tool
 * execution and every read is bound to its session id.
 *
 * @module dsh-verbatim-memory/access
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'

/** The calling agent's session identity. */
export interface Caller {
  /** Calling session id. */
  readonly id: SessionId
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
  return { id: agent.session.id }
}
