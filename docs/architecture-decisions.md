# Architecture Decisions (Current)

## 1) Seed is project-global; runtime behavior is session/branch-local
- **Decision:** store seed in `${PI_CODING_AGENT_DIR:-~/.pi/agent}/prompt-suggester/projects/<project-key>/seed.json`, and store interaction/runtime state in extension-owned files under the same project directory's `sessions/<session-id>/`, not in Pi session JSONL or the workspace.
- **Why:** project intent is repo-wide, while per-branch suggestion/steering traces should stay with the active conversation branch without contaminating Pi’s official session storage or polluting agent searches in the workspace.

## 2) Suggestion generation runs on `agent_end`
- **Decision:** trigger suggestions after the full completion, not each internal tool turn.
- **Why:** avoids premature suggestions during multi-turn tool execution.

## 3) Reseeding is asynchronous with trigger coalescing
- **Decision:** run one reseed at a time; merge pending triggers while busy.
- **Why:** keeps UX responsive and avoids duplicate reseeds.

## 4) Seeder is agentic and read-only by protocol
- **Decision:** seeder performs iterative exploration via `ls/find/grep/read` before finalizing.
- **Why:** better repository understanding than static context packing.

## 5) Required categories must be explicitly reported, including not-found
- **Decision:** require `categoryFindings` for `vision`, `architecture`, `principles_guidelines` with `found`, `rationale`, `files`.
- **Why:** prevents silent omissions while allowing honest “not found” outcomes.

## 6) Seed contains both structured lists and concise summaries
- **Decision:** keep `topObjectives[]` and `constraints[]`, plus summaries for intent/objectives/constraints/principles/status.
- **Why:** prompt generation needs both compact narrative context and list-style anchors.

## 7) Non-success turns may fast-path to `continue`
- **Decision:** preserve configurable fast-path `continue` for both `error` and `aborted` turns.
- **Why:** keeps recovery/pivot behavior immediate and predictable after unsuccessful completions.

## 8) Suggestion UX is ghost-only with guarded rendering
- **Decision:** render the suggestion itself as ghost text only when editor state is compatible; otherwise hide it.
- **Why:** the suggestion should never be moved into another surface just to make it visible. The stock pi footer stays intact, while status/warnings can use separate status/widget UI.

## 9) Per-role model and thinking overrides are persisted in project config
- **Decision:** `seeder` and `suggester` each support override for model and thinking level via commands, written to the project config under Pi's agent data directory.
- **Why:** quality/cost tuning differs between deep seeding and fast next-prompt suggestion, and file-backed config survives restarts.

## 10) Observability is persisted to bounded NDJSON logs
- **Decision:** log seeder and suggestion events to `logs/events.ndjson` under the project-specific prompt-suggester directory in Pi's agent data dir, with truncation/rotation.
- **Why:** enables post-run debugging/tuning without noisy stdout.

## 11) Usage accounting is tracked per pipeline and persisted per session
- **Decision:** persist separate usage counters for suggestion generation and seeding in extension-owned per-session files, and expose combined totals in `/suggester status`.
- **Why:** seeding can be expensive and should be visible independently from turn-time suggestion cost, and totals must survive extension reload/session resume without writing extension-private data into Pi session JSONL.

## 12) Operational command surface remains unified under `/suggester`
- **Decision:** status/reseed/model/thinking/config/seed-trace are subcommands.
- **Why:** one discoverable command namespace keeps UX coherent.

## 13) Full-transcript prompting ships as an experiment, not a replacement
- **Decision:** keep the existing compact-summary suggester as the control and add a transcript-cache strategy as a variant-driven experiment.
- **Why:** this is a large quality/cost tradeoff change and should be measurable before becoming the default.

## 14) Transcript-cache requests must preserve a shared prompt prefix
- **Decision:** the experimental suggester reuses the real session system prompt and reconstructed branch transcript, and only diverges in a final suggester-only user message.
- **Why:** prompt caching depends on stable shared prefixes; putting experimental instructions in the suffix gives the next real user prompt the best chance of reusing the same cached prefix.

## 15) Unsafe or oversized transcript runs fall back to compact prompting
- **Decision:** the transcript-cache strategy must be guarded by eligibility checks (context usage, branch size, reconstruction success, request failures) and fall back to the compact strategy when needed.
- **Why:** this keeps rollout safe and prevents a cache miss or oversized branch from turning the experiment into a large surprise cost spike.
