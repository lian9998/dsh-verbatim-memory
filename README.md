# dsh-verbatim-memory

Verbatim memory for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): when compaction removes a session's older context, three tools appear that let the model read that context back **exactly as it was logged** — and a lossless compaction backend that never summarizes.

Two Cordis plugins ship in one package:

| Entry | Row name | What it does |
|---|---|---|
| `.` | `dsh-verbatim-memory` | Three read-only model tools over the host `ctx.sessionQuery` service, registered per agent and **hidden until that session has been compacted**. They search only the calling session's own log. |
| `./compaction` | `dsh-verbatim-memory/compaction` | A `ctx.compaction` backend that inherits pressure measurement, retention, and overflow recovery from `@deepseek-ai/dsh-compaction-basic` but replaces the LLM summarization call with a deterministic retrieval stub. |

The design rule is the whole point: **memory content is never generated.** Indexes, counts, timestamps, and handles may be derived; the text a model reads is always the exact bytes that were logged.

## Why

A summarizer is a lossy hop. It can drop a constraint, blur a decision, or invent a fact, and the loss is invisible because the replacement reads like memory. This package keeps the raw session log canonical and gives the model tools that quote it:

- **Verbatim** — every excerpt is source text plus its `seq` and surface classification.
- **Non-generative** — no tool and no compaction path calls `ctx.llm.stream()`.
- **Session-scoped** — a tool call reads exactly one log: the caller's own session. There is no cross-session surface to misconfigure, and no other session is reachable.
- **Visible only after compaction** — the tools exist for recovering elided context, so they are registered only once this session's own surface carries a compaction checkpoint. An uncompacted session never sees them, which keeps the tool catalog lean and the intent unambiguous.
- **Lossless under pressure** — when context pressure forces eviction, the checkpoint records *what was elided and how to retrieve it*, not what it meant.

## Install

```sh
# from a checkout
dsh plugin --profile web add /path/to/dsh-verbatim-memory

# or from a packed tarball
npm pack
dsh plugin --profile web add ./dsh-verbatim-memory-0.2.0.tgz
```

Restart the profile so its Host resolves the new package, then add the rows to an **agent preset**. Never edit the shipped `standard`/`cordis`/`ptc`/`minimal` compositions; copy one and edit the copy:

```sh
# in a DSH session, or with the roster tooling you already use
# copy('standard', 'verbatim')  →  edit the copy's agent.cordis.yml
```

Merge [`preset.example.yml`](preset.example.yml) into the copy. The compaction row must sit **inside** the existing `compaction` isolate realm (it consumes `toolResultPruner`); the tools row sits loose because it publishes no service.

## Visibility

The tools row registers a standing plugin. It does not register tools directly: it waits for each agent and installs the tools **in that agent's own scope** when the agent's session log contains a compaction checkpoint.

| Moment | Behavior |
|---|---|
| Session never compacted | No tools, no prompt section for that agent. |
| Compaction completes | The checkpoint event is appended; the tools and their guidance appear for that session's next model request. |
| Session resumed with an existing checkpoint | Tools are present immediately at agent creation. |
| Agent disposed | The scoped fiber is disposed with it. |

Detection uses `isCompactCheckpointSource` from `@deepseek-ai/dsh-compaction/checkpoint`, so it recognizes the real surface replacement rather than guessing from event names. Set `exposeAfterCompaction: false` to register the tools for every session instead.

Because registration is per agent scope, the tools are not global capabilities: `tools.restrict()` is not needed, another agent's catalog never lists them, and a call can only read the calling session.

## Tools

All three read only the calling session's log, including events whose surface is `shadowed` or `log-only` — the events compaction removed.

### `memory_search`

Search this session's log for a literal phrase and return exact matching text with `seq` provenance.

| Parameter | Type | Meaning |
|---|---|---|
| `query` | string, required | Literal, case-insensitive phrase; a whitespace run matches one or more whitespace characters. |
| `limit` | integer, optional | Maximum matches returned. |

### `memory_read`

Read one exact event by `seq`, with optional neighboring events. Returns raw logged event JSON, unabridged.

| Parameter | Type | Meaning |
|---|---|---|
| `seq` | integer, required | Event sequence number in this session. |
| `before` | integer, optional | Neighboring events before the target. |
| `after` | integer, optional | Neighboring events after the target. |

### `memory_ask`

Return a deterministic, non-generative evidence bundle: exact excerpts with provenance, explicit gaps, and a token estimate.

```json
{
  "query": "why did we choose Postgres",
  "session_id": "session-abc",
  "results": [
    {
      "id": "session-abc#42",
      "session_id": "session-abc",
      "seq": 42,
      "type": "user/message",
      "time": "2026-09-09T15:10:18.132Z",
      "surface": "shadowed",
      "exact_text": "We chose Postgres because ...",
      "matched_phrase": "why did we choose Postgres"
    }
  ],
  "missing": ["1 exact match(es) omitted to respect budget_tokens=1000"],
  "truncated": true,
  "token_estimate": 980,
  "budget_tokens": 1000
}
```

Excerpts are whole or absent — the builder never truncates text to fit the budget. `why_relevant` is deliberately absent: relevance is the caller's judgment, and a generated explanation would be non-memory metadata.

## Verbatim compaction

`dsh-verbatim-memory/compaction` registers `ctx.compaction` with `VerbatimCompactionEngine`, a `BasicCompactionEngine` subclass that overrides the single `summarize()` hook. It keeps every inherited behavior — token-meter pressure, routed retention budgets, tool-pair boundary safety, the durable `compaction/*` bracket, shrink validation, and overflow recovery — and returns a deterministic stub instead of a model call:

```text
VERBATIM RETENTION CHECKPOINT — no summary was generated.

Session: session-abc
Elided from the active surface: 214 message(s) — 96 user, 88 assistant, 30 tool result.
Tools used: bash, edit, read

The elided events are unchanged in the session log, and this session's verbatim memory tools are now available.
Retrieve them exactly:
  memory_search({ query })
  memory_read({ seq, before, after })
  memory_ask({ query })
Continue from the messages that follow; do not restate this checkpoint.
```

Set `includeUserQuotes: true` to embed the **exact** user text of the elided span (whole messages only, capped by `maxQuoteChars`; nothing is truncated to fit). Because the base backend validates that the checkpoint is smaller than the shadowed content, enabling this on a small region can fail the shrink check — that failure is deliberate and loud.

### Config

Tools entry:

| Key | Default | Meaning |
|---|---:|---|
| `defaultSearchResults` | `20` | `memory_search` limit when omitted. |
| `maxSearchResults` | `100` | Largest accepted `limit`, and the `memory_ask` match cap. |
| `defaultReadWindow` | `0` | `memory_read` neighbors when omitted. |
| `maxReadWindow` | `50` | Largest accepted `before`/`after`. |
| `defaultEvidenceBudget` | `6000` | `memory_ask` token budget when omitted. |
| `maxEvidenceBudget` | `60000` | Largest accepted `budget_tokens`. |
| `exposeAfterCompaction` | `true` | Keep the tools hidden until this session has been compacted. |
| `promptGuidance` | *(built-in)* | Model-facing guidance contributed while the tools are visible. |

Compaction entry:

| Key | Default | Meaning |
|---|---:|---|
| `thresholdRatio` | `0.8` | Compact at this fraction of the routed context window. |
| `retainRatio` | `0.16` | Recent surface kept verbatim; mutually exclusive with `retainTokens`. |
| `retainTokens` | — | Absolute recent-context budget. |
| `compactionRetries` | `1` | Extra attempts while pressure remains above threshold. |
| `maxOverflowRetries` | `1` | Retries after canonical context-window overflow. |
| `modelPolicies` | `[]` | Exact `{ provider, model, ... }` policy overrides. |
| `auto` | `true` | Automatic step-boundary pressure and overflow recovery. |
| `includeUserQuotes` | `false` | Embed exact user text of the elided span. |
| `maxQuoteChars` | `2000` | Largest total size of embedded exact user text. |

## Optional: enable indexed search

This package's literal scan needs no index and works on every deployment, including the shipped `openAt: never` default. If you also mount the official `@deepseek-ai/dsh-tool-session-query` rows, enable durable FTS5 in the **host** layer (`$DSH_HOME/profiles/<profile>/cordis.patch.yml`); a patch replaces the row's whole `config`:

```yaml
- id: session-query-sqlite
  config:
    path: !!js dshHomePath('indexes/session-query.sqlite')
    openAt: first-search
```

## Model experience

- **System prompt** — one fixed guidance section (`tool:verbatim-memory`, order 114), present only for sessions whose tools are installed; KV-cache prefix-stable while it is present.
- **Tool catalog** — zero memory schemas before compaction, three after. The catalog change fires `tools/change`, so the next assembly reflects it.
- **Tool results** — plain text; the host's spill policy may replace an oversized result with a preview plus a locator, keeping the full text on disk.
- **Compaction** — the replacement checkpoint is metadata and retrieval instructions only, and it names the tools that just became available. Note that the base backend frames every checkpoint with a fixed "condensing an earlier span" preamble; the stub body states explicitly that no summary was generated.

## Security and privacy

- The corpus is exactly one session: the caller's. No tool accepts a session id, so cross-session reads are not expressible, let alone authorized.
- Nothing is deleted or rewritten. The raw session log stays append-only, and the tools are read-only: there is no write, pin, or forget surface in this version.
- The tools only exist for sessions that compacted, so a fresh session exposes no memory surface at all.

## Known limitations

- **Literal scan, not ranked retrieval** — `memory_search` uses the service's provider-independent literal predicate; it has no relevance ranking, cursors, or tokenizer tuning. Enable FTS5 and the official tool package for ranked cross-session search.
- **No embeddings** — the harness ships no embedding provider, so semantic recall is out of scope here.
- **Whole-log detection on resume** — deciding whether a resumed session compacted reads a snapshot of its log once at agent creation; very large logs pay that cost once.
- **Fixed checkpoint preamble** — owned by `@deepseek-ai/dsh-compaction-basic`; only the checkpoint body is replaced.
- **Shrink validation still applies** — a verbatim checkpoint must be smaller than the region it replaces, exactly like a summary.
- **No curated store yet** — no pins, tags, tombstones, or cross-session memory records; the session log *is* the store.

## Development

```sh
npm install
npm run typecheck   # src + tests
npm test            # unit tests
npm run build       # tsc → lib/ + lib/types/
npm pack            # release tarball
```

Requires Node `^22.19 || >=24`. The package is ESM-only and declares every `@deepseek-ai/*` harness package it consumes as a peer dependency; the deployment provides them. Under a sandbox that makes the default npm cache read-only, point it at a writable directory: `npm_config_cache="$PWD/.npm-cache" npm install`.

## License

MIT
