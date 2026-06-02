# Implementation Plan: pi-prompt-suggester (historical)

> Note: this document reflects an earlier planning phase and is partially outdated.
> Current behavior is documented in `docs/architecture.md` and `docs/architecture-decisions.md`.

## Goal

Build a practical v1 extension that does three things well:
1. suggest the next user prompt after each agent turn,
2. learn from **accepted vs changed** suggestions,
3. keep project intent seed fresh **without blocking the session**.

The core quality lever is the prompt-generator meta prompt and the context we feed it.

---

## Product constraints for v1

- Keep logic simple and explicit.
- Avoid complex heuristic ladders/scoring systems.
- Prefer passing rich raw context to the prompt-generator model.
- Local-only storage.
- No autonomous sending.

---

## High-level architecture

### Components

1. **Suggestion Engine** (turn-time, fast)
   - input: latest assistant turn output + turn status + seed + steering history
   - output: one suggested prompt or `[no suggestion]`

2. **Seed Manager** (background, async)
   - initial seed generation
   - staleness checks on session start and after every agent turn
   - async reseeding with reason + changed files context

3. **Steering Tracker**
   - records what was suggested vs what user actually sent
   - stores accepted/changed history with raw text pairs
   - provides recent examples to prompt-generator model

4. **State Store**
   - `${PI_CODING_AGENT_DIR:-~/.pi/agent}/prompt-suggester/projects/<project-key>/seed.json`
   - `${PI_CODING_AGENT_DIR:-~/.pi/agent}/prompt-suggester/projects/<project-key>/state.json`

---

## Critical behavior changes

## 1) Seeding must be async and non-blocking

### Session start behavior
- Load existing seed if present.
- Immediately continue session startup (no blocking).
- If seed missing/stale, kick off background reseed job.
- Suggestion engine can run with:
  - current seed (if available), or
  - no seed fallback until reseed completes.

### Concurrency
- At most one reseed job at a time.
- If stale is detected while reseed running, set `reseedPending=true` and rerun once current job finishes.

## 2) Staleness check after every agent turn

After each `agent_end`:
- run lightweight staleness check script/function,
- if stale: trigger async reseed.

Reseed trigger payload should include:
- `reason` (e.g. `initial_missing`, `manual`, `key_file_changed`)
- `changedFiles[]`
- optional `gitDiffSummary` / truncated diff excerpts for changed key files

---

## Read-only seeding agent: feasibility + plan

### Preferred
Run seeding in an isolated worker process/session with read-only policy.

### If hard read-only sandbox is not available in pi APIs
Use practical guardrails:
1. Seeder prompt explicitly says read-only analysis only.
2. Run seeder in isolated session/worker with minimal tool access if configurable.
3. Validate repository cleanliness before/after seeding (`git status --porcelain`).
4. If seeder changed files, discard output and mark run failed.

This gives effective read-only behavior even if strict filesystem RO mount is unavailable.

---

## Suggestion pipeline (simplified)

## Inputs

1. **Latest assistant turn output** (raw text)
2. **Turn status**: `success | error | aborted`
3. **Intent seed** (if available)
4. **Steering context** (detailed recent history)

## Deterministic rule (only hard rule)

- If turn status is `error` or `aborted`:
  - suggestion = `continue`
  - skip model call (fast path)
  - (future optional: direct internal continue trigger if pi supports it cleanly)

All other cases go through prompt-generator model.

No priority ladders, no heuristic score blending.

---

## Steering feedback model (richer context)

Instead of a single follow-rate number, store concrete examples.

For each turn with a shown suggestion:
- `suggestedPrompt`
- `actualUserPrompt`
- `classification` (`accepted_exact | accepted_edited | changed_course`)
- `similarity`
- `timestamp`

When building prompt-generator context, provide:
- last N accepted examples
- last N changed/rejected examples
- explicit pairs: “suggested X, user wrote Y”

This gives the model direct behavioral signal for adaptation.

---

## Meta prompt design (critical)

The prompt-generator agent should receive a structured explanation of:
- its objective,
- what context it is seeing,
- how to interpret steering history,
- what output format to produce.

### Prompt sections (fixed order)

1. `Role`
2. `Task`
3. `TurnStatus`
4. `IntentSeed` (or `none`)
5. `RecentUserPrompts`
6. `RecentSteeringChanged`
7. `LatestAssistantTurn`
8. `Instructions`

### Instructions content

- Generate **one** best next user prompt.
- Keep it concrete and immediately actionable.
- Respect current trajectory unless latest context strongly indicates pivot.
- Learn from changed examples (avoid repeating rejected phrasing/direction).
- If confidence is low, output exactly `[no suggestion]`.

### Output format

- Plain text only.
- Either:
  - a single prompt sentence, or
  - `[no suggestion]`

No JSON schema required.

---

## Data contracts

## Project prompt-suggester `seed.json`

```json
{
  "seedVersion": 1,
  "generatedAt": "2026-03-10T16:00:00Z",
  "sourceCommit": "abc123",
  "projectIntentSummary": "...",
  "topObjectives": ["..."],
  "constraints": ["..."],
  "keyFiles": [
    {"path": "vision.md", "hash": "sha256:...", "whyImportant": "..."}
  ],
  "openQuestions": ["..."],
  "lastReseedReason": "key_file_changed",
  "lastChangedFiles": ["docs/architecture.md"]
}
```

## Project prompt-suggester `state.json`

```json
{
  "stateVersion": 1,
  "lastSuggestion": {
    "text": "...",
    "shownAt": "2026-03-10T16:02:00Z",
    "turnId": "..."
  },
  "reseed": {
    "running": false,
    "pending": false,
    "lastCheckAt": "2026-03-10T16:02:10Z"
  },
  "steeringHistory": [
    {
      "turnId": "...",
      "suggestedPrompt": "continue with step 2",
      "actualUserPrompt": "skip that, write tests first",
      "classification": "changed_course",
      "similarity": 0.28,
      "timestamp": "2026-03-10T16:03:00Z"
    }
  ]
}
```

---

## Staleness checker spec

Run checker:
- on `session_start`
- on every `agent_end`
- on `/suggester reseed`

Checker steps:
1. Compare `keyFiles[].hash` against current files.
2. If git available, compute changed files since `sourceCommit`:
   - `git diff --name-only <sourceCommit>...HEAD`
3. Mark stale if any seeder-discovered key file changed or explicit manual request.
4. Produce reseed trigger payload (`reason`, `changedFiles`, optional diff snippets).

---

## Implementation phases

## Phase 1 — Base wiring
- event hooks (`session_start`, `agent_end`, user submit hook if available)
- load/save state
- command `/suggester reseed`

## Phase 2 — Async seed manager
- background reseed runner with lock/pending flags
- staleness checker + changed-file detection
- reseed payload enrichment (reason + changed files + diff summary)

## Phase 3 — Prompt generator pipeline
- fast-path `continue` on error/aborted turn
- meta prompt builder with rich steering context
- plain-text output handling (`[no suggestion]` support)
- editor prefill integration

## Phase 4 — Steering tracker
- capture suggestion shown
- capture next user prompt
- classify + persist pairs
- include accepted/changed examples in next prompt generation

## Phase 5 — Tuning loop
- local replay runner
- inspect changed-course examples and false positives
- tune only:
  - steering history window size
  - similarity threshold
  - context truncation sizes

---

## Minimal tuning knobs

`src/config.ts`:
- `steeringWindow` (default 20)
- `acceptedSimilarityThreshold` (default 0.82)
- `maxChangedExamplesInPrompt` (default 6)
- `maxAssistantTurnChars` (default 4000)
- `maxDiffCharsForReseedContext` (default 3000)

No complex weight systems.

---

## Acceptance criteria

1. Session start is never blocked by seeding.
2. Staleness check runs after every agent turn.
3. Async reseed triggers with explicit reason + changed files.
4. Error/aborted turns deterministically suggest `continue`.
5. Prompt-generator receives detailed accepted/changed examples.
6. Model can output `[no suggestion]` and UI handles it cleanly.

---

## Risks + mitigations

- **Risk:** read-only seeding not strictly enforceable.
  - **Mitigation:** isolated worker + pre/post git-clean checks.

- **Risk:** steering history grows noisy.
  - **Mitigation:** bounded windows + prioritize recent changed examples.

- **Risk:** prompt bloat from too much context.
  - **Mitigation:** strict truncation limits per section.
