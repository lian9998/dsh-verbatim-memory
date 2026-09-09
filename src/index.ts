/**
 * Verbatim memory tools over `ctx.sessionQuery`.
 *
 * The tools exist for exactly one job: recovering context that compaction
 * removed from this session. They therefore search only the calling session's
 * log and stay hidden until that session's own surface carries a compaction
 * checkpoint. Registration is per agent scope, so a session that never compacted
 * never sees them, and no tool can read another session.
 *
 * Every result is exact source text plus provenance; no tool summarizes,
 * paraphrases, or regenerates memory content.
 *
 * @module dsh-verbatim-memory
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { callerOf } from './access.js'
import { hasCompactionCheckpoint, isCheckpointEvent } from './checkpoint.js'
import { bound, Config as ConfigSchema, resolveConfig } from './config.js'
import type { Config as ConfigShape, ResolvedConfig } from './config.js'
import { buildEvidenceBundle } from './evidence.js'
import { renderEvidence, renderHits, renderWindow } from './format.js'
import { readSessionEvent, requireQuery, scanSession } from './scan.js'

/** Loader-validated configuration schema for this plugin row. */
export const Config = ConfigSchema

/** Configurable surface of the memory tools plugin. */
export type Config = ConfigShape

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'verbatim-memory'

/** The standing plugin resolves live agents; each agent's scoped fiber resolves the rest. */
export const inject = ['agents']

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

/**
 * Register the three memory tools and their guidance in one agent scope.
 * @param scope - the agent's scoped context, providing `tools`, `systemPrompt`, and `sessionQuery`.
 * @param resolved - validated configuration.
 */
export function installMemoryTools(scope: Context, resolved: ResolvedConfig): void {
  scope.systemPrompt.section({
    name: 'tool:verbatim-memory',
    order: 114,
    text: resolved.promptGuidance,
  })

  scope.tools.register(defineTool({
    name: 'memory_search',
    description:
      'Search this session\'s own event log for a literal phrase and return exact matching text with seq provenance, '
      + 'including events that compaction removed from the visible context. Never summarizes and never reads another session.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Literal, case-insensitive phrase; a whitespace run matches one or more whitespace characters.',
      },
      limit: { type: 'integer', description: 'Maximum matches returned.' },
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const caller = callerOf(exec)
      const queryText = requireQuery(args.query)
      const limit = bound(args.limit, resolved.defaultSearchResults, resolved.maxSearchResults)
      const outcome = await scanSession(scope.sessionQuery, caller.id, queryText, limit)
      return renderHits(queryText, outcome)
    },
  }))

  scope.tools.register(defineTool({
    name: 'memory_read',
    description:
      'Read one exact event from this session by seq, with optional neighboring events. Returns raw logged event JSON.',
    parameters: {
      seq: { type: 'integer', required: true, description: 'Event sequence number to read in this session.' },
      before: { type: 'integer', description: 'Neighboring events before the target.' },
      after: { type: 'integer', description: 'Neighboring events after the target.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      const caller = callerOf(exec)
      if (!Number.isSafeInteger(args.seq) || args.seq < 0) {
        throw new HarnessError('seq must be a non-negative integer', 'VERBATIM_MEMORY_INVALID_SEQ')
      }
      const window = await readSessionEvent(
        scope.sessionQuery,
        caller.id,
        args.seq,
        bound(args.before, resolved.defaultReadWindow, resolved.maxReadWindow),
        bound(args.after, resolved.defaultReadWindow, resolved.maxReadWindow),
      )
      return renderWindow(window)
    },
  }))

  scope.tools.register(defineTool({
    name: 'memory_ask',
    description:
      'Return a lossless evidence bundle over this session\'s log: exact excerpts with seq provenance, explicit gaps, '
      + 'and a token estimate. Deterministic and non-generative; forward it without a lossy hop.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Literal, case-insensitive phrase to gather evidence for.',
      },
      budget_tokens: { type: 'integer', description: 'Maximum estimated tokens of excerpt text in the bundle.' },
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const caller = callerOf(exec)
      const queryText = requireQuery(args.query)
      const budget = Math.max(1, bound(args.budget_tokens, resolved.defaultEvidenceBudget, resolved.maxEvidenceBudget))
      const outcome = await scanSession(scope.sessionQuery, caller.id, queryText, resolved.maxSearchResults)
      return renderEvidence(buildEvidenceBundle(queryText, caller.id, outcome, budget))
    },
  }))
}

/**
 * Expose the memory tools for every live agent that qualifies.
 *
 * Registration happens in the agent's own scope, so the tools are absent from
 * every other agent's catalog and cannot be called across sessions.
 * @param ctx - standing plugin context.
 * @param config - loader-validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  const fibers = new Map<Agent, Fiber>()

  const install = (agent: Agent): void => {
    if (fibers.has(agent)) return
    if (resolved.exposeAfterCompaction && !hasCompactionCheckpoint(agent.session.snapshotEvents())) return
    const fiber = agent.ctx.inject(['tools', 'systemPrompt', 'sessionQuery'], (scope) => {
      installMemoryTools(scope, resolved)
    })
    fibers.set(agent, fiber)
  }

  const uninstall = (agent: Agent): void => {
    const fiber = fibers.get(agent)
    if (fiber === undefined) return
    fibers.delete(agent)
    void fiber.dispose()
  }

  for (const agent of ctx.agents.list()) install(agent)
  ctx.on('agent/created', ({ agent }) => { install(agent) })
  ctx.on('agent/disposed', ({ agent }) => { uninstall(agent) })
  ctx.on('session/event', (session, event) => {
    if (!isCheckpointEvent(event)) return
    const agent = ctx.agents.get(session.id)
    if (agent !== undefined) install(agent)
  })
  ctx.effect(() => async () => {
    const pending = [...fibers.values()]
    fibers.clear()
    await Promise.all(pending.map(fiber => fiber.dispose()))
  }, 'verbatim-memory: scoped tool fibers')
}
