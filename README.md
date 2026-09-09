# dsh-verbatim-memory

Verbatim memory for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): when compaction removes a session's older context, four tools appear that let the model read that context back **exactly as it was logged** — and a lossless compaction backend that never summarizes.

Two Cordis plugins ship in one package:

| Entry | Row name | What it does |
|---|---|---|
| `.` | `dsh-verbatim-memory` | Four read-only model tools over the host `ctx.sessionQuery` service, registered per agent and **hidden until that session has been compacted**. They read only the calling session's own log. |
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
dsh plugin --profile web add ./dsh-verbatim-memory-0.3.0.tgz
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

Every tool reads only the calling session's log, including events whose surface is `shadowed` or `log-only` — the events compaction removed. `memory_recall` reaches that log through a child agent, but the excerpts it returns are re-read from the calling session before they reach the caller.

`memory_list` and `memory_search` share one metadata filter set. A filter array is AND-ed with the phrase; `type`/`surface` values are OR-ed within their clause, and `seq`/`time` bounds are inclusive:

| Parameter | Type | Meaning |
|---|---|---|
| `type` | string array, optional | Event types to include, e.g. `["user/message","tool/result"]`. Omit for every type. |
| `surface` | string array, optional | `current` (in context), `shadowed` (replaced by compaction), or `log-only`. |
| `seq_from` / `seq_to` | integer, optional | Inclusive event-seq bounds. |
| `time_from` / `time_to` | integer, optional | Inclusive event-time bounds in Unix epoch milliseconds. |
| `order` | `asc` \| `desc`, optional | Result order by seq. Defaults to `asc`; `desc` returns the newest matches first. |
| `offset` | integer, optional | Rows to skip, for paging a result set the header reported as truncated. |
| `max_chars` | integer, optional | Largest total rendered size before rows are truncated or omitted. Defaults to `defaultOutputChars`. |

### `memory_list`

Enumerate this session's log by metadata alone — no text query. This is the tool for a **set question** ("every message I sent", "all tool results before the compaction"), which a literal search cannot answer in one call.

| Parameter | Type | Meaning |
|---|---|---|
| *(filters above)* | | Select the rows. No predicate means every logged event. |
| `limit` | integer, optional | Maximum rows returned. Defaults to `defaultListResults`. |

Each row carries `[#seq] type @ time surface=…` plus the exact logged text. The header reports the total match count and, when the set is truncated, how to continue:

```text
2 event(s) matched type=user/message · result set truncated: showing rows 0-1 of 5 · continue with offset 2

[#9] user/message @ 2026-09-09T15:55:32.789Z surface=current
hi

[#43] user/message @ 2026-09-09T15:55:57.130Z surface=shadowed
just greeting.
```

### `memory_search`

Search this session's log for a literal phrase and return exact matching text with `seq` provenance.

| Parameter | Type | Meaning |
|---|---|---|
| *(filters above)* | | Narrow the search when the phrase alone is too broad. |
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

### `memory_recall`

Answer a question whose wording you cannot guess — *"is she angry?"*, *"what did we decide about the sign convention?"* — by starting a child agent that inherits this session's log, searching it, and reporting back. Registered only when a subagent runtime is reachable.

| Parameter | Type | Meaning |
|---|---|---|
| `question` | string, required | The associative question to answer from this session's log. |
| `max_seqs` | integer, optional | Maximum evidence pairs accepted from the child. Defaults to `recallSeqs`. |
| `max_chars` | integer, optional | Largest total rendered size. Defaults to `defaultOutputChars`. |

The child is started through `recallProvider` (default `fork`) with `maxDepth: 1` and a tool filter that leaves it **only** `memory_list`, `memory_search`, and `memory_read` — no file or shell tools, and no `memory_recall`, so a child cannot recurse. It is asked for one line plus `{seq, quote}` pairs.

The caller then re-reads every pair from its own log: a pair is kept only when the quoted text really occurs at the seq it named, and a kept pair is rendered as the **exact logged text**, not the child's copy of it. The child's one line is rendered separately, labeled `child answer (unverified)`, and must not be quoted as fact.

```text
recall: is she angry?
status: found
child answer (unverified): Yes — she stopped answering after the argument at #1204.
child queries: "angry", "upset", "didn't answer"

Verified excerpts (exact logged text, re-read from this session at the child's seqs):

[#1206] user/message @ 2026-09-09T18:04:11.002Z surface=shadowed
I'm not going to pretend that was fine.
```

`status` is one of `found`, `empty` (child found nothing — it reports the phrases it tried), `unverified` (every pair failed to match this session's log), `cancelled` (the child exceeded `recallTimeoutMs`), or `error` (the child ended with a non-`completed` stop reason, reported with its diagnostic rather than as a false negative).

Because a fork seed classifies inherited events `shadowed`, the child receives this log as *data*, not as prompt context: it must query, and the plugin never pays to replay an archive into a prompt. The cost of one recall is the child's own search loop — a few model round trips — not the size of the archive.

## Verbatim compaction

`dsh-verbatim-memory/compaction` registers `ctx.compaction` with `VerbatimCompactionEngine`, a `BasicCompactionEngine` subclass that overrides the single `summarize()` hook. It keeps every inherited behavior — token-meter pressure, routed retention budgets, tool-pair boundary safety, the durable `compaction/*` bracket, shrink validation, and overflow recovery — and returns a deterministic stub instead of a model call:

```text
VERBATIM RETENTION CHECKPOINT — no summary was generated.

Session: session-abc
Elided from the active surface: 214 message(s) — 96 user, 88 assistant, 30 tool result.
Tools used: bash, edit, read

The elided events are unchanged in the session log, and this session's verbatim memory tools are now available.
Retrieve them exactly:
  memory_list({ type })   enumerate logged events by type, surface, or seq range
  memory_search({ query })   find a literal phrase
  memory_read({ seq, before, after })   read one event in full
  memory_ask({ query })   budgeted evidence bundle
Continue from the messages that follow; do not restate this checkpoint.
```

Set `includeUserQuotes: true` to embed the **exact** user text of the elided span (whole messages only, capped by `maxQuoteChars`; nothing is truncated to fit). Because the base backend validates that the checkpoint is smaller than the shadowed content, enabling this on a small region can fail the shrink check — that failure is deliberate and loud.

### Config

Tools entry:

| Key | Default | Meaning |
|---|---:|---|
| `defaultSearchResults` | `20` | `memory_search` limit when omitted. |
| `maxSearchResults` | `100` | Largest accepted `limit`, and the `memory_ask` match cap. |
| `defaultListResults` | `50` | `memory_list` limit when omitted. |
| `maxListResults` | `500` | Largest accepted `memory_list` limit. |
| `defaultRowChars` | `280` | Largest exact text block kept per rendered row before a truncation marker. |
| `maxRowChars` | `4000` | Largest accepted per-row text size. |
| `defaultOutputChars` | `8000` | Total rendered size of one result set when `max_chars` is omitted. |
| `maxOutputChars` | `60000` | Largest accepted `max_chars`. |
| `defaultReadWindow` | `0` | `memory_read` neighbors when omitted. |
| `maxReadWindow` | `50` | Largest accepted `before`/`after`. |
| `defaultEvidenceBudget` | `6000` | `memory_ask` token budget when omitted. |
| `maxEvidenceBudget` | `60000` | Largest accepted `budget_tokens`. |
| `exposeAfterCompaction` | `true` | Keep the tools hidden until this session has been compacted. |
| `recallEnabled` | `true` | Register `memory_recall` when a subagent runtime is reachable. |
| `recallProvider` | `fork` | Subagent provider `memory_recall` starts its child through. |
| `recallSeqs` | `8` | Evidence pairs accepted from one recall child. |
| `maxRecallSeqs` | `32` | Largest accepted `max_seqs`. |
| `recallTimeoutMs` | `120000` | Wall-clock budget for one recall child, in milliseconds. |
| `maxRecallTimeoutMs` | `900000` | Largest accepted recall timeout. |
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
- **Tool catalog** — zero memory schemas before compaction, four after, five when a subagent runtime is reachable. The catalog change fires `tools/change`, so the next assembly reflects it.
- **Delegated recall** — `memory_recall` blocks for the child's run and returns one labeled, unverified sentence plus exact excerpts. It is the only tool here that starts another agent, and it is unavailable to a seeded child session.
- **Tool results** — plain text, bounded by the row and total output budgets; oversized rows are truncated at a marker naming the `seq` that reads them in full, and the host's spill policy is the last resort rather than the first.
- **Compaction** — the replacement checkpoint is metadata and retrieval instructions only, and it names the tools that just became available. Note that the base backend frames every checkpoint with a fixed "condensing an earlier span" preamble; the stub body states explicitly that no summary was generated.

## Security and privacy

- The corpus is exactly one session: the caller's. No tool accepts a session id, so cross-session reads are not expressible, let alone authorized.
- Nothing is deleted or rewritten. The raw session log stays append-only, and the tools are read-only: there is no write, pin, or forget surface in this version.
- The tools only exist for sessions that compacted, so a fresh session exposes no memory surface at all.

## Known limitations

- **Literal scan, not ranked retrieval** — `memory_search` and `memory_list` use the service's provider-independent predicates: literal text plus `type`/`surface`/`seq`/`time` metadata. There is no relevance ranking or tokenizer tuning. Enable FTS5 and the official tool package for ranked cross-session search.
- **Metadata predicates need a known vocabulary** — `memory_list({ type })` enumerates types the caller names; the tools do not expose a type histogram, so an unfamiliar log is explored by listing unfiltered rows first.
- **No embeddings** — the harness ships no embedding provider, so semantic recall is out of scope here. `memory_recall` narrows the gap by delegating the *search* to a child agent, but the child still queries with literal phrases; it does not embed.
- **Recall is generative in one narrow place** — the child's one-line answer is a model output, so it is labeled `unverified` and never used as evidence. Only the excerpts, re-read from this session at the seqs the child named, are treated as exact.
- **Recall costs a child run** — one call blocks for several model round trips, bounded by `recallTimeoutMs`. The archive is not replayed into the child's prompt, so the cost scales with the child's search loop, not with log size.
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
