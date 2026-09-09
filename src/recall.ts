/**
 * Fork-backed associative recall.
 *
 * A literal scan answers "find this text" and cannot answer "is she angry?":
 * the caller does not know which words the log used. This module closes that
 * gap without granting the memory tools the right to invent content. It starts
 * a child agent through `ctx.subagents` — the same fork backend a caller would
 * otherwise drive by hand — gives that child only the read-only memory tools,
 * and asks it for one line plus the `seq`/`quote` pairs it relied on.
 *
 * The child's prose is returned as a labeled, unverified hint. Every excerpt is
 * re-read from the calling session's own log, and a pair is accepted only when
 * the quoted text is really present at the seq it named. The only generative
 * artifact is therefore marked, and the evidence path stays verbatim.
 *
 * The child receives this session's log as data, not as context: a fork seed
 * classifies inherited events `shadowed`, so the child must query, and this
 * module never pays to replay an archive into a prompt.
 *
 * @module dsh-verbatim-memory/recall
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { scanSession } from './scan.js'
import type { ScanHit, SessionQueryLike } from './scan.js'

/**
 * Tools the recall child may use. Everything else — including this tool, so a
 * child cannot recurse — is removed from its catalog.
 */
export const RECALL_CHILD_TOOLS = ['memory_list', 'memory_search', 'memory_read'] as const

/** Event types that mark a log as a seeded child session rather than a root session. */
const SEED_MARKERS: ReadonlySet<string> = new Set(['session/end-seed', 'subagent/descriptor'])

/** One text block handed to a child agent. */
export interface RecallPromptBlock {
  /** Content block discriminant. */
  readonly type: 'text'
  /** Block text. */
  readonly text: string
}

/** Child tool scoping accepted by a subagent provider. */
export interface RecallToolRestriction {
  /** Global tool names that stay visible; everything else is removed. */
  readonly allow?: readonly string[]
}

/** The `ctx.subagents.start` request fields this module supplies. */
export interface RecallStartRequest {
  /** Short display label persisted with the child session. */
  readonly label?: string
  /** Content delivered as the child's user message. */
  readonly prompt: readonly RecallPromptBlock[]
  /** The calling agent, whose log the child inherits. */
  readonly parent: Agent
  /** Cancellation signal from the calling tool execution. */
  readonly signal: AbortSignal
  /** Child tool scoping. */
  readonly toolFilter?: RecallToolRestriction
  /** Absolute delegation-depth cap for the child. */
  readonly maxDepth?: number
  /** Object-rooted schema the child's structured result must satisfy. */
  readonly outputSchema?: unknown
}

/** The child's terminal result, reduced to the fields this module consumes. */
export interface RecallChildResult {
  /** Final assistant output blocks. */
  readonly output?: readonly RecallPromptBlock[]
  /** Validated structured value when the child satisfied `outputSchema`. */
  readonly structured?: unknown
  /** Provider-authored failure detail for a non-completed stop reason. */
  readonly diagnostic?: string
  /** Why the child's run ended. */
  readonly stopReason?: string
}

/** One disposable child run. */
export interface RecallRun {
  /** Child session id. */
  readonly id?: string
  /** Resolves with the child's terminal result. */
  readonly result: Promise<RecallChildResult>
  /** Cancel remaining work and release resources. */
  dispose(): Promise<void>
}

/** The `ctx.subagents` surface this module consumes. */
export interface SubagentsLike {
  /** Start one child through the named provider. */
  start(name: string, request: RecallStartRequest): Promise<RecallRun>
}

/** How one recall resolved. */
export type RecallStatus = 'found' | 'empty' | 'unverified' | 'cancelled' | 'error'

/** The complete outcome of one recall, ready to render. */
export interface RecallOutcome {
  /** The question the child was asked. */
  readonly question: string
  /** Terminal classification of the recall. */
  readonly status: RecallStatus
  /** The child's one-line answer, unverified and clearly labeled as such. */
  readonly answer?: string
  /** Excerpts re-read from this session's log at the seqs the child named. */
  readonly evidence: readonly ScanHit[]
  /** Pairs the child returned that did not match this session's log. */
  readonly rejected: number
  /** Literal phrases the child reported trying. */
  readonly queries: readonly string[]
  /** Failure detail for a non-`found` status. */
  readonly note?: string
}

/** Everything one recall needs beyond the question. */
export interface RecallRequest {
  /** Subagent runtime resolved from the calling scope. */
  readonly subagents: SubagentsLike
  /** Provider name, e.g. `fork`. */
  readonly provider: string
  /** Session-query service used to verify the child's pointers. */
  readonly query: SessionQueryLike
  /** The calling session's id; the only session this recall may read. */
  readonly sessionId: SessionId
  /** The calling agent, used as the child's parent. */
  readonly parent: Agent
  /** Cancellation signal from the calling tool execution. */
  readonly signal: AbortSignal
  /** The associative question. */
  readonly question: string
  /** Maximum evidence pairs accepted from the child. */
  readonly maxSeqs: number
  /** Wall-clock budget for the child, in milliseconds. */
  readonly timeoutMs: number
}

/** Structured result shape requested from the recall child. */
export const RECALL_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          seq: { type: 'number' },
          quote: { type: 'string' },
        },
        required: ['seq', 'quote'],
        additionalProperties: false,
      },
    },
    queries: { type: 'array', items: { type: 'string' } },
  },
  required: ['answer', 'evidence'],
  additionalProperties: false,
} as const

/** Raised when a recall child outlives its wall-clock budget. */
class RecallTimeout extends Error {
  constructor() {
    super('recall child exceeded its timeout')
    this.name = 'RecallTimeout'
  }
}

/**
 * Reject an unusable question before starting a child.
 * @param raw - caller-supplied question text.
 * @returns the trimmed question.
 * @throws HarnessError when the question is empty.
 */
export function requireQuestion(raw: string): string {
  const question = raw.trim()
  if (question.length === 0) {
    throw new HarnessError(
      'question must contain at least one non-whitespace character',
      'VERBATIM_MEMORY_EMPTY_QUESTION',
    )
  }
  return question
}

/**
 * Whether one session log belongs to a seeded child agent.
 *
 * A recall child is a seeded child, so this is the recursion guard: a child that
 * somehow reached this tool would be refused rather than spawning a grandchild.
 * @param events - the session's raw log in ascending seq order.
 * @returns true when the log carries a seed boundary or a subagent descriptor.
 */
export function isSeededChild(events: readonly SessionEvent[]): boolean {
  return events.some(event => SEED_MARKERS.has(event.type as string))
}

/**
 * Build the child's user message: the question, the retrieval contract, and the
 * exact output shape. The child is told the archive is present as data, because
 * a fork seed does not put it in the child's visible context.
 * @param question - the associative question.
 * @param maxSeqs - maximum evidence pairs requested.
 * @returns one text block.
 */
export function buildRecallPrompt(question: string, maxSeqs: number): readonly RecallPromptBlock[] {
  return [{
    type: 'text',
    text: [
      'You are a retrieval index answering one question about an earlier part of this session.',
      '',
      `Question: ${question}`,
      '',
      'This session\'s full log is available through the memory tools, including events that compaction removed.',
      'Inherited events are classified surface=shadowed; that means "not in the visible context", not "deleted".',
      'Start with memory_list to map the log, then memory_search for literal phrases and memory_read to read one event in full.',
      'Try several phrasings before concluding that nothing exists.',
      '',
      'Return only:',
      '- `answer`: at most one sentence, or "no evidence".',
      `- \`evidence\`: at most ${maxSeqs} items, each {"seq": <number>, "quote": <exact text copied from that event>}.`,
      '- `queries`: the literal phrases you tried.',
      '',
      'Never invent a seq. `quote` must be copied verbatim from the event it names. Return no other prose.',
    ].join('\n'),
  }]
}

/** One evidence pair parsed from the child's structured result. */
interface ParsedEvidence {
  /** Seq the child named. */
  readonly seq: number
  /** Text the child claims is at that seq. */
  readonly quote: string
}

/**
 * Read the child's structured result defensively.
 * @param value - `structured`, when the child satisfied the schema.
 * @returns the answer, evidence pairs, and reported queries that were usable.
 */
export function parseRecallChild(value: unknown): {
  readonly answer?: string
  readonly evidence: readonly ParsedEvidence[]
  readonly queries: readonly string[]
} {
  const record = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
  const answer = typeof record.answer === 'string' && record.answer.trim().length > 0
    ? record.answer.trim()
    : undefined
  const queries = Array.isArray(record.queries)
    ? record.queries.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : []
  const evidence: ParsedEvidence[] = []
  if (Array.isArray(record.evidence)) {
    for (const item of record.evidence) {
      if (item === null || typeof item !== 'object') continue
      const candidate = item as Record<string, unknown>
      const rawSeq = typeof candidate.seq === 'number' ? candidate.seq : Number(candidate.seq)
      const quote = typeof candidate.quote === 'string' ? candidate.quote.trim() : ''
      if (!Number.isSafeInteger(rawSeq) || rawSeq < 0 || quote.length === 0) continue
      evidence.push({ seq: rawSeq, quote })
    }
  }
  return { ...answer === undefined ? {} : { answer }, evidence, queries }
}

/**
 * Resolve the optional subagent runtime from a scoped context.
 *
 * The memory tools must mount even when no subagent runtime exists, so the
 * service is read opportunistically rather than injected: without it, the other
 * four tools still work and `memory_recall` simply is not registered.
 * @param scope - the agent's scoped context.
 * @returns the runtime, or `undefined` when absent or unusable.
 */
export function resolveSubagents(scope: unknown): SubagentsLike | undefined {
  const getter = (scope as { get?: unknown }).get
  if (typeof getter !== 'function') return undefined
  const service = (getter as (name: string) => unknown).call(scope, 'subagents')
  if (service === null || typeof service !== 'object') return undefined
  return typeof (service as SubagentsLike).start === 'function' ? service as SubagentsLike : undefined
}

/**
 * Run one recall: start the child, wait within budget, then verify its pointers.
 * @param request - question, services, and bounds.
 * @returns the outcome, with evidence already re-read from the calling session.
 * @throws Error when the subagent runtime rejects the start request.
 */
export async function runRecall(request: RecallRequest): Promise<RecallOutcome> {
  const { question, maxSeqs } = request
  const run = await request.subagents.start(request.provider, {
    label: `memory_recall: ${question.slice(0, 60)}`,
    prompt: buildRecallPrompt(question, maxSeqs),
    parent: request.parent,
    signal: request.signal,
    toolFilter: { allow: [...RECALL_CHILD_TOOLS] },
    maxDepth: 1,
    outputSchema: RECALL_OUTPUT_SCHEMA,
  })
  let result: RecallChildResult
  try {
    result = await withTimeout(run.result, request.timeoutMs)
  } catch (error) {
    await run.dispose().catch(() => undefined)
    if (error instanceof RecallTimeout) {
      return { question, status: 'cancelled', evidence: [], rejected: 0, queries: [], note: 'the recall child exceeded its timeout' }
    }
    return {
      question,
      status: 'error',
      evidence: [],
      rejected: 0,
      queries: [],
      note: error instanceof Error ? error.message : String(error),
    }
  }
  await run.dispose().catch(() => undefined)

  const parsed = parseRecallChild(result.structured)
  const stop = result.stopReason ?? 'completed'
  if (stop !== 'completed' && parsed.evidence.length === 0) {
    return {
      question,
      status: 'error',
      evidence: [],
      rejected: 0,
      queries: parsed.queries,
      note: result.diagnostic ?? `the recall child ended with ${stop}`,
    }
  }

  const evidence: ScanHit[] = []
  const seen = new Set<number>()
  let rejected = 0
  for (const item of parsed.evidence.slice(0, maxSeqs)) {
    if (seen.has(item.seq)) {
      rejected += 1
      continue
    }
    seen.add(item.seq)
    const outcome = await scanSession(request.query, request.sessionId, item.quote, 1, {
      filters: { seqFrom: item.seq, seqTo: item.seq },
    })
    const hit = outcome.hits[0]
    if (hit === undefined) {
      rejected += 1
      continue
    }
    evidence.push(hit)
  }

  const status: RecallStatus = evidence.length > 0
    ? 'found'
    : parsed.evidence.length > 0 ? 'unverified' : 'empty'
  return {
    question,
    status,
    ...parsed.answer === undefined ? {} : { answer: parsed.answer },
    evidence,
    rejected,
    queries: parsed.queries,
    ...status === 'unverified'
      ? { note: 'every seq/quote pair the child returned failed to match this session\'s log' }
      : {},
  }
}

/**
 * Await a child result within a wall-clock budget.
 * @param promise - the child's terminal result.
 * @param ms - budget in milliseconds; a non-positive or non-finite value waits forever.
 * @returns the child's result.
 * @throws RecallTimeout when the budget elapses first.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return promise
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new RecallTimeout()), ms)
    const clear = (): void => { clearTimeout(timer) }
    promise.then(
      (value) => { clear(); resolve(value) },
      (error: unknown) => { clear(); reject(error instanceof Error ? error : new Error(String(error))) },
    )
  })
}
