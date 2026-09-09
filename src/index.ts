/**
 * Verbatim memory tools over `ctx.sessionQuery`.
 *
 * The plugin registers four read-only model tools. Every result is exact source
 * text plus provenance; no tool summarizes, paraphrases, or regenerates memory
 * content, and every read is authorized by exact workspace `cwd` equality.
 *
 * @module dsh-verbatim-memory
 */

import type { Context } from '@deepseek-ai/cordis'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { callerOf, requireSessionId } from './access.js'
import { bound, Config as ConfigSchema, resolveConfig } from './config.js'
import type { Config as ConfigShape, ResolvedConfig } from './config.js'
import { buildEvidenceBundle } from './evidence.js'
import { renderEvidence, renderHits, renderSessions, renderWindow } from './format.js'
import { listAuthorized, readAuthorized, requireQuery, scan } from './scan.js'

/** Loader-validated configuration schema for this plugin row. */
export const Config = ConfigSchema

/** Configurable surface of the memory tools plugin. */
export type Config = ConfigShape

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'verbatim-memory'

/** Capability services required by this model-facing consumer. */
export const inject = ['tools', 'systemPrompt', 'sessionQuery']

const TEXT_OUTPUT = {
  schema: { type: 'string' as const },
  render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
}

/**
 * Register the verbatim memory tools and their shared model guidance.
 * @param ctx - plugin context providing `tools`, `systemPrompt`, and `sessionQuery`.
 * @param config - loader-validated configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = resolveConfig(config)
  ctx.systemPrompt.section({
    name: 'tool:verbatim-memory',
    order: 114,
    text: resolved.promptGuidance,
  })

  ctx.tools.register(defineTool({
    name: 'memory_sessions',
    description: 'List sessions readable from this workspace with their latest title, cwd, and creation time.',
    parameters: {
      query: { type: 'string', description: 'Optional case-insensitive substring matched against session titles.' },
      limit: { type: 'integer', description: 'Maximum sessions returned.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      const caller = callerOf(exec)
      const limit = bound(args.limit, resolved.defaultSessionLimit, resolved.maxSessionLimit)
      const listing = await listAuthorized(ctx.sessionQuery, caller, args.query, limit)
      return renderSessions(listing.items, listing.total)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_search',
    description:
      'Search prior session events for a literal phrase and return exact matching text with sessionId and seq provenance. '
      + 'Never summarizes. The calling session is excluded from a cross-session scan.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Literal, case-insensitive phrase; a whitespace run matches one or more whitespace characters.',
      },
      session_id: { type: 'string', description: 'Restrict the scan to one authorized session id.' },
      limit: { type: 'integer', description: 'Maximum matches returned.' },
      max_sessions: { type: 'integer', description: 'Maximum sessions scanned in a cross-session search.' },
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const caller = callerOf(exec)
      const queryText = requireQuery(args.query)
      const limit = bound(args.limit, resolved.defaultSearchResults, resolved.maxSearchResults)
      const maxSessions = Math.max(1, bound(args.max_sessions, resolved.maxSessionsScanned, resolved.maxSessionsScanned))
      const outcome = await scan(
        ctx.sessionQuery,
        caller,
        queryText,
        args.session_id === undefined ? undefined : requireSessionId(args.session_id),
        limit,
        maxSessions,
      )
      return renderHits(queryText, outcome)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_read',
    description: 'Read one exact session event by session_id and seq, with optional neighboring events. Returns raw logged event JSON.',
    parameters: {
      session_id: { type: 'string', required: true, description: 'Authorized session id that owns the event.' },
      seq: { type: 'integer', required: true, description: 'Event sequence number to read.' },
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
      const window = await readAuthorized(
        ctx.sessionQuery,
        caller,
        requireSessionId(args.session_id),
        args.seq,
        bound(args.before, resolved.defaultReadWindow, resolved.maxReadWindow),
        bound(args.after, resolved.defaultReadWindow, resolved.maxReadWindow),
      )
      return renderWindow(window)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'memory_ask',
    description:
      'Return a lossless evidence bundle for a memory question: exact excerpts with provenance, explicit gaps, and a token estimate. '
      + 'Deterministic and non-generative; forward it to another agent without a lossy hop.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Literal, case-insensitive phrase to gather evidence for.',
      },
      budget_tokens: { type: 'integer', description: 'Maximum estimated tokens of excerpt text in the bundle.' },
      session_id: { type: 'string', description: 'Restrict the evidence search to one authorized session id.' },
    },
    output: TEXT_OUTPUT,
    execute: async (args, exec) => {
      const caller = callerOf(exec)
      const queryText = requireQuery(args.query)
      const budget = Math.max(1, bound(args.budget_tokens, resolved.defaultEvidenceBudget, resolved.maxEvidenceBudget))
      const outcome = await scan(
        ctx.sessionQuery,
        caller,
        queryText,
        args.session_id === undefined ? undefined : requireSessionId(args.session_id),
        resolved.maxSearchResults,
        resolved.maxSessionsScanned,
      )
      return renderEvidence(buildEvidenceBundle(queryText, outcome, budget))
    },
  }))
}

/** Resolved configuration type, exported for tests and embedders. */
export type { ResolvedConfig }
