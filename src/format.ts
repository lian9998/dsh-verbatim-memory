/**
 * Plain-text model-facing rendering.
 *
 * Renderers emit exact source text and provenance only; no renderer invents,
 * condenses, or reorders content.
 *
 * @module dsh-verbatim-memory/format
 */

import type { SessionEventWindow } from '@deepseek-ai/dsh-session-query'
import type { EvidenceBundle } from './evidence.js'
import type { ScanOutcome } from './scan.js'

/**
 * Render literal scan matches from the calling session.
 * @param query - the literal phrase searched for.
 * @param outcome - scan matches and truncation state.
 * @returns the model-facing block.
 */
export function renderHits(query: string, outcome: ScanOutcome): string {
  const diagnostics = outcome.truncated ? ' · result set truncated by the requested limit' : ''
  if (outcome.hits.length === 0) {
    return `No literal match for ${JSON.stringify(query)} in this session's log.`
  }
  const body = outcome.hits.map(hit => [
    `[#${hit.seq}] ${hit.type} @ ${new Date(hit.time).toISOString()} surface=${hit.surface}`,
    hit.text,
  ].join('\n')).join('\n\n---\n\n')
  return `${outcome.hits.length} exact match(es) for ${JSON.stringify(query)}${diagnostics}\n\n${body}`
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
