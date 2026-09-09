# Changelog

## 0.4.2

Fix: the recall child could not be started at all — `toolFilter` named tools the
registry refuses to restrict.

- **Wrong filter shape** — the child was started with
  `toolFilter: { allow: ["memory_list", "memory_search", "memory_read"] }`, and
  `restrict()` validates names against the tools a scope *inherits*. These are
  registered in the child's own scope, so every start failed with
  `tools.restrict() names unknown global tools …`. The filter is now
  `{ allow: [] }`: a restriction never applies to the scope's own registrations,
  so the child keeps exactly its scoped tools — the read-only memory tools, the
  delegation runtime's `structured_output`, and the harness's per-agent
  `subagent` tool — and inherits none of the deployment's globals or the
  parent's preset plane. Verified live: the child's own request header listed
  exactly those six tools, and its ten calls were `memory_search` ×5,
  `memory_read` ×3, `memory_list` ×1, `structured_output` ×1.
- **No recursive catalog entry** — `memory_recall` is no longer registered for a
  subagent child, so the child's catalog holds only the read-only tools. The
  in-body refusal stays as the second guard.
- **Contract test** — `tests/tool-filter.spec.ts` drives the real `ToolRuntime`
  (not the fakes) and pins the exemption this depends on: `allow: []` hides
  every inherited tool, keeps the scope-local one, leaves the deployment's view
  untouched, and naming a scope-local tool is rejected. This is the test that
  would have caught the original defect.

## 0.4.1

Fix: `memory_recall` refused to run in the sessions that need it most.

- **Wrong child test** — the recursion guard keyed on the `session/end-seed`
  event, which marks the end of a constructor seed. A *top-level* session
  acquires that marker too, whenever it is resumed from storage (a host restart)
  or replayed around a compaction, so a root agent that had just been resumed or
  compacted got `memory_recall is unavailable to a subagent`. The guard now reads
  the durable facts the subagent runtime stamps on every child session —
  `origin: 'subagent'` and a positive `delegationDepth` — and falls back to the
  child's own `subagent/descriptor` event. Behavior for real subagent children
  (including a recall child) is unchanged: they are still refused.

## 0.4.0

Delegated recall: the one question a literal scan cannot answer is now a tool
call instead of a hand-rolled fork.

- **`memory_recall` (new)** — ask a question whose wording you cannot guess
  ("is she angry?"). The plugin starts a child agent through `ctx.subagents`
  (default provider `fork`) with `maxDepth: 1` and a tool filter that leaves it
  only `memory_list`, `memory_search`, and `memory_read`, and asks it for one
  line plus `{seq, quote}` pairs.
- **Verified evidence, not the child's copy** — every pair is re-read from the
  calling session's own log; a pair is kept only when the quoted text really
  occurs at the named seq, and the rendered excerpt is the exact logged text.
  The child's sentence is labeled `child answer (unverified)` and never used as
  evidence. Status is `found`, `empty`, `unverified`, `cancelled`, or `error`.
- **No archive replay** — a fork seed classifies inherited events `shadowed`, so
  the child receives the log as data rather than as prompt context. The cost of
  a recall is the child's search loop, not the size of the archive.
- **Guards** — the tool is not registered without a subagent runtime or when
  `recallEnabled` is false, is refused to a seeded child session, and is bounded
  by `recallTimeoutMs` (a timeout disposes the child and reports `cancelled`).
- **Config** — `recallEnabled`, `recallProvider`, `recallSeqs`, `maxRecallSeqs`,
  `recallTimeoutMs`, `maxRecallTimeoutMs`, plus a per-call `max_seqs`.
- **Guidance and checkpoint hints** — the prompt section and the checkpoint stub
  now point the associative question at `memory_recall`.

## 0.3.0

Retrieval-surface change: a set question no longer requires guessing substrings,
and a result set can no longer flood the caller's context.

- **`memory_list` (new)** — enumerate the calling session's log by metadata with
  no text query. `memory_list({ type: ["user/message"] })` answers "every message
  I sent" in one call; a literal search could not. Rows carry `[#seq] type @ time
  surface=…` plus exact logged text, and the header reports the total match count.
- **Shared metadata filters** — `memory_list` and `memory_search` accept `type`,
  `surface`, `seq_from`/`seq_to`, and `time_from`/`time_to`, projected onto the
  service's existing AND-ed clauses. No new capability and no cross-session reach.
- **Ordering and paging** — `order: "desc"` returns the newest matches first, and
  `offset` continues a truncated set. Previously a capped search kept the oldest
  matches and silently dropped the newest.
- **Bounded output** — rows are truncated only at an explicit
  `…[+N chars; memory_read({ seq: X })]` marker, and rows past the output budget
  are omitted with a count instead of spilling the whole result to disk. New
  `defaultRowChars`/`maxRowChars` and `defaultOutputChars`/`maxOutputChars`
  config keys, plus a per-call `max_chars`.
- **Guidance and checkpoint hints** — the prompt section now names the
  enumeration tool, states which tool answers which question, and points broad
  retrievals at `subagent_fork` (a forked child inherits this session's log,
  including compacted-away events, and gets these tools; a fresh subagent does
  not). The checkpoint stub lists `memory_list` too.

## 0.2.0

Scope and visibility change: the memory tools now exist only for a session that
compacted, and only ever read that session.

- **Visible only after compaction** — the standing plugin installs the tools in
  each agent's own scope, and only once that session's log carries a compaction
  checkpoint (`isCompactCheckpointSource`). An uncompacted session sees no tools
  and no guidance section; a resumed compacted session sees them immediately.
  Set `exposeAfterCompaction: false` to opt out.
- **Session-scoped search only** — `memory_sessions` was removed and no tool
  accepts a session id. `memory_search`, `memory_read`, and `memory_ask` read
  exactly the calling session's log, including `shadowed` and `log-only` events.
- The evidence bundle now carries `session_id` instead of cross-session scan
  diagnostics.
- The compaction checkpoint body now states that the memory tools just became
  available and uses the simplified `memory_read({ seq, before, after })` hint.
- Tests cover the gating lifecycle (mount, checkpoint event, resume, disposal),
  session-scoped scanning, and the compaction hook.

## 0.1.0

Initial release.

- `dsh-verbatim-memory`: four read-only model tools over `ctx.sessionQuery` —
  `memory_sessions`, `memory_search`, `memory_read`, and `memory_ask` — with
  exact `cwd` workspace authorization and provenance on every excerpt.
- `dsh-verbatim-memory/compaction`: `VerbatimCompactionEngine`, a
  `BasicCompactionEngine` subclass that replaces LLM summarization with a
  deterministic verbatim-retention stub and never calls `ctx.llm.stream()`.
- Configurable bounds for every limit, plus optional embedding of exact user
  text in the compaction checkpoint.
