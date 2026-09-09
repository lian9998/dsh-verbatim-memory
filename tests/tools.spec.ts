import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.js'
import type { Config } from '../src/index.js'
import type { SessionQueryLike } from '../src/scan.js'
import { fakeHeader, fakeSessionQuery, type FakeSession } from './fake-session-query.js'

interface Registered {
  readonly ctx: Context
  readonly tools: Map<string, ToolDefinition>
  readonly sections: Array<{ name: string; text: string }>
}

function sessions(): FakeSession[] {
  return [
    {
      header: fakeHeader('s-self', '/w'),
      live: true,
      events: [{ seq: 0, type: 'user/message', time: 1, surface: 'current', text: 'hello world' }],
    },
    {
      header: fakeHeader('s-other', '/w', 1_600_000_000_000),
      title: 'Design notes',
      events: [
        { seq: 0, type: 'user/message', time: 1, surface: 'current', text: 'We chose Postgres because of constraints.' },
        { seq: 1, type: 'assistant/message', time: 2, surface: 'shadowed', text: 'Later we reversed the postgres decision.' },
      ],
    },
    {
      header: fakeHeader('s-foreign', '/elsewhere'),
      events: [{ seq: 0, type: 'user/message', time: 1, surface: 'current', text: 'secret postgres note' }],
    },
  ]
}

function register(sessionQuery: SessionQueryLike, config?: Record<string, unknown>): Registered {
  const tools = new Map<string, ToolDefinition>()
  const sections: Array<{ name: string; text: string }> = []
  const ctx = {
    sessionQuery,
    tools: {
      register: (definition: ToolDefinition) => {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    systemPrompt: {
      section: (section: { name: string; text: string }) => {
        sections.push(section)
        return () => undefined
      },
    },
  } as unknown as Context
  apply(ctx, (config ?? {}) as Config)
  return { ctx, tools, sections }
}

function execution(): ToolRunContext {
  const header = fakeHeader('s-self', '/w')
  return { agent: { session: { id: header.id, header } } } as unknown as ToolRunContext
}

async function call(registered: Registered, name: string, args: unknown): Promise<string> {
  const definition = registered.tools.get(name)
  if (definition === undefined) throw new Error(`missing tool ${name}`)
  return await definition.execute(args, execution()) as string
}

describe('verbatim memory plugin', () => {
  it('registers the four tools and its prompt guidance', () => {
    const registered = register(fakeSessionQuery(sessions()))
    expect([...registered.tools.keys()].sort())
      .toEqual(['memory_ask', 'memory_read', 'memory_search', 'memory_sessions'])
    expect(registered.sections).toHaveLength(1)
    expect(registered.sections[0]?.name).toBe('tool:verbatim-memory')
    expect(registered.sections[0]?.text).toContain('never summarize')
  })

  it('honours a custom prompt guidance override', () => {
    const registered = register(fakeSessionQuery(sessions()), { promptGuidance: 'custom guidance' })
    expect(registered.sections[0]?.text).toBe('custom guidance')
  })

  it('lists only workspace-readable sessions', async () => {
    const registered = register(fakeSessionQuery(sessions()))
    const text = await call(registered, 'memory_sessions', {})
    expect(text).toContain('session: s-self')
    expect(text).toContain('session: s-other')
    expect(text).not.toContain('s-foreign')
  })

  it('filters sessions by title substring', async () => {
    const registered = register(fakeSessionQuery(sessions()))
    const text = await call(registered, 'memory_sessions', { query: 'design' })
    expect(text).toContain('session: s-other')
    expect(text).not.toContain('session: s-self')
  })

  it('searches peers verbatim and excludes the caller session', async () => {
    const registered = register(fakeSessionQuery(sessions()))
    const text = await call(registered, 'memory_search', { query: 'postgres' })
    expect(text).toContain('2 exact match(es)')
    expect(text).toContain('We chose Postgres because of constraints.')
    expect(text).toContain('Later we reversed the postgres decision.')
    expect(text).not.toContain('secret postgres note')
    expect(text).toContain('[s-other#0]')
  })

  it('searches the caller session when named explicitly', async () => {
    const registered = register(fakeSessionQuery(sessions()))
    const text = await call(registered, 'memory_search', { query: 'hello', session_id: 's-self' })
    expect(text).toContain('hello world')
  })

  it('denies a foreign session', async () => {
    const registered = register(fakeSessionQuery(sessions()))
    await expect(call(registered, 'memory_search', { query: 'postgres', session_id: 's-foreign' }))
      .rejects.toThrowError(/not readable from this workspace/)
  })

  it('rejects an empty literal query', async () => {
    const registered = register(fakeSessionQuery(sessions()))
    await expect(call(registered, 'memory_search', { query: '   ' }))
      .rejects.toThrowError(/at least one non-whitespace/)
  })

  it('reads one exact event as raw JSON', async () => {
    const registered = register(fakeSessionQuery(sessions()))
    const text = await call(registered, 'memory_read', { session_id: 's-other', seq: 1, before: 1 })
    expect(text).toContain('session s-other')
    expect(text).toContain('#1 assistant/message')
    expect(text).toContain('"text": "Later we reversed the postgres decision."')
  })

  it('rejects a negative seq before reaching the service', async () => {
    const registered = register(fakeSessionQuery(sessions()))
    await expect(call(registered, 'memory_read', { session_id: 's-other', seq: -1 }))
      .rejects.toThrowError(/seq must be a non-negative integer/)
  })

  it('returns a lossless evidence bundle', async () => {
    const registered = register(fakeSessionQuery(sessions()))
    const text = await call(registered, 'memory_ask', { query: 'postgres', budget_tokens: 1000 })
    const bundle = JSON.parse(text) as {
      query: string
      results: Array<{ id: string; exact_text: string }>
      missing: string[]
      token_estimate: number
    }
    expect(bundle.query).toBe('postgres')
    expect(bundle.results.map(item => item.id)).toEqual(['s-other#0', 's-other#1'])
    expect(bundle.results[0]?.exact_text).toBe('We chose Postgres because of constraints.')
    expect(bundle.missing).toEqual([])
    expect(bundle.token_estimate).toBeGreaterThan(0)
  })

  it('reports gaps in the evidence bundle', async () => {
    const registered = register(fakeSessionQuery(sessions()))
    const text = await call(registered, 'memory_ask', { query: 'absent-topic' })
    const bundle = JSON.parse(text) as { results: unknown[]; missing: string[] }
    expect(bundle.results).toEqual([])
    expect(bundle.missing[0]).toContain('no literal match')
  })
})
