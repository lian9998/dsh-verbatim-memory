import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock, Message, MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  apply,
  buildVerbatimStub,
  Config,
  DEFAULT_MAX_QUOTE_CHARS,
  summarizeRegion,
  VerbatimCompactionEngine,
} from '../src/compaction.js'
import type { VerbatimSummary } from '../src/compaction.js'

const SESSION = 'session-abc'

function message(role: 'user' | 'assistant', content: ContentBlock[]): Message {
  return {
    id: `m-${role}-${content.length}` as MessageId,
    role,
    content,
    source: { kind: 'plugin', plugin: 'test' },
  }
}

function region(): Message[] {
  return [
    message('user', [{ type: 'text', text: 'We chose Postgres because of constraints.' }]),
    message('assistant', [
      { type: 'text', text: 'Acknowledged.' },
      { type: 'tool-call', id: 'c1' as never, name: 'bash', arguments: '{}' },
    ]),
    message('user', [{
      type: 'tool-result',
      toolCallId: 'c1' as never,
      content: [{ type: 'text', text: 'ok' }],
    }]),
  ]
}

describe('summarizeRegion', () => {
  it('counts message kinds, tool names, and exact user text', () => {
    const region_ = summarizeRegion(region())
    expect(region_).toMatchObject({
      userMessages: 1,
      assistantMessages: 1,
      toolResults: 1,
      toolNames: ['bash'],
    })
    expect(region_.userTexts).toEqual(['We chose Postgres because of constraints.'])
  })
})

describe('buildVerbatimStub', () => {
  it('states that no summary was generated and points at exact retrieval', () => {
    const stub = buildVerbatimStub({ messages: region() }, SESSION, {
      includeUserQuotes: false,
      maxQuoteChars: DEFAULT_MAX_QUOTE_CHARS,
    })
    expect(stub).toContain('VERBATIM RETENTION CHECKPOINT — no summary was generated.')
    expect(stub).toContain(`Session: ${SESSION}`)
    expect(stub).toContain('3 message(s) — 1 user, 1 assistant, 1 tool result.')
    expect(stub).toContain('Tools used: bash')
    expect(stub).toContain('memory_list({ type })')
    expect(stub).toContain('memory_search({ query })')
    expect(stub).toContain('memory_read({ seq, before, after })')
    expect(stub).toContain('verbatim memory tools are now available')
    expect(stub).not.toContain('We chose Postgres')
  })

  it('omits the tool line when no tool was used', () => {
    const stub = buildVerbatimStub(
      { messages: [message('user', [{ type: 'text', text: 'hi' }])] },
      SESSION,
      { includeUserQuotes: false, maxQuoteChars: DEFAULT_MAX_QUOTE_CHARS },
    )
    expect(stub).not.toContain('Tools used:')
  })

  it('embeds exact user text only when configured and within budget', () => {
    const quoted = buildVerbatimStub({ messages: region() }, SESSION, {
      includeUserQuotes: true,
      maxQuoteChars: DEFAULT_MAX_QUOTE_CHARS,
    })
    expect(quoted).toContain('Exact user text from the elided span:')
    expect(quoted).toContain('We chose Postgres because of constraints.')

    const tooSmall = buildVerbatimStub({ messages: region() }, SESSION, {
      includeUserQuotes: true,
      maxQuoteChars: 5,
    })
    expect(tooSmall).not.toContain('Exact user text from the elided span:')
    expect(tooSmall).not.toContain('We chose Postgres')
  })
})

describe('VerbatimCompactionEngine', () => {
  it('produces a deterministic stub without any llm stream call', async () => {
    const engine = Object.create(VerbatimCompactionEngine.prototype) as unknown as {
      verbatim: { includeUserQuotes: boolean; maxQuoteChars: number }
      summarize: (
        input: { messages: readonly Message[] },
        owner: Agent,
        signal?: AbortSignal,
      ) => Promise<VerbatimSummary>
    }
    engine.verbatim = { includeUserQuotes: false, maxQuoteChars: DEFAULT_MAX_QUOTE_CHARS }
    const agent = { session: { id: SessionId(SESSION) } } as unknown as Agent
    const result = await engine.summarize({ messages: region() }, agent)
    expect(result.provider).toBe('verbatim')
    expect(result.model).toBe('deterministic')
    expect(result.llmStreamCall).toBeUndefined()
    expect(result.summary[0]).toMatchObject({ type: 'text' })
    expect((result.summary[0] as { text: string }).text).toContain('no summary was generated')
  })

  it('registers its engine class through the plugin apply', () => {
    const registered: Array<{ plugin: unknown; config: unknown }> = []
    const ctx = {
      plugin: (plugin: unknown, config: unknown) => {
        registered.push({ plugin, config })
      },
    } as unknown as Context
    apply(ctx, { includeUserQuotes: true, maxQuoteChars: 100 })
    expect(registered).toHaveLength(1)
    expect(registered[0]?.plugin).toBe(VerbatimCompactionEngine)
    expect(registered[0]?.config).toMatchObject({ includeUserQuotes: true, maxQuoteChars: 100 })
  })

  it('exposes a loader schema without summarization fields', () => {
    const keys = Object.keys(Config.dict ?? {})
    expect(keys).toContain('thresholdRatio')
    expect(keys).not.toContain('summarizationProvider')
    expect(keys).toContain('includeUserQuotes')
  })

  it('shadows the base loader schema so verbatim options are accepted', () => {
    const keys = Object.keys(VerbatimCompactionEngine.Config.dict ?? {})
    expect(keys).toContain('includeUserQuotes')
    expect(keys).toContain('maxQuoteChars')
    expect(VerbatimCompactionEngine.Config).toBe(Config)
  })
})
