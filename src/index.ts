/**
 * Verbatim memory tools over `ctx.sessionQuery`.
 *
 * The tools exist for exactly one job: recovering context that compaction
 * removed from this session. They therefore search only the calling session's
 * log and stay hidden until that session's own surface carries a compaction
 * checkpoint. Registration is per agent scope, so a session that never compacted
 * never sees them, and no tool can read another session.
 *
 * Every result is exact source text plus provenance. No tool summarizes,
 * paraphrases, or regenerates memory content. `memory_recall` is the one
 * apparent exception: it starts a child agent to search for a question whose
 * wording the caller cannot guess, but the child's prose is returned explicitly
 * labeled unverified and every excerpt it points at is re-read from this
 * session's own log before it reaches the caller.
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
import { parseFilters, SURFACE_VALUES } from './filters.js'
import { renderEvidence, renderHits, renderRecall, renderRows, renderWindow } from './format.js'
import type { RenderBudget } from './format.js'
import {
  isSubagentChild,
  requireQuestion,
  resolveSubagents,
  runRecall,
} from './recall.js'
import { readSessionEvent, requireQuery, scanSession } from './scan.js'

/** Loader-validated configuration schema for this plugin row. */
export const Config = ConfigSchema

/** Configurable surface of the memory tools plugin. */
export type Config = ConfigShape

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'verbatim-memory'

/** The standing plugin resolves live agents; each agent's scoped fiber resolves the rest. */
export const inject = ['agents']

/** Smallest output budget that still renders one usable row. */
const MIN_OUTPUT_CHARS = 200

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

/**
 * Metadata predicates shared by the enumeration and search tools.
 *
 * These are the service's own AND-ed clauses; exposing them is what lets a set
 * question ("every message I sent") be answered without guessing a substring.
 */
const RETRIEVAL_PARAMETERS = {
  type: {
    type: 'array',
    items: { type: 'string' },
    description: 'Event types to include, e.g. ["user/message","assistant/message","tool/result"]. Omit for every type.',
  },
  surface: {
    type: 'array',
    items: { type: 'string', enum: SURFACE_VALUES },
    description: 'Surface classifications: current (in context), shadowed (replaced by compaction), log-only (never on the surface).',
  },
  seq_from: { type: 'integer', description: 'Inclusive lowest event seq.' },
  seq_to: { type: 'integer', description: 'Inclusive highest event seq.' },
  time_from: { type: 'integer', description: 'Inclusive earliest event time in Unix epoch milliseconds.' },
  time_to: { type: 'integer', description: 'Inclusive latest event time in Unix epoch milliseconds.' },
  order: {
    type: 'string',
    enum: ['asc', 'desc'],
    description: 'Result order by seq. Defaults to asc (log order); desc returns the newest matches first.',
  },
  offset: { type: 'integer', description: 'Rows to skip, for paging a result set the header reported as truncated.' },
  max_chars: {
    type: 'integer',
    description: 'Largest total rendered size before rows are truncated or omitted. Defaults to the deployment budget.',
  },
} as const

/**
 * Resolve the output budget for one rendered result set.
 * @param rawMaxChars - caller-supplied total bound, if any.
 * @param resolved - validated deployment configuration.
 * @returns the per-row and total bounds applied by the renderer.
 */
function budgetOf(rawMaxChars: unknown, resolved: ResolvedConfig): RenderBudget {
  const totalChars = Math.max(
    MIN_OUTPUT_CHARS,
    bound(rawMaxChars, resolved.defaultOutputChars, resolved.maxOutputChars),
  )
  return { rowChars: resolved.rowChars, totalChars }
}

/**
 * Register the memory tools and their guidance in one agent scope.
 * @param scope - the agent's scoped context, providing `tools`, `systemPrompt`, and `sessionQuery`.
 * @param resolved - validated configuration.
 * @param agent - the agent whose scope this is; a subagent child gets the read-only subset.
 */
export function installMemoryTools(scope: Context, resolved: ResolvedConfig, agent: Agent): void {
  scope.systemPrompt.section({
    name: 'tool:verbatim-memory',
    order: 114,
    text: resolved.promptGuidance,
  })

  scope.tools.register(defineTool({
    name: 'memory_list',
    description:
      'Enumerate this session\'s own logged events by metadata (event type, surface, seq range, time range) with no text query, '
      + 'oldest or newest first. Use it for set questions — "every message I sent", "all tool results before the compaction" — '
      + 'which a literal search cannot answer in one call. Every row carries exact logged text and its seq; '
      + 'the header reports the total match count and how to page, and memory_read expands one row in full.',
    parameters: {
      ...RETRIEVAL_PARAMETERS,
      limit: { type: 'integer', description: 'Maximum rows returned.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      const caller = callerOf(exec)
      const filters = parseFilters(args)
      const limit = bound(args.limit, resolved.defaultListResults, resolved.maxListResults)
      const outcome = await scanSession(scope.sessionQuery, caller.id, undefined, limit, {
        filters,
        order: args.order,
        offset: bound(args.offset, 0, Number.MAX_SAFE_INTEGER),
      })
      return renderRows(filters, outcome, budgetOf(args.max_chars, resolved))
    },
  }))

  scope.tools.register(defineTool({
    name: 'memory_search',
    description:
      'Search this session\'s own event log for a literal phrase and return exact matching text with seq provenance, '
      + 'including events that compaction removed from the visible context. Narrow the search with the metadata filters when '
      + 'the phrase alone is too broad. Never summarizes and never reads another session.',
    parameters: {
      ...RETRIEVAL_PARAMETERS,
      query: {
        type: 'string',
        required: true,
        description: 'Literal, case-insensitive phrase; a whitespace run matches one or more whitespace characters.',
      },
      limit: { type: 'integer', description: 'Maximum matches returned.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      const caller = callerOf(exec)
      const queryText = requireQuery(args.query)
      const filters = parseFilters(args)
      const limit = bound(args.limit, resolved.defaultSearchResults, resolved.maxSearchResults)
      const outcome = await scanSession(scope.sessionQuery, caller.id, queryText, limit, {
        filters,
        order: args.order,
        offset: bound(args.offset, 0, Number.MAX_SAFE_INTEGER),
      })
      return renderHits(queryText, outcome, budgetOf(args.max_chars, resolved))
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

  // Recall is optional: it needs a subagent runtime, and the other four tools
  // must keep working when a deployment has none.
  const subagents = resolveSubagents(scope)
  if (!resolved.recallEnabled || subagents === undefined) return
  // A delegated child gets the read-only tools and nothing that starts another
  // agent. Leaving memory_recall out of its catalog is the first guard; the
  // refusal in the tool body is the second.
  if (isSubagentChild(agent)) return

  scope.tools.register(defineTool({
    name: 'memory_recall',
    description:
      'Ask a question whose exact wording you do not know — "is she angry?", "what did we decide about the sign convention?" — '
      + 'against this session\'s log. Starts a child agent that inherits the log, searches it with the read-only memory tools, '
      + 'and returns one line plus the seq/quote pairs it relied on. Every excerpt is re-read from this session at the named seq, '
      + 'and a pair that does not match is dropped, so the excerpts are exact evidence. The one-line answer is generative and is '
      + 'labeled unverified: never quote it as fact. Prefer memory_search when you can name the literal phrase.',
    parameters: {
      question: {
        type: 'string',
        required: true,
        description: 'The associative question to answer from this session\'s log.',
      },
      max_seqs: {
        type: 'integer',
        description: 'Maximum evidence pairs accepted from the child. Defaults to the deployment budget.',
      },
      max_chars: {
        type: 'integer',
        description: 'Largest total rendered size before rows are truncated or omitted. Defaults to the deployment budget.',
      },
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const caller = callerOf(exec)
      const question = requireQuestion(args.question)
      // callerOf already rejected an agent-less execution.
      const parent = exec.agent as Agent
      if (isSubagentChild(parent)) {
        throw new HarnessError(
          'memory_recall is unavailable to a subagent; a recall child has the read-only memory tools instead',
          'VERBATIM_MEMORY_RECURSIVE_RECALL',
        )
      }
      const outcome = await runRecall({
        subagents,
        provider: resolved.recallProvider,
        query: scope.sessionQuery,
        sessionId: caller.id,
        parent,
        signal: exec.signal,
        question,
        maxSeqs: bound(args.max_seqs, resolved.defaultRecallSeqs, resolved.maxRecallSeqs),
        timeoutMs: resolved.recallTimeoutMs,
      })
      return renderRecall(outcome, budgetOf(args.max_chars, resolved))
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
      installMemoryTools(scope, resolved, agent)
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
