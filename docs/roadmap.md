# Roadmap

## Phase 0: Foundation
- [x] Repo scaffold
- [x] Vision and architecture docs
- [x] Seed schema + runtime state schema

## Phase 1: Async Seeding
- [x] Background reseeding runner (non-blocking)
- [x] Staleness checks on session start and per-turn
- [x] Persist seed with key-file hashes + metadata
- [x] Manual reseed command

## Phase 2: Agentic Seeder
- [x] Replace static context seeding with agentic exploration (`ls/find/grep/read`)
- [x] Required-category findings with explicit `not_found` handling
- [x] Support multiple files per category
- [x] Add structured summaries: intent/objectives/constraints/principles/status

## Phase 3: Suggestion Quality + UX
- [x] `agent_end`-driven suggestion generation
- [x] Ghost-only suggestion editor behavior with guarded compatibility checks
- [x] Steering capture and classification (`accepted_exact | accepted_edited | changed_course`)
- [x] Include richer seed context in suggestion prompt
- [x] Token/cost tracking for suggester + seeder (with combined status totals)

## Phase 4: Runtime Controls
- [x] `/suggester model ...` (per-role seeder/suggester overrides)
- [x] `/suggester thinking ...` (per-role thinking overrides)
- [x] Project-config-persisted overrides (stored outside the workspace under Pi's agent data directory)

## Phase 5: Observability
- [x] Persistent NDJSON event log
- [x] Seeder exploration + suggestion pipeline event tracing
- [x] `/suggester seed-trace [limit]`

## Next
- [ ] Replay/eval harness for offline quality tuning
- [ ] Additional seed-trace filtering/export tooling
- [ ] Prompt tuning loops based on rejected steering patterns
