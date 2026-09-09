# Changelog

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
