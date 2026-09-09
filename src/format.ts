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
import type { ScanOutcome, SessionSummary } from './scan.js'

/**
 * Render the authorized session list.
 * @param summaries - authorized sessions.
 * @param total - authorized sessions before the requested limit.
 * @returns the model-facing block.
 */
export function renderSessions(summaries: readonly SessionSummary[], total: number): string {
  if (summaries.length === 0) {
    return total === 0
      ? 'No sessions are readable from this workspace.'
      : `No session matched the title filter (${total} readable in this workspace).`
  }
  const body = summaries.map((summary) => {
    const title = summary.title ?? '(untitled)'
    const cwd = summary.cwd ?? '(none)'
    return [
      `session: ${summary.id}`,
      `  created: ${new Date(summary.createdAt).toISOString()}  live=${summary.live} persisted=${summary.persisted}`,
      `  cwd: ${cwd}`,
      `  title: ${title}`,
    ].join('\n')
  }).join('\n\n')
  return `${summaries.length} of ${total} readable session(s)\n\n${body}`
}

/**
 * Render literal scan matches.
 * @param query - the literal phrase searched for.
 * @param outcome - scan matches and diagnostics.
 * @returns the model-facing block.
 */
export function renderHits(query: string, outcome: ScanOutcome): string {
  const diagnostics = [
    `scanned ${outcome.scannedSessions} session(s)`,
    ...outcome.skipped.length === 0 ? [] : [`skipped ${outcome.skipped.length}: ${outcome.skipped.join('; ')}`],
    ...outcome.truncated ? ['result set truncated by the requested limit'] : [],
  ].join(' · ')
  if (outcome.hits.length === 0) {
    return `No literal match for ${JSON.stringify(query)} (${diagnostics}).`
  }
  const body = outcome.hits.map(hit => [
    `[${hit.sessionId}#${hit.seq}] ${hit.type} @ ${new Date(hit.time).toISOString()} surface=${hit.surface}`,
    hit.text,
  ].join('\n')).join('\n\n---\n\n')
  return `${outcome.hits.length} exact match(es) for ${JSON.stringify(query)} (${diagnostics})\n\n${body}`
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
