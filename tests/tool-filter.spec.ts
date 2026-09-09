/**
 * Contract test against the real tool registry.
 *
 * The recall child is scoped with `restrict({ allow: [] })`, and that only works
 * because a restriction filters what a scope INHERITS and never what its own
 * layer registers — which is where this plugin's memory tools and the delegation
 * runtime's `structured_output` live. The fakes used elsewhere cannot observe
 * that rule, so this suite drives the real `ToolRuntime`: if the harness ever
 * changes the exemption, the child would silently lose its memory tools or keep
 * the deployment's.
 *
 * @module dsh-verbatim-memory/tests/tool-filter
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import type { ScopeKey } from '@deepseek-ai/dsh-scope'
import { defineTool, ToolRuntime } from '@deepseek-ai/dsh-tools'
import { RECALL_CHILD_TOOL_FILTER } from '../src/recall.js'

/** One tool with a renderable output, enough for registry visibility tests. */
function probeTool(name: string) {
  return defineTool({
    name,
    description: `${name} probe`,
    parameters: {},
    output: {
      schema: { type: 'string' as const },
      render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
    },
    execute: async () => name,
  })
}

/** One real registry with a global tool and a child scope holding its own tool. */
interface Registry {
  /** The child scope's view of the service: `restrict()` must be called here. */
  readonly childTools: ToolRuntime
  /** The child scope key. */
  readonly childKey: ScopeKey
  /** Visible tool names for one scope key, sorted. */
  names(key?: ScopeKey): string[]
}

/**
 * Build the registry.
 * @returns the child-scoped service, its key, and a name lister.
 */
function registry(): Registry {
  const root = new Context()
  // ToolRuntime names itself `tools` but needs systemPrompt at construction.
  const bare = root as unknown as { provide(name: string, value: unknown): void }
  bare.provide('systemPrompt', { tools: () => undefined, section: () => undefined })
  const tools = new ToolRuntime(root)
  tools.register(probeTool('global_probe'))

  const scope = createScope(root, { name: 'recall-child' })
  const childTools = (scope.ctx as unknown as { tools: ToolRuntime }).tools
  childTools.register(probeTool('own_probe'))

  const childKey = scopeOf(scope.ctx)
  if (childKey === undefined) throw new Error('the child scope was not tagged')
  return {
    childTools,
    childKey,
    names: (key?: ScopeKey) => tools.schemas(key).map(schema => schema.name).sort(),
  }
}

describe('recall child tool filter', () => {
  it('hides every inherited tool and keeps the scope-local ones', () => {
    const { childTools, childKey, names } = registry()
    expect(names(childKey)).toEqual(['global_probe', 'own_probe'])

    childTools.restrict(RECALL_CHILD_TOOL_FILTER)

    expect(names(childKey)).toEqual(['own_probe'])
    // The restriction is scoped: the deployment's own view is untouched.
    expect(names()).toEqual(['global_probe'])
  })

  it('rejects naming a scope-local tool, which is why the filter is empty', () => {
    const { childTools } = registry()
    expect(() => childTools.restrict({ allow: ['own_probe'] }))
      .toThrowError(/names unknown global tool/)
  })
})
