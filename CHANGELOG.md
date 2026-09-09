# Changelog

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
- Unit tests covering authorization, literal scanning, evidence bundles,
  rendering, and the compaction hook.
