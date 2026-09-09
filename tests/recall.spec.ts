import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.js'
import type { Config } from '../src/index.js'
import {
  RECALL_CHILD_ALLOWED_TOOLS,
  RECALL_CHILD_LABEL_PREFIX,
  RECALL_CHILD_TOOLS,
  RECALL_OUTPUT_SCHEMA,
  buildRecallPrompt,
  isRecallChild,
  isSubagentChild,
  parseRecallChild,
} from '../src/recall.js'
import type { RecallChildResult, RecallStartRequest, SubagentsLike } from '../src/recall.js'
import { fakeAgent, fakeHarness, type FakeScope } from './fake-harness.js'
import { fakeHeader, fakeSessionQuery, type FakeSession } from './fake-session-query.js'
import { checkpointEvent } from './events.js'

function sessionFixture(): FakeSession {
  return {
    header: fakeHeader('s-self', '/w'),
    events: [
      { seq: 0, type: 'user/message', time: 1, surface: 'current', text: 'hello world' },
      { seq: 1, type: 'user/message', time: 2, surface: 'shadowed', text: 'We chose Postgres because of constraints.' },
      { seq: 2, type: 'assistant/message', time: 3, surface: 'log-only', text: 'Later we reversed the postgres decision.' },
    ],
  }
}

/** A recording fake of `ctx.subagents`. */
interface FakeSubagents extends SubagentsLike {
  /** Requests received, in order. */
  readonly requests: Array<{ name: string; request: RecallStartRequest }>
  /** How many runs were disposed. */
  disposed: number
}

/**
 * Build a fake subagent runtime that answers every start with one canned result.
 * @param result - the child's terminal result.
 * @param options - `hang` never settles the result, for timeout tests.
 * @returns the recording fake.
 */
function fakeSubagents(
  result: RecallChildResult,
  options: { hang?: boolean } = {},
): FakeSubagents {
  const fake: FakeSubagents = {
    requests: [],
    disposed: 0,
    async start(name: string, request: RecallStartRequest) {
      fake.requests.push({ name, request })
      return {
        id: 'child',
        result: options.hang === true ? new Promise<RecallChildResult>(() => undefined) : Promise.resolve(result),
        async dispose() {
          fake.disposed += 1
        },
      }
    },
  }
  return fake
}

/** Session-header facts a real session always carries; tests override per case. */
type FakeHeader = Record<string, unknown>

/** One durable child descriptor event as the delegation runtime writes it. */
function descriptor(label: string): SessionEvent {
  return {
    type: 'subagent/descriptor',
    data: { version: 3, mode: 'one-shot', provider: 'fork', label },
  } as unknown as SessionEvent
}

function execution(
  events: readonly SessionEvent[] = [],
  header: FakeHeader = {},
): ToolRunContext {
  return {
    agent: { session: { id: SessionId('s-self'), header, snapshotEvents: () => events } },
    signal: new AbortController().signal,
  } as unknown as ToolRunContext
}

async function call(
  scope: FakeScope,
  name: string,
  args: unknown,
  events: readonly SessionEvent[] = [],
  header: FakeHeader = {},
): Promise<string> {
  const definition = scope.tools.get(name)
  if (definition === undefined) throw new Error(`missing tool ${name}`)
  return await (definition as ToolDefinition).execute(args, execution(events, header)) as string
}

function installed(subagents: SubagentsLike, config?: Config): FakeScope {
  const handle = fakeAgent('s-self', [checkpointEvent()], fakeSessionQuery(sessionFixture()), subagents)
  const harness = fakeHarness([handle.agent])
  apply(harness.ctx, config ?? {})
  const scope = handle.fiber.scope
  if (scope === undefined) throw new Error('tools were not installed')
  return scope
}

describe('memory_recall registration', () => {
  it('is registered when a subagent runtime is present', () => {
    const scope = installed(fakeSubagents({ structured: { answer: 'x', evidence: [] } }))
    expect([...scope.tools.keys()].sort())
      .toEqual(['memory_ask', 'memory_list', 'memory_read', 'memory_recall', 'memory_search'])
  })

  it('is absent without a subagent runtime', () => {
    const handle = fakeAgent('s-self', [checkpointEvent()], fakeSessionQuery(sessionFixture()))
    const harness = fakeHarness([handle.agent])
    apply(harness.ctx, {})
    expect([...handle.fiber.scope!.tools.keys()].sort())
      .toEqual(['memory_ask', 'memory_list', 'memory_read', 'memory_search'])
  })

  it('is absent when recallEnabled is false', () => {
    const scope = installed(fakeSubagents({ structured: { answer: 'x', evidence: [] } }), { recallEnabled: false })
    expect(scope.tools.has('memory_recall')).toBe(false)
  })

  it('mentions itself in the mounted prompt guidance', () => {
    const scope = installed(fakeSubagents({ structured: { answer: 'x', evidence: [] } }))
    expect(scope.sections[0]?.text).toContain('memory_recall')
  })

  it('registers only the read-only tools for a subagent child', () => {
    const handle = fakeAgent(
      's-child',
      [checkpointEvent()],
      fakeSessionQuery(sessionFixture()),
      fakeSubagents({ structured: { answer: 'x', evidence: [] } }),
      { origin: 'subagent', delegationDepth: 1 },
    )
    apply(fakeHarness([handle.agent]).ctx, {})
    expect([...handle.fiber.scope!.tools.keys()].sort())
      .toEqual([...RECALL_CHILD_TOOLS, 'memory_ask'].sort())
    expect(handle.fiber.scope!.tools.has('memory_recall')).toBe(false)
    // A hand-delegated child keeps its normal catalog: no guard is installed.
    expect(handle.fiber.scope!.guards).toHaveLength(0)
  })

  it('locks a recall child down to the read-only tools at execution', () => {
    const handle = fakeAgent(
      's-recall',
      [checkpointEvent(), descriptor(`${RECALL_CHILD_LABEL_PREFIX}is she angry?`)],
      fakeSessionQuery(sessionFixture()),
      fakeSubagents({ structured: { answer: 'x', evidence: [] } }),
      { origin: 'subagent', delegationDepth: 1 },
    )
    apply(fakeHarness([handle.agent]).ctx, {})
    const guards = handle.fiber.scope!.guards
    expect(guards).toHaveLength(1)
    const guard = guards[0]!
    for (const allowed of RECALL_CHILD_ALLOWED_TOOLS) expect(guard({ name: allowed })).toBeUndefined()
    // `subagent` is registered in the child's own scope, so only the guard can stop it.
    expect(guard({ name: 'subagent' })).toMatch(/may only use/)
    expect(guard({ name: 'bash' })).toMatch(/may only use/)
  })
})

describe('memory_recall child contract', () => {
  it('starts the configured provider with read-only memory tools only', async () => {
    const subagents = fakeSubagents({ structured: { answer: 'yes', evidence: [] } })
    await call(installed(subagents, { recallProvider: 'fork' }), 'memory_recall', { question: 'is she angry?' })
    const started = subagents.requests[0]
    expect(started?.name).toBe('fork')
    expect(started?.request.toolFilter).toEqual({ allow: [] })
    expect(started?.request.outputSchema).toBe(RECALL_OUTPUT_SCHEMA)
    expect(started?.request.maxDepth).toBe(1)
    expect(started?.request.prompt[0]?.text).toContain('is she angry?')
  })

  it('rejects an empty question before starting a child', async () => {
    const subagents = fakeSubagents({ structured: { answer: 'x', evidence: [] } })
    await expect(call(installed(subagents), 'memory_recall', { question: '   ' }))
      .rejects.toThrowError(/at least one non-whitespace/)
    expect(subagents.requests).toHaveLength(0)
  })

  it('refuses a recursive call from a subagent child session', async () => {
    const scope = installed(fakeSubagents({ structured: { answer: 'x', evidence: [] } }))
    const child = [{ type: 'subagent/descriptor' } as unknown as SessionEvent]
    await expect(call(scope, 'memory_recall', { question: 'is she angry?' }, child, { origin: 'subagent', delegationDepth: 1 }))
      .rejects.toThrowError(/unavailable to a subagent/)
  })

  it('refuses a subagent child that declares only a delegation depth', async () => {
    const subagents = fakeSubagents({ structured: { answer: 'x', evidence: [] } })
    await expect(call(installed(subagents), 'memory_recall', { question: 'is she angry?' }, [], { delegationDepth: 2 }))
      .rejects.toThrowError(/unavailable to a subagent/)
    expect(subagents.requests).toHaveLength(0)
  })

  // Regression: `session/end-seed` marks the end of a constructor seed, which a
  // resumed top-level session also carries. It must not read as "this is a child".
  it('allows a resumed top-level session whose log carries a seed boundary', async () => {
    const subagents = fakeSubagents({
      structured: { answer: 'yes', evidence: [] },
      stopReason: 'completed',
    })
    const resumed = [{ type: 'session/end-seed' } as unknown as SessionEvent]
    const text = await call(
      installed(subagents),
      'memory_recall',
      { question: 'is she angry?' },
      resumed,
      { isSeeded: true, inheritedEventCount: 27819 },
    )
    expect(subagents.requests).toHaveLength(1)
    expect(text).toContain('status: empty')
  })
})

describe('memory_recall verification', () => {
  it('returns exact logged text at the seq the child named', async () => {
    const subagents = fakeSubagents({
      structured: {
        answer: 'Yes — the constraint argument settled it.',
        evidence: [{ seq: 1, quote: 'We chose Postgres because of constraints.' }],
        queries: ['postgres', 'constraints'],
      },
      stopReason: 'completed',
    })
    const text = await call(installed(subagents), 'memory_recall', { question: 'why postgres?' })
    expect(text).toContain('status: found')
    expect(text).toContain('child answer (unverified): Yes — the constraint argument settled it.')
    expect(text).toContain('child queries: "postgres", "constraints"')
    expect(text).toContain('[#1] user/message')
    expect(text).toContain('We chose Postgres because of constraints.')
    expect(text).not.toContain('Later we reversed')
  })

  it('drops a pair whose quote is not at the named seq', async () => {
    const subagents = fakeSubagents({
      structured: {
        answer: 'maybe',
        evidence: [{ seq: 2, quote: 'We chose Postgres because of constraints.' }],
      },
      stopReason: 'completed',
    })
    const text = await call(installed(subagents), 'memory_recall', { question: 'why postgres?' })
    expect(text).toContain('status: unverified')
    expect(text).toContain('No verified excerpt')
    expect(text).toContain('every seq/quote pair')
    expect(text).toContain('1 pair(s) dropped')
    expect(text).not.toContain('[#2] assistant/message')
  })

  it('drops a seq that does not exist in this session', async () => {
    const subagents = fakeSubagents({
      structured: { answer: 'x', evidence: [{ seq: 999, quote: 'hello world' }] },
      stopReason: 'completed',
    })
    const text = await call(installed(subagents), 'memory_recall', { question: 'anything' })
    expect(text).toContain('status: unverified')
    expect(text).toContain('1 pair(s) dropped')
  })

  it('keeps the verified pairs when only some are wrong', async () => {
    const subagents = fakeSubagents({
      structured: {
        answer: 'x',
        evidence: [
          { seq: 1, quote: 'We chose Postgres because of constraints.' },
          { seq: 0, quote: 'not in this event' },
        ],
      },
      stopReason: 'completed',
    })
    const text = await call(installed(subagents), 'memory_recall', { question: 'anything' })
    expect(text).toContain('status: found')
    expect(text).toContain('[#1]')
    expect(text).toContain('1 pair(s) dropped')
  })

  it('reports empty when the child finds nothing', async () => {
    const subagents = fakeSubagents({
      structured: { answer: 'no evidence', evidence: [], queries: ['angry'] },
      stopReason: 'completed',
    })
    const text = await call(installed(subagents), 'memory_recall', { question: 'is she angry?' })
    expect(text).toContain('status: empty')
    expect(text).toContain('child answer (unverified): no evidence')
    expect(text).toContain('No verified excerpt')
  })

  it('reports a child failure instead of a false negative', async () => {
    const subagents = fakeSubagents({
      structured: undefined,
      stopReason: 'error',
      diagnostic: 'child crashed',
    })
    const text = await call(installed(subagents), 'memory_recall', { question: 'is she angry?' })
    expect(text).toContain('status: error')
    expect(text).toContain('child crashed')
  })

  it('cancels a child that exceeds its timeout and disposes it', async () => {
    const subagents = fakeSubagents({ structured: undefined }, { hang: true })
    const text = await call(installed(subagents, { recallTimeoutMs: 5 }), 'memory_recall', { question: 'slow?' })
    expect(text).toContain('status: cancelled')
    expect(text).toContain('exceeded its timeout')
    expect(subagents.disposed).toBe(1)
  })

  it('caps accepted evidence at max_seqs', async () => {
    const evidence = [
      { seq: 0, quote: 'hello world' },
      { seq: 1, quote: 'We chose Postgres because of constraints.' },
      { seq: 2, quote: 'Later we reversed the postgres decision.' },
    ]
    const subagents = fakeSubagents({ structured: { answer: 'x', evidence }, stopReason: 'completed' })
    const text = await call(installed(subagents, { recallSeqs: 1, maxRecallSeqs: 2 }), 'memory_recall', { question: 'q', max_seqs: 1 })
    expect(text).toContain('status: found')
    expect(text).toContain('[#0]')
    expect(text).not.toContain('[#1]')
  })
})

describe('recall helpers', () => {
  const agentOf = (header: FakeHeader, events: readonly SessionEvent[] = []): Agent => ({
    session: { id: SessionId('s-self'), header, snapshotEvents: () => events },
  } as unknown as Agent)

  it('detects a subagent child from header facts or its descriptor', () => {
    expect(isSubagentChild(agentOf({ origin: 'subagent' }))).toBe(true)
    expect(isSubagentChild(agentOf({ delegationDepth: 1 }))).toBe(true)
    expect(isSubagentChild(agentOf({}, [descriptor('anything')]))).toBe(true)
    expect(isSubagentChild(agentOf({ isSeeded: true, inheritedEventCount: 27819 }))).toBe(false)
    expect(isSubagentChild(agentOf({}))).toBe(false)
  })

  it('identifies only this plugin\'s own recall children', () => {
    expect(isRecallChild(agentOf({}, [descriptor(`${RECALL_CHILD_LABEL_PREFIX}is she angry?`)]))).toBe(true)
    expect(isRecallChild(agentOf({}, [descriptor('investigate the parser')]))).toBe(false)
    expect(isRecallChild(agentOf({}, []))).toBe(false)
  })

  it('states the output contract in the child prompt', () => {
    const text = buildRecallPrompt('is she angry?', 3)[0]!.text
    expect(text).toContain('is she angry?')
    expect(text).toContain('at most 3 items')
    expect(text).toContain('Never invent a seq')
  })

  it('ignores malformed structured values', () => {
    expect(parseRecallChild(undefined).evidence).toEqual([])
    expect(parseRecallChild({ evidence: [{ seq: -1, quote: 'x' }, { seq: 1, quote: '' }, 'nope' as never] }).evidence)
      .toEqual([])
    expect(parseRecallChild({ evidence: [{ seq: '2', quote: ' ok ' }] }).evidence).toEqual([{ seq: 2, quote: 'ok' }])
  })
})
