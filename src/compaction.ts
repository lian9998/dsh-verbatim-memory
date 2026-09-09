/**
 * Lossless compaction backend: pressure and retention come from
 * `@deepseek-ai/dsh-compaction-basic`, but the summarization hook is replaced
 * by a deterministic retrieval stub. No model call is made, no generated text
 * ever becomes memory, and the elided events stay exact in the session log.
 *
 * @module dsh-verbatim-memory/compaction
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { BasicCompactionConfig } from '@deepseek-ai/dsh-compaction-basic'
import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'

/** Default cap on exact user text embedded in one stub. */
export const DEFAULT_MAX_QUOTE_CHARS = 2000

/** Configurable surface of the verbatim compaction backend. */
export type VerbatimCompactionConfig = Omit<
  BasicCompactionConfig,
  'summarizationProvider' | 'summarizationModel' | 'maxTokens'
> & {
  /** Embed the exact user text of the elided span when it fits `maxQuoteChars`. Defaults to `false`. */
  includeUserQuotes?: boolean
  /** Largest total size of embedded exact user text. Defaults to `2000`. */
  maxQuoteChars?: number
}

const ratioSchema = z.number()
const tokensSchema = z.number().step(1).min(0)
const retriesSchema = z.number().step(1).min(0)

const modelPolicySchema = z.object({
  provider: z.string().required(),
  model: z.string().required(),
  thresholdRatio: ratioSchema,
  retainRatio: ratioSchema,
  retainTokens: tokensSchema,
  compactionRetries: retriesSchema,
  maxOverflowRetries: retriesSchema,
})

const configSchema: z<VerbatimCompactionConfig> = z.object({
  thresholdRatio: ratioSchema,
  retainRatio: ratioSchema,
  retainTokens: tokensSchema,
  compactionRetries: retriesSchema,
  maxOverflowRetries: retriesSchema,
  modelPolicies: z.array(modelPolicySchema),
  auto: z.boolean(),
  includeUserQuotes: z.boolean(),
  maxQuoteChars: z.number().step(1).min(0),
})

/** Schemastery schema for loader validation and generated configuration docs. */
export const Config = configSchema

/** Cordis plugin name used by Loader diagnostics. */
export const name = 'compaction-verbatim'

/** This module registers a service through its own plugin class. */
export const inject: string[] = []

/** The shadowed surface a backend would otherwise summarize. */
export interface VerbatimSummarizationInput {
  /** Conversation system prompt, unused by this backend. */
  readonly system?: string
  /** Conversation tool schemas, unused by this backend. */
  readonly tools?: readonly unknown[]
  /** The shadowed region in surface order. */
  readonly messages: readonly Message[]
}

/** A summary result produced without any model call. */
export interface VerbatimSummary {
  /** The deterministic retrieval stub, framed by the base backend. */
  readonly summary: ContentBlock[]
  /** Recorded provenance for the checkpoint event. */
  readonly provider: string
  /** Recorded provenance for the checkpoint event. */
  readonly model: string
  /** Unmarked result: no `ctx.llm.stream()` call produced it. */
  readonly llmStreamCall?: never
}

/** Resolved verbatim-only options. */
export interface ResolvedVerbatim {
  /** Whether exact user text is embedded in the stub. */
  readonly includeUserQuotes: boolean
  /** Largest total size of embedded exact user text. */
  readonly maxQuoteChars: number
}

/**
 * Count the shadowed region by message kind and collect tool names.
 * @param messages - shadowed messages in surface order.
 * @returns per-kind counts, sorted tool names, and exact user text blocks.
 */
export function summarizeRegion(messages: readonly Message[]): {
  userMessages: number
  assistantMessages: number
  toolResults: number
  toolNames: readonly string[]
  userTexts: readonly string[]
} {
  let userMessages = 0
  let assistantMessages = 0
  let toolResults = 0
  const toolNames = new Set<string>()
  const userTexts: string[] = []
  for (const message of messages) {
    let carriesToolResult = false
    for (const block of message.content) {
      if (block.type === 'tool-call') toolNames.add(block.name)
      if (block.type === 'tool-result') {
        carriesToolResult = true
        toolResults += 1
      }
      if (block.type === 'text' && message.role === 'user' && !carriesToolResult) userTexts.push(block.text)
    }
    if (message.role === 'assistant') assistantMessages += 1
    else if (message.role === 'user' && !carriesToolResult) userMessages += 1
  }
  return {
    userMessages,
    assistantMessages,
    toolResults,
    toolNames: [...toolNames].sort(),
    userTexts,
  }
}

/**
 * Build the deterministic checkpoint body. It carries metadata and retrieval
 * instructions only; it never states what the elided events meant.
 * @param input - the shadowed surface.
 * @param sessionId - owning session id used by the retrieval hints.
 * @param resolved - verbatim-only options.
 * @returns the checkpoint text placed inside the framed checkpoint message.
 */
export function buildVerbatimStub(
  input: VerbatimSummarizationInput,
  sessionId: string,
  resolved: ResolvedVerbatim,
): string {
  const region = summarizeRegion(input.messages)
  const lines = [
    'VERBATIM RETENTION CHECKPOINT — no summary was generated.',
    '',
    `Session: ${sessionId}`,
    `Elided from the active surface: ${input.messages.length} message(s) — `
      + `${region.userMessages} user, ${region.assistantMessages} assistant, ${region.toolResults} tool result.`,
  ]
  if (region.toolNames.length > 0) lines.push(`Tools used: ${region.toolNames.join(', ')}`)
  lines.push(
    '',
    'The elided events are unchanged in the session log, and this session\'s verbatim memory tools are now available.',
    'Retrieve them exactly:',
    '  memory_search({ query })',
    '  memory_read({ seq, before, after })',
    '  memory_ask({ query })',
    'Continue from the messages that follow; do not restate this checkpoint.',
  )
  const quotes = selectQuotes(region.userTexts, resolved)
  if (quotes !== undefined) {
    lines.push('', 'Exact user text from the elided span:', '---', quotes, '---')
  }
  return lines.join('\n')
}

/**
 * Select exact user text to embed, all-or-nothing per message.
 * @param userTexts - exact user text blocks in surface order.
 * @param resolved - verbatim-only options.
 * @returns the joined exact text, or `undefined` when nothing fits.
 */
function selectQuotes(userTexts: readonly string[], resolved: ResolvedVerbatim): string | undefined {
  if (!resolved.includeUserQuotes) return undefined
  const selected: string[] = []
  let used = 0
  for (const text of userTexts) {
    if (used + text.length > resolved.maxQuoteChars) break
    selected.push(text)
    used += text.length
  }
  return selected.length === 0 ? undefined : selected.join('\n---\n')
}

/** Project the verbatim config onto the base backend's config. */
function toBasicConfig(config: VerbatimCompactionConfig): BasicCompactionConfig {
  const basic: BasicCompactionConfig = {}
  if (config.thresholdRatio !== undefined) basic.thresholdRatio = config.thresholdRatio
  if (config.retainRatio !== undefined) basic.retainRatio = config.retainRatio
  if (config.retainTokens !== undefined) basic.retainTokens = config.retainTokens
  if (config.compactionRetries !== undefined) basic.compactionRetries = config.compactionRetries
  if (config.maxOverflowRetries !== undefined) basic.maxOverflowRetries = config.maxOverflowRetries
  if (config.modelPolicies !== undefined) basic.modelPolicies = [...config.modelPolicies]
  if (config.auto !== undefined) basic.auto = config.auto
  return basic
}

/**
 * Compaction backend whose `summarize()` hook returns a deterministic stub.
 *
 * Pressure measurement, retention selection, tool-pair boundaries, the durable
 * `compaction/*` bracket, shrink validation, and overflow recovery are inherited
 * unchanged from `BasicCompactionEngine`.
 */
export class VerbatimCompactionEngine extends BasicCompactionEngine {
  /**
   * Loader schema shadowing the base policy schema so verbatim-only options are
   * accepted and validated instead of being rejected as unknown keys.
   */
  static override Config = configSchema

  private readonly verbatim: ResolvedVerbatim

  /**
   * @param ctx - plugin context; the base class injects `llm`, `tokenMeter`, and `sessions`.
   * @param config - verbatim compaction configuration.
   */
  constructor(ctx: Context, config: VerbatimCompactionConfig = {}) {
    super(ctx, toBasicConfig(config))
    this.verbatim = {
      includeUserQuotes: config.includeUserQuotes ?? false,
      maxQuoteChars: config.maxQuoteChars ?? DEFAULT_MAX_QUOTE_CHARS,
    }
  }

  /**
   * Produce the checkpoint without any model call.
   * @param input - the shadowed surface.
   * @param agent - owning agent, supplying the session id.
   * @returns a stub summary marked as not produced by `ctx.llm.stream()`.
   */
  protected override async summarize(
    input: VerbatimSummarizationInput,
    agent: Agent,
    _signal?: AbortSignal,
  ): Promise<VerbatimSummary> {
    return {
      summary: [{ type: 'text', text: buildVerbatimStub(input, agent.session.id, this.verbatim) }],
      provider: 'verbatim',
      model: 'deterministic',
    }
  }
}

/**
 * Register the verbatim compaction backend.
 * @param ctx - plugin context.
 * @param config - loader-validated configuration.
 */
export function apply(ctx: Context, config: VerbatimCompactionConfig): void {
  ctx.plugin(VerbatimCompactionEngine, config)
}
