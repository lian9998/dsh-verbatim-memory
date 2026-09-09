# Changelog

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
