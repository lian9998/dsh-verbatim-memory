/**
 * Plain-text model-facing rendering.
 *
 * Renderers emit exact source text and provenance only; no renderer invents,
 * condenses, or reorders content. What a renderer *may* do is bound its own
 * size: a result set is truncated at an explicit marker that names the `seq`
 * needed to read the rest, so an oversized answer costs one line instead of an
 * entire spilled result.
 *
 * @module dsh-verbatim-memory/format
 */

import type { SessionEventWindow } from '@deepseek-ai/dsh-session-query'
import { DEFAULT_OUTPUT_CHARS, DEFAULT_ROW_CHARS } from './config.js'
import type { EvidenceBundle } from './evidence.js'
import type { ScanFilters } from './filters.js'
import { describeFilters } from './filters.js'
import type { ScanHit, ScanOutcome } from './scan.js'

/** Output budget applied to one rendered result set. */
export interface RenderBudget {
  /** Largest exact text block kept per row before a truncation marker. */
  readonly rowChars: number
  /** Largest total rendered block, including provenance lines. */
  readonly totalChars: number
}

/** Budget applied when a caller renders without deployment configuration. */
const DEFAULT_BUDGET: RenderBudget = { rowChars: DEFAULT_ROW_CHARS, totalChars: DEFAULT_OUTPUT_CHARS }

/**
 * Render literal scan matches from the calling session.
 * @param query - the literal phrase searched for.
 * @param outcome - scan matches, total count, and truncation state.
 * @param budget - output bound applied to the rendered block.
 * @returns the model-facing block.
 */
export function renderHits(query: string, outcome: ScanOutcome, budget: RenderBudget = DEFAULT_BUDGET): string {
  if (outcome.matched === 0) {
    return `No literal match for ${JSON.stringify(query)} in this session's log.`
  }
  const header = `${outcome.matched} exact match(es) for ${JSON.stringify(query)}${windowSuffix(outcome)}`
  if (outcome.hits.length === 0) {
    return `${header} · no rows at offset ${outcome.offset}`
  }
  return renderRowBlock(header, outcome, budget)
}

/**
 * Render an enumeration of logged events selected by metadata alone.
 * @param filters - the predicates that selected the rows.
 * @param outcome - enumerated rows, total count, and truncation state.
 * @param budget - output bound applied to the rendered block.
 * @returns the model-facing block.
 */
export function renderRows(
  filters: ScanFilters,
  outcome: ScanOutcome,
  budget: RenderBudget = DEFAULT_BUDGET,
): string {
  const selection = describeFilters(filters)
  if (outcome.matched === 0) {
    return `No logged event matches ${selection} in this session's log.`
  }
  return renderRowBlock(`${outcome.matched} event(s) matched ${selection}${windowSuffix(outcome)}`, outcome, budget)
}

/**
 * Render one exact raw-event window.
 * @param window - the exact event window from the session-query service.
 * @returns the model-facing block.
 */
export function renderWindow(window: SessionEventWindow): string {
  const header = `session ${window.session.id}  cwd=${window.session.cwd ?? '(none)'}  `
    + `window ${window.startSeq}..${window.endSeq}  target #${window.target.seq}`
  const events = window.events
    .map(event => `#${event.seq} ${event.type}\n${JSON.stringify(event, null, 2)}`)
    .join('\n\n')
  return `${header}\n\n${events}`
}

/**
 * Render an evidence bundle as stable JSON.
 * @param bundle - the lossless handoff value.
 * @returns the model-facing block.
 */
export function renderEvidence(bundle: EvidenceBundle): string {
  return JSON.stringify(bundle, null, 2)
}

/**
 * Describe how much of the result set the returned window covers.
 * @param outcome - scan outcome.
 * @returns a suffix naming the shown range and how to continue, or an empty string.
 */
function windowSuffix(outcome: ScanOutcome): string {
  if (!outcome.truncated) return ''
  const last = outcome.offset + outcome.hits.length - 1
  const shown = outcome.hits.length === 0 ? 'nothing shown' : `showing rows ${outcome.offset}-${last}`
  const next = outcome.nextOffset === undefined ? '' : ` · continue with offset ${outcome.nextOffset}`
  return ` · result set truncated: ${shown} of ${outcome.matched}${next}`
}

/**
 * Render provenance plus exact text rows inside one output budget.
 * @param header - the leading count and selection line.
 * @param outcome - rows to render.
 * @param budget - output bound applied to the block.
 * @returns the model-facing block.
 */
function renderRowBlock(header: string, outcome: ScanOutcome, budget: RenderBudget): string {
  const rows: string[] = []
  let used = header.length
  let omitted = 0
  for (const hit of outcome.hits) {
    if (used >= budget.totalChars) {
      omitted += 1
      continue
    }
    const row = renderRow(hit, budget, used)
    rows.push(row.text)
    used = row.used
  }
  const tail = omitted === 0
    ? ''
    : `\n\n…${omitted} row(s) omitted to respect the ${budget.totalChars}-character output budget; `
      + 'raise max_chars, page with offset, or read one row with memory_read.'
  return `${header}\n\n${rows.join('\n\n')}${tail}`
}

/**
 * Render one row, truncating its exact text only at an explicit marker.
 * @param hit - one scan match.
 * @param budget - output bound.
 * @param used - characters already consumed by preceding output.
 * @returns the rendered row and the new consumed count.
 */
function renderRow(hit: ScanHit, budget: RenderBudget, used: number): { text: string; used: number } {
  const head = `[#${hit.seq}] ${hit.type} @ ${new Date(hit.time).toISOString()} surface=${hit.surface}`
  const room = Math.max(0, Math.min(budget.rowChars, budget.totalChars - used - head.length - 1))
  const body = hit.text.length <= room
    ? hit.text
    : `${hit.text.slice(0, room)}…[+${hit.text.length - room} chars; memory_read({ seq: ${hit.seq} })]`
  const text = `${head}\n${body}`
  return { text, used: used + text.length + 2 }
}
