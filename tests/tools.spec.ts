import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.js'
import type { Config } from '../src/index.js'
import { fakeAgent, fakeHarness, type FakeHarness, type FakeScope } from './fake-harness.js'
import { fakeHeader, fakeSessionQuery, type FakeSession } from './fake-session-query.js'
import { checkpointEvent, userEvent } from './events.js'

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

function execution(): ToolRunContext {
  return { agent: { session: { id: SessionId('s-self') } } } as unknown as ToolRunContext
}

async function call(scope: FakeScope, name: string, args: unknown): Promise<string> {
  const definition = scope.tools.get(name)
  if (definition === undefined) throw new Error(`missing tool ${name}`)
  return await (definition as ToolDefinition).execute(args, execution()) as string
}

function sessionRef(id = 's-self'): { id: ReturnType<typeof SessionId> } {
  return { id: SessionId(id) }
}

describe('visibility gating', () => {
  it('hides the tools for a session that never compacted', () => {
    const handle = fakeAgent('s-self', [], fakeSessionQuery(sessionFixture()))
    const harness = fakeHarness([handle.agent])
    apply(harness.ctx, {})
    expect(handle.fiber.scope).toBeUndefined()
  })

  it('exposes the tools once a compaction checkpoint lands', () => {
    const log: SessionEvent[] = []
    const handle = fakeAgent('s-self', log, fakeSessionQuery(sessionFixture()))
    const harness = fakeHarness([handle.agent])
    apply(harness.ctx, {})
    expect(handle.fiber.scope).toBeUndefined()
    log.push(checkpointEvent())
    harness.emit('session/event', sessionRef(), checkpointEvent())
    const scope = handle.fiber.scope
    expect(scope).toBeDefined()
    expect([...scope!.tools.keys()].sort())
      .toEqual(['memory_ask', 'memory_list', 'memory_read', 'memory_search'])
    expect(scope!.sections).toHaveLength(1)
    expect(scope!.sections[0]?.name).toBe('tool:verbatim-memory')
    expect(scope!.sections[0]?.text).toContain('only this session')
    expect(scope!.sections[0]?.text).toContain('memory_list')
    expect(scope!.sections[0]?.text).toContain('subagent_fork')
  })

  it('exposes the tools immediately for a resumed compacted session', () => {
    const handle = fakeAgent('s-self', [checkpointEvent()], fakeSessionQuery(sessionFixture()))
    const harness = fakeHarness([handle.agent])
    apply(harness.ctx, {})
    expect(handle.fiber.scope).toBeDefined()
  })

  it('installs for an agent created after the plugin mounted', () => {
    const agents: never[] = []
    const harness = fakeHarness(agents)
    apply(harness.ctx, {})
    const handle = fakeAgent('s-self', [checkpointEvent()], fakeSessionQuery(sessionFixture()))
    agents.push(handle.agent as never)
    harness.emit('agent/created', { agent: handle.agent })
    expect(handle.fiber.scope).toBeDefined()
  })

  it('ignores non-checkpoint session events', () => {
    const handle = fakeAgent('s-self', [], fakeSessionQuery(sessionFixture()))
    const harness = fakeHarness([handle.agent])
    apply(harness.ctx, {})
    harness.emit('session/event', sessionRef(), userEvent('hi'))
    expect(handle.fiber.scope).toBeUndefined()
  })

  it('ignores a checkpoint for a session with no live agent', () => {
    const harness = fakeHarness([])
    apply(harness.ctx, {})
    expect(() => harness.emit('session/event', sessionRef('s-gone'), checkpointEvent())).not.toThrow()
  })

  it('installs at mount when exposeAfterCompaction is disabled', () => {
    const handle = fakeAgent('s-self', [], fakeSessionQuery(sessionFixture()))
    const harness = fakeHarness([handle.agent])
    apply(harness.ctx, { exposeAfterCompaction: false })
    expect(handle.fiber.scope).toBeDefined()
  })

  it('disposes the scoped fiber when the agent is disposed', () => {
    const handle = fakeAgent('s-self', [checkpointEvent()], fakeSessionQuery(sessionFixture()))
    const harness = fakeHarness([handle.agent])
    apply(harness.ctx, {})
    harness.emit('agent/disposed', { agent: handle.agent })
    expect(handle.fiber.disposed).toBe(true)
  })

  it('disposes every scoped fiber when the plugin unloads', async () => {
    const handle = fakeAgent('s-self', [checkpointEvent()], fakeSessionQuery(sessionFixture()))
    const harness = fakeHarness([handle.agent])
    apply(harness.ctx, {})
    expect(harness.effects).toHaveLength(1)
    await harness.effects[0]!()
    expect(handle.fiber.disposed).toBe(true)
  })
})

describe('memory tools in a compacted session', () => {
  function installed(config?: Config): FakeScope {
    const handle = fakeAgent('s-self', [checkpointEvent()], fakeSessionQuery(sessionFixture()))
    const harness: FakeHarness = fakeHarness([handle.agent])
    apply(harness.ctx, config ?? {})
    const scope = handle.fiber.scope
    if (scope === undefined) throw new Error('tools were not installed')
    return scope
  }

  it('registers exactly the four single-session tools', () => {
    expect([...installed().tools.keys()].sort())
      .toEqual(['memory_ask', 'memory_list', 'memory_read', 'memory_search'])
  })

  it('enumerates every user message without a query', async () => {
    const text = await call(installed(), 'memory_list', { type: ['user/message'] })
    expect(text).toContain('2 event(s) matched type=user/message')
    expect(text).toContain('hello world')
    expect(text).toContain('We chose Postgres because of constraints.')
    expect(text).toContain('[#1]')
    expect(text).not.toContain('Later we reversed')
  })

  it('enumerates without any predicate and reports the total', async () => {
    const text = await call(installed(), 'memory_list', {})
    expect(text).toContain('3 event(s) matched all events')
  })

  it('returns rows newest first when ordered descending', async () => {
    const text = await call(installed(), 'memory_list', { type: ['user/message'], order: 'desc' })
    expect(text.indexOf('[#1]')).toBeLessThan(text.indexOf('[#0]'))
  })

  it('pages a truncated result set with offset', async () => {
    const text = await call(installed(), 'memory_list', { limit: 1, offset: 1 })
    expect(text).toContain('3 event(s) matched all events')
    expect(text).toContain('showing rows 1-1 of 3')
    expect(text).toContain('continue with offset 2')
    expect(text).toContain('[#1]')
  })

  it('rejects an unknown surface filter at the schema boundary', async () => {
    await expect(call(installed(), 'memory_list', { surface: ['ghost'] }))
      .rejects.toThrowError(/surface\[0\].*must be one of/)
  })

  it('searches this session verbatim', async () => {
    const text = await call(installed(), 'memory_search', { query: 'postgres' })
    expect(text).toContain('2 exact match(es)')
    expect(text).toContain('We chose Postgres because of constraints.')
    expect(text).toContain('Later we reversed the postgres decision.')
    expect(text).toContain('[#1]')
  })

  it('narrows a search with metadata filters', async () => {
    const text = await call(installed(), 'memory_search', { query: 'postgres', surface: ['shadowed'] })
    expect(text).toContain('1 exact match(es)')
    expect(text).toContain('We chose Postgres because of constraints.')
    expect(text).not.toContain('Later we reversed')
  })

  it('bounds rendered output with max_chars', async () => {
    const text = await call(installed(), 'memory_list', { max_chars: 200 })
    expect(text).toContain('row(s) omitted to respect the 200-character output budget')
  })

  it('rejects an empty literal query', async () => {
    await expect(call(installed(), 'memory_search', { query: '   ' }))
      .rejects.toThrowError(/at least one non-whitespace/)
  })

  it('reads one exact event as raw JSON', async () => {
    const text = await call(installed(), 'memory_read', { seq: 2, before: 1 })
    expect(text).toContain('session s-self')
    expect(text).toContain('#2 assistant/message')
    expect(text).toContain('"text": "Later we reversed the postgres decision."')
  })

  it('rejects a negative seq before reaching the service', async () => {
    await expect(call(installed(), 'memory_read', { seq: -1 }))
      .rejects.toThrowError(/seq must be a non-negative integer/)
  })

  it('returns a lossless evidence bundle bound to this session', async () => {
    const text = await call(installed(), 'memory_ask', { query: 'postgres', budget_tokens: 1000 })
    const bundle = JSON.parse(text) as {
      query: string
      session_id: string
      results: Array<{ id: string; exact_text: string }>
      missing: string[]
      token_estimate: number
    }
    expect(bundle.query).toBe('postgres')
    expect(bundle.session_id).toBe('s-self')
    expect(bundle.results.map(item => item.id)).toEqual(['s-self#1', 's-self#2'])
    expect(bundle.results[0]?.exact_text).toBe('We chose Postgres because of constraints.')
    expect(bundle.missing).toEqual([])
    expect(bundle.token_estimate).toBeGreaterThan(0)
  })

  it('reports gaps in the evidence bundle', async () => {
    const text = await call(installed(), 'memory_ask', { query: 'absent-topic' })
    const bundle = JSON.parse(text) as { results: unknown[]; missing: string[] }
    expect(bundle.results).toEqual([])
    expect(bundle.missing[0]).toContain('no literal match')
  })

  it('refuses a call that is not agent-bound', async () => {
    const scope = installed()
    const definition = scope.tools.get('memory_search')
    if (definition === undefined) throw new Error('missing tool')
    await expect(definition.execute({ query: 'x' }, {} as ToolRunContext))
      .rejects.toThrowError(/agent-bound caller/)
  })
})
