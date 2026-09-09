/**
 * Caller-supplied metadata predicates shared by the retrieval tools.
 *
 * A literal phrase is the right index for "find this text" and the wrong one for
 * "show me every message I sent": set questions need metadata, not a guess at a
 * substring. The consumed `ctx.sessionQuery` service already accepts AND-ed
 * `type`, `surface`, `seq`, `time`, and `text` clauses, so this module only
 * validates caller input and projects it onto those clauses. It adds no new
 * capability, no index, and no cross-session reach.
 *
 * @module dsh-verbatim-memory/filters
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SessionEventType } from '@deepseek-ai/dsh-session'
import type {
  SessionEventResultFilter,
  SessionEventSurface,
} from '@deepseek-ai/dsh-session-query'

/** Surface classifications a caller may request, in fold order. */
export const SURFACE_VALUES = ['current', 'shadowed', 'log-only'] as const

/** Structured, text-independent predicates for one single-session scan. */
export interface ScanFilters {
  /** Event discriminants to include; omitted means every type. */
  readonly types?: readonly SessionEventType[]
  /** Surface classifications to include; omitted means every surface. */
  readonly surfaces?: readonly SessionEventSurface[]
  /** Inclusive lowest event seq. */
  readonly seqFrom?: number
  /** Inclusive highest event seq. */
  readonly seqTo?: number
  /** Inclusive earliest event time in Unix epoch milliseconds. */
  readonly timeFrom?: number
  /** Inclusive latest event time in Unix epoch milliseconds. */
  readonly timeTo?: number
}

/** The raw tool arguments that carry metadata predicates. */
export interface FilterArgs {
  /** Event types, as an array of strings. */
  readonly type?: unknown
  /** Surface classifications, as an array of strings. */
  readonly surface?: unknown
  /** Inclusive lowest seq. */
  readonly seq_from?: unknown
  /** Inclusive highest seq. */
  readonly seq_to?: unknown
  /** Inclusive earliest time in Unix epoch milliseconds. */
  readonly time_from?: unknown
  /** Inclusive latest time in Unix epoch milliseconds. */
  readonly time_to?: unknown
}

/**
 * Validate and project caller arguments into structured predicates.
 * @param args - raw tool arguments; every predicate is optional.
 * @returns the validated predicates, omitting every absent clause.
 * @throws HarnessError when a supplied value is unusable.
 */
export function parseFilters(args: FilterArgs): ScanFilters {
  const types = stringValues('type', args.type)
  const surfaces = stringValues('surface', args.surface)
  if (surfaces !== undefined) {
    for (const surface of surfaces) {
      if (!SURFACE_VALUES.includes(surface as SessionEventSurface)) {
        throw new HarnessError(
          `surface must be one of ${SURFACE_VALUES.join(', ')}`,
          'VERBATIM_MEMORY_INVALID_FILTER',
        )
      }
    }
  }
  const seqFrom = integerValue('seq_from', args.seq_from)
  const seqTo = integerValue('seq_to', args.seq_to)
  const timeFrom = integerValue('time_from', args.time_from)
  const timeTo = integerValue('time_to', args.time_to)
  return {
    ...types === undefined ? {} : { types: types as readonly SessionEventType[] },
    ...surfaces === undefined ? {} : { surfaces: surfaces as readonly SessionEventSurface[] },
    ...seqFrom === undefined ? {} : { seqFrom },
    ...seqTo === undefined ? {} : { seqTo },
    ...timeFrom === undefined ? {} : { timeFrom },
    ...timeTo === undefined ? {} : { timeTo },
  }
}

/**
 * Project structured predicates onto the service's AND-ed filter clauses.
 * @param filters - validated predicates.
 * @returns one clause per supplied predicate, in a fixed order.
 */
export function toClauses(filters: ScanFilters): readonly SessionEventResultFilter[] {
  const clauses: SessionEventResultFilter[] = []
  if (filters.types !== undefined) clauses.push({ kind: 'type', values: filters.types })
  if (filters.surfaces !== undefined) clauses.push({ kind: 'surface', values: filters.surfaces })
  const seq = rangeClause(filters.seqFrom, filters.seqTo)
  if (seq !== undefined) clauses.push({ kind: 'seq', ...seq })
  const time = rangeClause(filters.timeFrom, filters.timeTo)
  if (time !== undefined) clauses.push({ kind: 'time', ...time })
  return clauses
}

/**
 * Render one short, exact description of the applied predicates.
 * @param filters - validated predicates.
 * @returns `all events`, or the supplied predicates as `key=value` terms.
 */
export function describeFilters(filters: ScanFilters): string {
  const parts: string[] = []
  if (filters.types !== undefined) parts.push(`type=${filters.types.join('|')}`)
  if (filters.surfaces !== undefined) parts.push(`surface=${filters.surfaces.join('|')}`)
  if (filters.seqFrom !== undefined) parts.push(`seq>=${filters.seqFrom}`)
  if (filters.seqTo !== undefined) parts.push(`seq<=${filters.seqTo}`)
  if (filters.timeFrom !== undefined) parts.push(`time>=${filters.timeFrom}`)
  if (filters.timeTo !== undefined) parts.push(`time<=${filters.timeTo}`)
  return parts.length === 0 ? 'all events' : parts.join(' ')
}

/**
 * Normalize an optional scalar-or-array argument into non-empty strings.
 * @param name - argument name used in the error message.
 * @param raw - raw argument value.
 * @returns the trimmed values, or `undefined` when the argument was omitted.
 * @throws HarnessError when the argument is present but empty.
 */
function stringValues(name: string, raw: unknown): readonly string[] | undefined {
  if (raw === undefined || raw === null) return undefined
  const items = Array.isArray(raw) ? raw : [raw]
  const values = items
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(value => value.length > 0)
  if (values.length === 0) {
    throw new HarnessError(
      `${name} must contain at least one non-empty string`,
      'VERBATIM_MEMORY_INVALID_FILTER',
    )
  }
  return values
}

/**
 * Normalize an optional non-negative integer argument.
 * @param name - argument name used in the error message.
 * @param raw - raw argument value.
 * @returns the truncated integer, or `undefined` when the argument was omitted.
 * @throws HarnessError when the value is not a non-negative finite number.
 */
function integerValue(name: string, raw: unknown): number | undefined {
  if (raw === undefined || raw === null) return undefined
  const numeric = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(numeric) || numeric < 0) {
    throw new HarnessError(
      `${name} must be a non-negative number`,
      'VERBATIM_MEMORY_INVALID_FILTER',
    )
  }
  return Math.trunc(numeric)
}

/**
 * Build one inclusive range clause, if either bound was supplied.
 * @param from - inclusive lower bound.
 * @param to - inclusive upper bound.
 * @returns the clause bounds, or `undefined` when neither bound was supplied.
 */
function rangeClause(from: number | undefined, to: number | undefined): { from?: number; to?: number } | undefined {
  if (from === undefined && to === undefined) return undefined
  return {
    ...from === undefined ? {} : { from },
    ...to === undefined ? {} : { to },
  }
}
