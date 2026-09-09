# dsh-verbatim-memory

Verbatim memory for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): exact session-history recall for the model, and a lossless compaction backend that never summarizes.

Two Cordis plugins ship in one package:

| Entry | Row name | What it does |
|---|---|---|
| `.` | `dsh-verbatim-memory` | Four read-only model tools over the host `ctx.sessionQuery` service: list sessions, literal-search events, read raw events, and build a lossless evidence bundle. |
| `./compaction` | `dsh-verbatim-memory/compaction` | A `ctx.compaction` backend that inherits pressure measurement, retention, and overflow recovery from `@deepseek-ai/dsh-compaction-basic` but replaces the LLM summarization call with a deterministic retrieval stub. |

The design rule is the whole point: **memory content is never generated.** Indexes, counts, timestamps, and handles may be derived; the text a model reads is always the exact bytes that were logged.

## Why

A summarizer is a lossy hop. It can drop a constraint, blur a decision, or invent a fact, and the loss is invisible because the replacement reads like memory. This package keeps the raw session log canonical and gives the model tools that quote it:

- **Verbatim** — every excerpt is source text plus `sessionId` and `seq` provenance.
- **Non-generative** — no tool and no compaction path calls `ctx.llm.stream()`.
- **Authorized** — a call may read only sessions whose `cwd` exactly equals the caller's; a caller without `cwd` reads only itself.
- **Lossless under pressure** — when context pressure forces eviction, the checkpoint records *what was elided and how to retrieve it*, not what it meant.

## Install

```sh
# from a checkout
dsh plugin --profile web add /path/to/dsh-verbatim-memory

# or from a packed tarball
npm pack
dsh plugin --profile web add ./dsh-verbatim-memory-0.1.0.tgz
```

Restart the profile so its Host resolves the new package, then add the rows to an **agent preset**. Never edit the shipped `standard`/`cordis`/`ptc`/`minimal` compositions; copy one and edit the copy:

```sh
# in a DSH session, or with the roster tooling you already use
# copy('standard', 'verbatim')  →  edit the copy's agent.cordis.yml
```

Merge [`preset.example.yml`](preset.example.yml) into the copy. The compaction row must sit **inside** the existing `compaction` isolate realm (it consumes `toolResultPruner`); the tools row sits loose because it publishes no service.

## Tools

### `memory_sessions`

List sessions readable from this workspace with their latest title, `cwd`, creation time, and live/persisted state.

| Parameter | Type | Meaning |
|---|---|---|
| `query` | string, optional | Case-insensitive substring matched against titles. |
| `limit` | integer, optional | Maximum sessions returned. |

### `memory_search`

Search prior session events for a literal phrase and return exact matching text with provenance. Never summarizes. A cross-session scan **excludes the calling session** so a search cannot cite its own transcript.

| Parameter | Type | Meaning |
|---|---|---|
| `query` | string, required | Literal, case-insensitive phrase; a whitespace run matches one or more whitespace characters. |
| `session_id` | string, optional | Restrict the scan to one authorized session. |
| `limit` | integer, optional | Maximum matches returned. |
| `max_sessions` | integer, optional | Maximum sessions scanned in a cross-session search. |

### `memory_read`

Read one exact event by `session_id` and `seq`, with optional neighboring events. Returns raw logged event JSON, unabridged.

### `memory_ask`

Return a deterministic, non-generative evidence bundle: exact excerpts with provenance, explicit gaps, a per-session failure list, and a token estimate.

```json
{
  "query": "why did we choose Postgres",
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
  "scanned_sessions": 3,
  "skipped": [],
  "truncated": true,
  "token_estimate": 980,
  "budget_tokens": 1000
}
```

Excerpts are whole or absent — the builder never truncates text to fit the budget. `why_relevant` is deliberately absent: relevance is the caller's judgment, and a generated explanation would be non-memory metadata. A curator subagent can forward this bundle without adding a lossy hop.

## Verbatim compaction

`dsh-verbatim-memory/compaction` registers `ctx.compaction` with `VerbatimCompactionEngine`, a `BasicCompactionEngine` subclass that overrides the single `summarize()` hook. It keeps every inherited behavior — token-meter pressure, routed retention budgets, tool-pair boundary safety, the durable `compaction/*` bracket, shrink validation, and overflow recovery — and returns a deterministic stub instead of a model call:

```text
VERBATIM RETENTION CHECKPOINT — no summary was generated.

Session: session-abc
Elided from the active surface: 214 message(s) — 96 user, 88 assistant, 30 tool result.
Tools used: bash, edit, read

The elided events are unchanged in the session log. Retrieve them exactly:
  memory_search({ query })
  memory_read({ session_id, seq, before, after })
  memory_ask({ query })
Continue from the messages that follow; do not restate this checkpoint.
```

Set `includeUserQuotes: true` to embed the **exact** user text of the elided span (whole messages only, capped by `maxQuoteChars`; nothing is truncated to fit). Because the base backend validates that the checkpoint is smaller than the shadowed content, enabling this on a small region can fail the shrink check — that failure is deliberate and loud.

### Config

Tools entry:

| Key | Default | Meaning |
|---|---:|---|
| `defaultSessionLimit` | `40` | `memory_sessions` limit when omitted. |
| `maxSessionLimit` | `200` | Largest accepted `limit`. |
| `defaultSearchResults` | `20` | `memory_search` limit when omitted. |
| `maxSearchResults` | `100` | Largest accepted `limit`, and the `memory_ask` match cap. |
| `maxSessionsScanned` | `60` | Sessions scanned per cross-session search. |
| `defaultReadWindow` | `0` | `memory_read` neighbors when omitted. |
| `maxReadWindow` | `50` | Largest accepted `before`/`after`. |
| `defaultEvidenceBudget` | `6000` | `memory_ask` token budget when omitted. |
| `maxEvidenceBudget` | `60000` | Largest accepted `budget_tokens`. |
| `promptGuidance` | *(built-in)* | Model-facing guidance contributed while mounted. |

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

- **System prompt** — one fixed guidance section (`tool:verbatim-memory`, order 114) while mounted; KV-cache prefix-stable.
- **Tool schemas** — four fixed read-only schemas; `memory_sessions` and `memory_read` declare themselves concurrency-safe, the two scan tools do not.
- **Tool results** — plain text; the host's spill policy may replace an oversized result with a preview plus a locator, keeping the full text on disk.
- **Compaction** — the replacement checkpoint is metadata and retrieval instructions only. Note that the base backend frames every checkpoint with a fixed "condensing an earlier span" preamble; the stub body states explicitly that no summary was generated.

## Security and privacy

- Authorization is exact `cwd` equality, matching the harness's own session-query tools. Missing and cross-workspace targets produce the same error, so a tool cannot probe for session existence.
- Nothing is deleted or rewritten. The raw session log stays append-only, and the tools are read-only: there is no write, pin, or forget surface in this version.
- Because the corpus is the session log, anything the log contains is potentially retrievable within its workspace. Treat workspace separation as the privacy boundary it already is.

## Known limitations

- **Literal scan, not ranked retrieval** — `memory_search` uses the service's provider-independent literal predicate; it has no relevance ranking or cursors, and scans at most `maxSessionsScanned` sessions per call. Enable FTS5 and the official tool package for ranked search.
- **No embeddings** — the harness ships no embedding provider, so semantic recall is out of scope here.
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
