/**
 * Deployment-owned configuration for the verbatim memory tools.
 *
 * Every tunable is a validated config field so a deployment can change it from
 * `cordis.yml`; no behavior is hardcoded in the tool bodies.
 *
 * @module dsh-verbatim-memory/config
 */

import z from '@deepseek-ai/schemastery'

/** Maximum sessions returned by `memory_sessions` when the caller omits `limit`. */
export const DEFAULT_SESSION_LIMIT = 40

/** Largest accepted `limit` for `memory_sessions`. */
export const DEFAULT_MAX_SESSION_LIMIT = 200

/** Maximum matches returned by `memory_search` when the caller omits `limit`. */
export const DEFAULT_SEARCH_RESULTS = 20

/** Largest accepted `limit` for `memory_search`. */
export const DEFAULT_MAX_SEARCH_RESULTS = 100

/** Maximum authorized sessions scanned by one cross-session literal scan. */
export const DEFAULT_MAX_SESSIONS_SCANNED = 60

/** Maximum neighboring events returned by `memory_read` when the caller omits `before`/`after`. */
export const DEFAULT_READ_WINDOW = 0

/** Largest accepted `before`/`after` for `memory_read`. */
export const DEFAULT_MAX_READ_WINDOW = 50

/** Token budget applied by `memory_ask` when the caller omits `budget_tokens`. */
export const DEFAULT_EVIDENCE_BUDGET = 6000

/** Largest accepted `budget_tokens` for `memory_ask`. */
export const DEFAULT_MAX_EVIDENCE_BUDGET = 60000

/** Model-facing guidance contributed while the memory tools are mounted. */
export const DEFAULT_PROMPT_GUIDANCE =
  'Use memory_search to find prior work verbatim and memory_read to read the exact logged event; '
  + 'memory_ask returns an evidence bundle of exact excerpts with provenance. These tools never summarize. '
  + 'Quote retrieved text as-is and cite its session id and seq.'

/** Configurable surface of the memory tools plugin. */
export interface Config {
  /** Maximum sessions returned by `memory_sessions` when the caller omits `limit`. */
  defaultSessionLimit?: number
  /** Largest accepted `limit` for `memory_sessions`. */
  maxSessionLimit?: number
  /** Maximum matches returned by `memory_search` when the caller omits `limit`. */
  defaultSearchResults?: number
  /** Largest accepted `limit` for `memory_search`. */
  maxSearchResults?: number
  /** Maximum authorized sessions scanned by one cross-session literal scan. */
  maxSessionsScanned?: number
  /** Maximum neighboring events returned by `memory_read` when the caller omits `before`/`after`. */
  defaultReadWindow?: number
  /** Largest accepted `before`/`after` for `memory_read`. */
  maxReadWindow?: number
  /** Token budget applied by `memory_ask` when the caller omits `budget_tokens`. */
  defaultEvidenceBudget?: number
  /** Largest accepted `budget_tokens` for `memory_ask`. */
  maxEvidenceBudget?: number
  /** Model-facing guidance contributed while this plugin is mounted. */
  promptGuidance?: string
}

/** Schemastery schema for loader defaults and generated configuration docs. */
export const Config: z<Config> = z.object({
  defaultSessionLimit: z.number().step(1).min(1).default(DEFAULT_SESSION_LIMIT),
  maxSessionLimit: z.number().step(1).min(1).default(DEFAULT_MAX_SESSION_LIMIT),
  defaultSearchResults: z.number().step(1).min(1).default(DEFAULT_SEARCH_RESULTS),
  maxSearchResults: z.number().step(1).min(1).default(DEFAULT_MAX_SEARCH_RESULTS),
  maxSessionsScanned: z.number().step(1).min(1).default(DEFAULT_MAX_SESSIONS_SCANNED),
  defaultReadWindow: z.number().step(1).min(0).default(DEFAULT_READ_WINDOW),
  maxReadWindow: z.number().step(1).min(0).default(DEFAULT_MAX_READ_WINDOW),
  defaultEvidenceBudget: z.number().step(1).min(1).default(DEFAULT_EVIDENCE_BUDGET),
  maxEvidenceBudget: z.number().step(1).min(1).default(DEFAULT_MAX_EVIDENCE_BUDGET),
  promptGuidance: z.string().default(DEFAULT_PROMPT_GUIDANCE),
})

/** Validated configuration used by the tool bodies. */
export interface ResolvedConfig {
  readonly defaultSessionLimit: number
  readonly maxSessionLimit: number
  readonly defaultSearchResults: number
  readonly maxSearchResults: number
  readonly maxSessionsScanned: number
  readonly defaultReadWindow: number
  readonly maxReadWindow: number
  readonly defaultEvidenceBudget: number
  readonly maxEvidenceBudget: number
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
    defaultSessionLimit: config.defaultSessionLimit ?? DEFAULT_SESSION_LIMIT,
    maxSessionLimit: config.maxSessionLimit ?? DEFAULT_MAX_SESSION_LIMIT,
    defaultSearchResults: config.defaultSearchResults ?? DEFAULT_SEARCH_RESULTS,
    maxSearchResults: config.maxSearchResults ?? DEFAULT_MAX_SEARCH_RESULTS,
    maxSessionsScanned: config.maxSessionsScanned ?? DEFAULT_MAX_SESSIONS_SCANNED,
    defaultReadWindow: config.defaultReadWindow ?? DEFAULT_READ_WINDOW,
    maxReadWindow: config.maxReadWindow ?? DEFAULT_MAX_READ_WINDOW,
    defaultEvidenceBudget: config.defaultEvidenceBudget ?? DEFAULT_EVIDENCE_BUDGET,
    maxEvidenceBudget: config.maxEvidenceBudget ?? DEFAULT_MAX_EVIDENCE_BUDGET,
    promptGuidance: config.promptGuidance ?? DEFAULT_PROMPT_GUIDANCE,
  }
  for (const [name, value] of Object.entries(resolved)) {
    if (name === 'promptGuidance') continue
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`verbatim-memory: ${name} must be a non-negative safe integer`)
    }
  }
  if (resolved.defaultSessionLimit > resolved.maxSessionLimit) {
    throw new TypeError('verbatim-memory: defaultSessionLimit must not exceed maxSessionLimit')
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
