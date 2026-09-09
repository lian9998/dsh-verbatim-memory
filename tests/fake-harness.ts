/**
 * Minimal fake plugin context, agent, and scoped fiber for gating tests.
 *
 * @module dsh-verbatim-memory/tests/fake-harness
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { SubagentsLike } from '../src/recall.js'
import type { SessionQueryLike } from '../src/scan.js'

/** The scoped contributions one fake fiber observes. */
export interface FakeScope {
  /** Tools registered in this scope. */
  readonly tools: Map<string, ToolDefinition>
  /** Prompt sections registered in this scope. */
  readonly sections: Array<{ name: string; order: number; text: string }>
  /** The session-query service this scope resolves. */
  readonly sessionQuery: SessionQueryLike
  /** The optional subagent runtime this scope resolves. */
  readonly subagents?: SubagentsLike
}

/** One fake agent-scoped fiber. */
export interface FakeFiber {
  /** Whether the fiber was disposed. */
  disposed: boolean
  /** The scope the inject callback received, once it ran. */
  scope: FakeScope | undefined
  /** Dispose the fiber. */
  dispose(): Promise<void>
}

/** One fake agent plus its fiber record. */
export interface FakeAgentHandle {
  /** The agent value handed to plugin listeners. */
  agent: Agent
  /** The fiber created by `agent.ctx.inject`. */
  fiber: FakeFiber
}

/** A fake standing context plus its captured wiring. */
export interface FakeHarness {
  /** Context handed to the plugin's `apply`. */
  ctx: Context
  /** Fire one captured event listener. */
  emit(name: string, ...args: unknown[]): void
  /** Registered event listeners by name. */
  listeners: Map<string, Array<(...args: unknown[]) => void>>
  /** Effect disposers captured from `ctx.effect`. */
  effects: Array<() => unknown>
}

/**
 * Build a fake agent whose scoped `inject` records the contributions.
 * @param id - session id.
 * @param events - the session's raw log.
 * @param sessionQuery - service resolved inside the scope.
 * @param subagents - optional subagent runtime resolved inside the scope.
 * @returns the agent and its fiber record.
 */
export function fakeAgent(
  id: string,
  events: readonly SessionEvent[],
  sessionQuery: SessionQueryLike,
  subagents?: SubagentsLike,
): FakeAgentHandle {
  const fiber: FakeFiber = {
    disposed: false,
    scope: undefined,
    async dispose() {
      fiber.disposed = true
    },
  }
  const scopeOf = (): FakeScope => ({
    tools: new Map<string, ToolDefinition>(),
    sections: [],
    sessionQuery,
    ...subagents === undefined ? {} : { subagents },
  })
  const agent = {
    session: { id: id as SessionId, snapshotEvents: () => events },
    ctx: {
      inject: (_deps: readonly string[], callback: (scope: Context) => void) => {
        const scope = scopeOf()
        fiber.scope = scope
        const scoped = {
          get: (name: string) => name === 'subagents' ? subagents : undefined,
          tools: {
            register: (definition: ToolDefinition) => {
              scope.tools.set(definition.name, definition)
              return () => undefined
            },
          },
          systemPrompt: {
            section: (section: { name: string; order: number; text: string }) => {
              scope.sections.push(section)
              return () => undefined
            },
          },
          sessionQuery,
        } as unknown as Context
        callback(scoped)
        return fiber
      },
    },
  } as unknown as Agent
  return { agent, fiber }
}

/**
 * Build a fake standing context over a set of live agents.
 * @param agents - agents the fake registry reports.
 * @returns the harness.
 */
export function fakeHarness(agents: readonly Agent[]): FakeHarness {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const effects: Array<() => unknown> = []
  const ctx = {
    agents: {
      list: () => [...agents],
      get: (id: SessionId) => agents.find(candidate => candidate.session.id === id),
    },
    on: (name: string, listener: (...args: unknown[]) => void) => {
      const bucket = listeners.get(name) ?? []
      bucket.push(listener)
      listeners.set(name, bucket)
      return () => undefined
    },
    effect: (execute: () => () => unknown) => {
      effects.push(execute())
      return () => undefined
    },
  } as unknown as Context
  return {
    ctx,
    listeners,
    effects,
    emit(name, ...args) {
      for (const listener of listeners.get(name) ?? []) listener(...args)
    },
  }
}
