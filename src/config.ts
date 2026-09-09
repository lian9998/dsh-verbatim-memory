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

/** Model-facing guidance contributed while the memory tools are mounted. */
export const DEFAULT_PROMPT_GUIDANCE =
  'Earlier events of this session were compacted out of the visible context, but they remain exact in the session log. '
  + 'Use memory_search to find them verbatim, memory_read to read one raw logged event, and memory_ask for an evidence '
  + 'bundle of exact excerpts. These tools never summarize and search only this session. '
  + 'Quote retrieved text as-is and cite its seq.'

/** Configurable surface of the memory tools plugin. */
export interface Config {
  /** Maximum matches returned by `memory_search` when the caller omits `limit`. */
  defaultSearchResults?: number
  /** Largest accepted `limit` for `memory_search`. */
  maxSearchResults?: number
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
  /** Model-facing guidance contributed while these tools are visible. */
  promptGuidance?: string
}

/** Schemastery schema for loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  defaultSearchResults: z.number().step(1).min(1).default(DEFAULT_SEARCH_RESULTS),
  maxSearchResults: z.number().step(1).min(1).default(DEFAULT_MAX_SEARCH_RESULTS),
  defaultReadWindow: z.number().step(1).min(0).default(DEFAULT_READ_WINDOW),
  maxReadWindow: z.number().step(1).min(0).default(DEFAULT_MAX_READ_WINDOW),
  defaultEvidenceBudget: z.number().step(1).min(1).default(DEFAULT_EVIDENCE_BUDGET),
  maxEvidenceBudget: z.number().step(1).min(1).default(DEFAULT_MAX_EVIDENCE_BUDGET),
  exposeAfterCompaction: z.boolean().default(DEFAULT_EXPOSE_AFTER_COMPACTION),
  promptGuidance: z.string().default(DEFAULT_PROMPT_GUIDANCE),
})

/** Validated configuration used by the tool bodies. */
export interface ResolvedConfig {
  readonly defaultSearchResults: number
  readonly maxSearchResults: number
  readonly defaultReadWindow: number
  readonly maxReadWindow: number
  readonly defaultEvidenceBudget: number
  readonly maxEvidenceBudget: number
  readonly exposeAfterCompaction: boolean
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
    defaultReadWindow: config.defaultReadWindow ?? DEFAULT_READ_WINDOW,
    maxReadWindow: config.maxReadWindow ?? DEFAULT_MAX_READ_WINDOW,
    defaultEvidenceBudget: config.defaultEvidenceBudget ?? DEFAULT_EVIDENCE_BUDGET,
    maxEvidenceBudget: config.maxEvidenceBudget ?? DEFAULT_MAX_EVIDENCE_BUDGET,
    exposeAfterCompaction: config.exposeAfterCompaction ?? DEFAULT_EXPOSE_AFTER_COMPACTION,
    promptGuidance: config.promptGuidance ?? DEFAULT_PROMPT_GUIDANCE,
  }
  const bounds: ReadonlyArray<[string, number]> = [
    ['defaultSearchResults', resolved.defaultSearchResults],
    ['maxSearchResults', resolved.maxSearchResults],
    ['defaultReadWindow', resolved.defaultReadWindow],
    ['maxReadWindow', resolved.maxReadWindow],
    ['defaultEvidenceBudget', resolved.defaultEvidenceBudget],
    ['maxEvidenceBudget', resolved.maxEvidenceBudget],
  ]
  for (const [name, value] of bounds) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`verbatim-memory: ${name} must be a non-negative safe integer`)
    }
  }
  if (resolved.defaultSearchResults > resolved.maxSearchResults) {
    throw new TypeError('verbatim-memory: defaultSearchResults must not exceed maxSearchResults')
  }
  if (resolved.defaultReadWindow > resolved.maxReadWindow) {
    throw new TypeError('verbatim-memory: defaultReadWindow must not exceed maxReadWindow')
  }
  if (resolved.defaultEvidenceBudget > resolved.maxEvidenceBudget) {
    throw new TypeError('verbatim-memory: defaultEvidenceBudget must not exceed maxEvidenceBudget')
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
