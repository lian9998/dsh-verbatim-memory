/**
 * Deployment-owned configuration for the verbatim memory tools.
 *
 * Every tunable is a validated config field so a deployment can change it from
 * `cordis.yml`; no behavior is hardcoded in the tool bodies.
 *
 * @module dsh-verbatim-memory/config
 */

import z from '@deepseek-ai/schemastery'

/** Maximum matches returned by `memory_search` when the caller omits `limit`. */
export const DEFAULT_SEARCH_RESULTS = 20

/** Largest accepted `limit` for `memory_search`. */
export const DEFAULT_MAX_SEARCH_RESULTS = 100

/** Maximum rows returned by `memory_list` when the caller omits `limit`. */
export const DEFAULT_LIST_RESULTS = 50

/** Largest accepted `limit` for `memory_list`. */
export const DEFAULT_MAX_LIST_RESULTS = 500

/** Largest exact text block kept per rendered row before a truncation marker. */
export const DEFAULT_ROW_CHARS = 280

/** Largest accepted per-row text size. */
export const DEFAULT_MAX_ROW_CHARS = 4000

/** Total rendered size of one result set before rows are omitted. */
export const DEFAULT_OUTPUT_CHARS = 8000

/** Largest accepted total rendered size. */
export const DEFAULT_MAX_OUTPUT_CHARS = 60000

/** Maximum neighboring events returned by `memory_read` when the caller omits `before`/`after`. */
export const DEFAULT_READ_WINDOW = 0

/** Largest accepted `before`/`after` for `memory_read`. */
export const DEFAULT_MAX_READ_WINDOW = 50

/** Token budget applied by `memory_ask` when the caller omits `budget_tokens`. */
export const DEFAULT_EVIDENCE_BUDGET = 6000

/** Largest accepted `budget_tokens` for `memory_ask`. */
export const DEFAULT_MAX_EVIDENCE_BUDGET = 60000

/** Whether the tools stay hidden until the owning session has been compacted. */
export const DEFAULT_EXPOSE_AFTER_COMPACTION = true

/** Whether `memory_recall` is registered when a subagent runtime is available. */
export const DEFAULT_RECALL_ENABLED = true

/** Subagent provider `memory_recall` starts its child through. */
export const DEFAULT_RECALL_PROVIDER = 'fork'

/** Maximum evidence pairs accepted from one recall child. */
export const DEFAULT_RECALL_SEQS = 8

/** Largest accepted `max_seqs` for `memory_recall`. */
export const DEFAULT_MAX_RECALL_SEQS = 32

/** Wall-clock budget for one recall child, in milliseconds. */
export const DEFAULT_RECALL_TIMEOUT_MS = 120_000

/** Largest accepted recall timeout, in milliseconds. */
export const DEFAULT_MAX_RECALL_TIMEOUT_MS = 900_000

/** Model-facing guidance contributed while the memory tools are mounted. */
export const DEFAULT_PROMPT_GUIDANCE =
  'Earlier events of this session were compacted out of the visible context, but they remain exact in the session log. '
  + 'Use memory_list to enumerate logged events by type, surface, or seq range when the question is a set ("every message I sent"), '
  + 'memory_search to find a literal phrase, memory_read to expand one event by seq, and memory_ask for a budgeted evidence bundle. '
  + 'When you cannot name the words the log would contain — "is she angry?", "what did we decide about the sign convention?" — '
  + 'call memory_recall({ question }): it starts a child that inherits this session\'s log, lets it search, and returns verified excerpts '
  + 'with their seqs plus its own one-line answer, which is explicitly unverified and must not be quoted as fact. '
  + 'These tools never summarize their own results and read only this session. Quote retrieved text as-is and cite its seq. '
  + 'When a retrieval is broad enough that its raw hits would dominate this context, delegate it to subagent_fork: '
  + 'a forked child inherits this session\'s log, including compacted-away events, and gets these same tools, so it can search and report back. '
  + 'A fresh subagent has no memory tools and cannot read this log, and a fork sees history only up to its own start.'

/** Configurable surface of the memory tools plugin. */
export interface Config {
  /** Maximum matches returned by `memory_search` when the caller omits `limit`. */
  defaultSearchResults?: number
  /** Largest accepted `limit` for `memory_search`. */
  maxSearchResults?: number
  /** Maximum rows returned by `memory_list` when the caller omits `limit`. */
  defaultListResults?: number
  /** Largest accepted `limit` for `memory_list`. */
  maxListResults?: number
  /** Largest exact text block kept per rendered row. */
  defaultRowChars?: number
  /** Largest accepted per-row text size. */
  maxRowChars?: number
  /** Total rendered size of one result set when the caller omits `max_chars`. */
  defaultOutputChars?: number
  /** Largest accepted total rendered size. */
  maxOutputChars?: number
  /** Maximum neighboring events returned by `memory_read` when the caller omits `before`/`after`. */
  defaultReadWindow?: number
  /** Largest accepted `before`/`after` for `memory_read`. */
  maxReadWindow?: number
  /** Token budget applied by `memory_ask` when the caller omits `budget_tokens`. */
  defaultEvidenceBudget?: number
  /** Largest accepted `budget_tokens` for `memory_ask`. */
  maxEvidenceBudget?: number
  /** Keep the tools hidden until the owning session has been compacted. Defaults to `true`. */
  exposeAfterCompaction?: boolean
  /** Register `memory_recall` when a subagent runtime is available. Defaults to `true`. */
  recallEnabled?: boolean
  /** Subagent provider `memory_recall` starts its child through. Defaults to `fork`. */
  recallProvider?: string
  /** Maximum evidence pairs accepted from one recall child. */
  recallSeqs?: number
  /** Largest accepted `max_seqs` for `memory_recall`. */
  maxRecallSeqs?: number
  /** Wall-clock budget for one recall child, in milliseconds. */
  recallTimeoutMs?: number
  /** Largest accepted recall timeout, in milliseconds. */
  maxRecallTimeoutMs?: number
  /** Model-facing guidance contributed while these tools are visible. */
  promptGuidance?: string
}

/** Schemastery schema for loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  defaultSearchResults: z.number().step(1).min(1).default(DEFAULT_SEARCH_RESULTS),
  maxSearchResults: z.number().step(1).min(1).default(DEFAULT_MAX_SEARCH_RESULTS),
  defaultListResults: z.number().step(1).min(1).default(DEFAULT_LIST_RESULTS),
  maxListResults: z.number().step(1).min(1).default(DEFAULT_MAX_LIST_RESULTS),
  defaultRowChars: z.number().step(1).min(1).default(DEFAULT_ROW_CHARS),
  maxRowChars: z.number().step(1).min(1).default(DEFAULT_MAX_ROW_CHARS),
  defaultOutputChars: z.number().step(1).min(1).default(DEFAULT_OUTPUT_CHARS),
  maxOutputChars: z.number().step(1).min(1).default(DEFAULT_MAX_OUTPUT_CHARS),
  defaultReadWindow: z.number().step(1).min(0).default(DEFAULT_READ_WINDOW),
  maxReadWindow: z.number().step(1).min(0).default(DEFAULT_MAX_READ_WINDOW),
  defaultEvidenceBudget: z.number().step(1).min(1).default(DEFAULT_EVIDENCE_BUDGET),
  maxEvidenceBudget: z.number().step(1).min(1).default(DEFAULT_MAX_EVIDENCE_BUDGET),
  exposeAfterCompaction: z.boolean().default(DEFAULT_EXPOSE_AFTER_COMPACTION),
  recallEnabled: z.boolean().default(DEFAULT_RECALL_ENABLED),
  recallProvider: z.string().default(DEFAULT_RECALL_PROVIDER),
  recallSeqs: z.number().step(1).min(1).default(DEFAULT_RECALL_SEQS),
  maxRecallSeqs: z.number().step(1).min(1).default(DEFAULT_MAX_RECALL_SEQS),
  recallTimeoutMs: z.number().step(1).min(1).default(DEFAULT_RECALL_TIMEOUT_MS),
  maxRecallTimeoutMs: z.number().step(1).min(1).default(DEFAULT_MAX_RECALL_TIMEOUT_MS),
  promptGuidance: z.string().default(DEFAULT_PROMPT_GUIDANCE),
})

/** Validated configuration used by the tool bodies. */
export interface ResolvedConfig {
  readonly defaultSearchResults: number
  readonly maxSearchResults: number
  readonly defaultListResults: number
  readonly maxListResults: number
  readonly rowChars: number
  readonly maxRowChars: number
  readonly defaultOutputChars: number
  readonly maxOutputChars: number
  readonly defaultReadWindow: number
  readonly maxReadWindow: number
  readonly defaultEvidenceBudget: number
  readonly maxEvidenceBudget: number
  readonly exposeAfterCompaction: boolean
  readonly recallEnabled: boolean
  readonly recallProvider: string
  readonly defaultRecallSeqs: number
  readonly maxRecallSeqs: number
  readonly recallTimeoutMs: number
  readonly maxRecallTimeoutMs: number
  readonly promptGuidance: string
}

/**
 * Resolve and cross-check the plugin configuration.
 * @param config - loader-validated configuration; every field is optional.
 * @returns concrete bounds used by the tools.
 * @throws TypeError when a default exceeds its own maximum or a bound is not a safe integer.
 */
export function resolveConfig(config: Config = {}): ResolvedConfig {
  const resolved: ResolvedConfig = {
    defaultSearchResults: config.defaultSearchResults ?? DEFAULT_SEARCH_RESULTS,
    maxSearchResults: config.maxSearchResults ?? DEFAULT_MAX_SEARCH_RESULTS,
    defaultListResults: config.defaultListResults ?? DEFAULT_LIST_RESULTS,
    maxListResults: config.maxListResults ?? DEFAULT_MAX_LIST_RESULTS,
    rowChars: config.defaultRowChars ?? DEFAULT_ROW_CHARS,
    maxRowChars: config.maxRowChars ?? DEFAULT_MAX_ROW_CHARS,
    defaultOutputChars: config.defaultOutputChars ?? DEFAULT_OUTPUT_CHARS,
    maxOutputChars: config.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS,
    defaultReadWindow: config.defaultReadWindow ?? DEFAULT_READ_WINDOW,
    maxReadWindow: config.maxReadWindow ?? DEFAULT_MAX_READ_WINDOW,
    defaultEvidenceBudget: config.defaultEvidenceBudget ?? DEFAULT_EVIDENCE_BUDGET,
    maxEvidenceBudget: config.maxEvidenceBudget ?? DEFAULT_MAX_EVIDENCE_BUDGET,
    exposeAfterCompaction: config.exposeAfterCompaction ?? DEFAULT_EXPOSE_AFTER_COMPACTION,
    recallEnabled: config.recallEnabled ?? DEFAULT_RECALL_ENABLED,
    recallProvider: config.recallProvider ?? DEFAULT_RECALL_PROVIDER,
    defaultRecallSeqs: config.recallSeqs ?? DEFAULT_RECALL_SEQS,
    maxRecallSeqs: config.maxRecallSeqs ?? DEFAULT_MAX_RECALL_SEQS,
    recallTimeoutMs: config.recallTimeoutMs ?? DEFAULT_RECALL_TIMEOUT_MS,
    maxRecallTimeoutMs: config.maxRecallTimeoutMs ?? DEFAULT_MAX_RECALL_TIMEOUT_MS,
    promptGuidance: config.promptGuidance ?? DEFAULT_PROMPT_GUIDANCE,
  }
  const bounds: ReadonlyArray<[string, number]> = [
    ['defaultSearchResults', resolved.defaultSearchResults],
    ['maxSearchResults', resolved.maxSearchResults],
    ['defaultListResults', resolved.defaultListResults],
    ['maxListResults', resolved.maxListResults],
    ['defaultRowChars', resolved.rowChars],
    ['maxRowChars', resolved.maxRowChars],
    ['defaultOutputChars', resolved.defaultOutputChars],
    ['maxOutputChars', resolved.maxOutputChars],
    ['defaultReadWindow', resolved.defaultReadWindow],
    ['maxReadWindow', resolved.maxReadWindow],
    ['defaultEvidenceBudget', resolved.defaultEvidenceBudget],
    ['maxEvidenceBudget', resolved.maxEvidenceBudget],
    ['defaultRecallSeqs', resolved.defaultRecallSeqs],
    ['maxRecallSeqs', resolved.maxRecallSeqs],
    ['recallTimeoutMs', resolved.recallTimeoutMs],
    ['maxRecallTimeoutMs', resolved.maxRecallTimeoutMs],
  ]
  for (const [name, value] of bounds) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`verbatim-memory: ${name} must be a non-negative safe integer`)
    }
  }
  if (resolved.defaultSearchResults > resolved.maxSearchResults) {
    throw new TypeError('verbatim-memory: defaultSearchResults must not exceed maxSearchResults')
  }
  if (resolved.defaultListResults > resolved.maxListResults) {
    throw new TypeError('verbatim-memory: defaultListResults must not exceed maxListResults')
  }
  if (resolved.rowChars > resolved.maxRowChars) {
    throw new TypeError('verbatim-memory: defaultRowChars must not exceed maxRowChars')
  }
  if (resolved.defaultOutputChars > resolved.maxOutputChars) {
    throw new TypeError('verbatim-memory: defaultOutputChars must not exceed maxOutputChars')
  }
  if (resolved.defaultReadWindow > resolved.maxReadWindow) {
    throw new TypeError('verbatim-memory: defaultReadWindow must not exceed maxReadWindow')
  }
  if (resolved.defaultEvidenceBudget > resolved.maxEvidenceBudget) {
    throw new TypeError('verbatim-memory: defaultEvidenceBudget must not exceed maxEvidenceBudget')
  }
  if (resolved.defaultRecallSeqs > resolved.maxRecallSeqs) {
    throw new TypeError('verbatim-memory: recallSeqs must not exceed maxRecallSeqs')
  }
  if (resolved.recallTimeoutMs > resolved.maxRecallTimeoutMs) {
    throw new TypeError('verbatim-memory: recallTimeoutMs must not exceed maxRecallTimeoutMs')
  }
  if (resolved.recallProvider.trim().length === 0) {
    throw new TypeError('verbatim-memory: recallProvider must not be empty')
  }
  return resolved
}

/**
 * Clamp one caller-supplied bound into its accepted range.
 * @param value - raw argument value, absent when the caller omitted it.
 * @param fallback - value used when the caller omitted the argument.
 * @param max - largest accepted value.
 * @returns the resolved integer.
 */
export function bound(value: unknown, fallback: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.max(0, Math.min(max, Math.trunc(numeric)))
}
