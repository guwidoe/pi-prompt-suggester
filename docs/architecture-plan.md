# Architecture Plan: maintainable foundation for `pi-prompt-suggester` (historical)

> Note: this planning doc is retained for context and is not fully aligned with the live implementation.
> For current behavior, use `docs/architecture.md` and `docs/architecture-decisions.md`.

## Design goals

1. **Clean module boundaries** (no cross-cutting spaghetti).
2. **Config-driven behavior** (no magic constants in logic code).
3. **Async-first seeding** (never blocks turn flow).
4. **Simple deterministic core + LLM intelligence** where intended.
5. **Testable by construction** (pure domain logic, mocked ports).
6. **Future-proof extension points** (new suggestion strategies, richer UX, eval tooling).

---

## Architectural style

Use a **Ports & Adapters / Hexagonal** structure:

- **Domain layer**: pure types + rules (no IO).
- **Application layer**: use-cases/orchestration.
- **Infrastructure layer**: file system, git, model calls, pi UI/events.
- **Composition root**: wires concrete implementations.

This keeps core logic stable while adapters change.

---

## Proposed module layout

```txt
src/
  index.ts                        # composition root + extension registration

  config/
    schema.ts                     # config schema + defaults
    loader.ts                     # layered config loading/validation
    types.ts

  domain/
    seed.ts                       # Seed, KeyFile, StalenessResult types
    suggestion.ts                 # Suggestion, TurnStatus, NoSuggestion
    steering.ts                   # SteeringEvent, classification enums
    state.ts                      # RuntimeState aggregate

  app/
    orchestrators/
      session-start.ts            # startup flow
      turn-end.ts                 # per-turn flow
      user-submit.ts              # steering capture flow
      reseed-runner.ts            # async reseed orchestration

    services/
      staleness-checker.ts        # seed stale detection
      suggestion-engine.ts        # fast-path + model path
      prompt-context-builder.ts   # builds meta prompt inputs
      steering-classifier.ts      # accepted vs changed logic

    ports/
      seed-store.ts               # load/save seed contract
      state-store.ts              # load/save state contract
      model-client.ts             # prompt generator + seeder model contract
      vcs-client.ts               # git diff/name-only contract
      file-hash.ts                # hashing contract
      logger.ts                   # structured logging
      clock.ts                    # injectable clock
      task-queue.ts               # background job scheduling

  infra/
    pi/
      extension-adapter.ts        # wraps pi events/commands/ui
      ui-adapter.ts

    storage/
      json-seed-store.ts
      json-state-store.ts
      atomic-write.ts

    model/
      pi-model-client.ts

    vcs/
      git-client.ts

    hashing/
      sha256-file-hash.ts

    queue/
      in-memory-task-queue.ts     # single-process async queue with lock/pending

    logging/
      console-logger.ts

  prompts/
    seeder-template.ts
    suggestion-template.ts

  scripts/
    stale-check.ts                # reusable checker entrypoint (optional CLI)
```

---

## Key abstractions (critical)

## 1) `Config`

Single typed config object used everywhere.

Sources (highest precedence last):
1. built-in defaults (`src/config/schema.ts`)
2. project file: `${PI_CODING_AGENT_DIR:-~/.pi/agent}/prompt-suggester/projects/<project-key>/config.json`
3. optional user file: `${PI_CODING_AGENT_DIR:-~/.pi/agent}/prompt-suggester/config.json`
4. additional config overlays (user/project)

All config is validated at startup; invalid config fails with clear messages.

### Config domains
- `seed`: key file globs, staleness policy, diff limits
- `reseed`: queue behavior, cooldowns, max concurrent (default 1)
- `suggestion`: max context sizes, `[no suggestion]` token, fast-path behavior
- `steering`: history window, similarity threshold, example limits
- `logging`: level, debug toggles

---

## 2) `ReseedRunner` (async state machine)

State machine:
- `idle`
- `running`
- `pending`

Rules:
- only one active reseed job
- if trigger arrives during `running`, mark `pending=true`
- on completion, rerun once if pending

Inputs:
- `ReseedTrigger { reason, changedFiles, gitDiffSummary? }`

Output:
- persisted new seed + reseed metadata

This is the backbone for non-blocking freshness.

---

## 3) `StalenessChecker`

Pure service (easy to test):
- compares current hashes to the `seed.keyFiles` discovered by the seeder in the last run
- optionally uses `VcsClient` for changed files/diff summary
- returns:

```ts
{
  stale: boolean;
  reason: 'initial_missing' | 'manual' | 'key_file_changed' | 'config_changed' | 'generator_changed';
  changedFiles: string[];
  gitDiffSummary?: string;
}
```

Used on session start and every turn end.

---

## 4) `SuggestionEngine`

Single entrypoint:

```ts
suggest(turn: TurnContext, seed: Seed | null, steering: SteeringSlice): Promise<SuggestionResult>
```

Behavior:
1. If `turn.status in ['error','aborted']` -> deterministic `continue`.
2. Else build structured prompt context.
3. Call `ModelClient.generateSuggestion(...)`.
4. Normalize output:
   - plain prompt string, or
   - `[no suggestion]` sentinel.

No heuristic ladder complexity here.

---

## 5) `SteeringClassifier`

Pure deterministic module:
- normalize text
- compute similarity (token + edit)
- classify:
  - `accepted_exact`
  - `accepted_edited`
  - `changed_course`

Thresholds come from config only.

---

## 6) `PromptContextBuilder`

Builds the exact sections consumed by prompt templates:
- latest assistant turn
- turn status
- seed summary
- recent accepted pairs
- recent changed pairs

Handles truncation/budgets from config (not hardcoded in templates).

---

## Data ownership

- `seed.json` is owned by Seed subsystem only.
- `state.json` is owned by Steering/Suggestion orchestration.
- Use stores with atomic write to prevent corruption.
- Schema version fields mandatory for migrations.

---

## Dependency rules (strict)

1. `domain/*` imports nothing from `infra/*`.
2. `app/*` can import `domain/*` + `app/ports/*` only.
3. `infra/*` implements ports; never imported by domain.
4. `index.ts` is the only place wiring concrete adapters.
5. Prompt templates are passive; no business logic inside strings.

---

## Observability and diagnostics

Structured logs with event names:
- `session.start`
- `stale.check.completed`
- `reseed.triggered`
- `reseed.started`
- `reseed.completed`
- `suggestion.fast_path_continue`
- `suggestion.generated`
- `steering.recorded`

Optional debug command:
- `/suggester status` -> shows seed age, reseed state, recent steering summary.

---

## Testing strategy

## Unit tests (pure)
- `staleness-checker`
- `steering-classifier`
- `prompt-context-builder`
- `suggestion-engine` fast-path behavior

## Contract tests
- `json-seed-store` + `json-state-store` read/write/versioning
- config loader precedence + validation

## Integration tests
- session start without seed (non-blocking + reseed queued)
- turn end stale detection + async reseed trigger
- error turn => `continue`

---

## Implementation phases (architecture-first)

1. **Skeleton + dependency rules**
   - create folder structure + port interfaces + composition root.

2. **Config system first**
   - schema/defaults/loader + sample config file.

3. **State/seed stores**
   - typed read/write + migrations + atomic writes.

4. **Staleness + reseed runner**
   - async queue + trigger payload + git diff integration.

5. **Suggestion engine + context builder**
   - fast-path continue + model path + `[no suggestion]`.

6. **Steering tracking**
   - capture and persist suggestion/user pairs.

7. **Commands + diagnostics**
   - `/suggester reseed`, `/suggester status`.

---

## Config example (project prompt-suggester config)

```json
{
  "seed": {
    "maxDiffChars": 3000
  },
  "reseed": {
    "enabled": true,
    "checkOnSessionStart": true,
    "checkAfterEveryTurn": true,
    "maxConcurrentJobs": 1
  },
  "suggestion": {
    "noSuggestionToken": "[no suggestion]",
    "fastPathContinueOnError": true,
    "maxAssistantTurnChars": 4000
  },
  "steering": {
    "historyWindow": 20,
    "acceptedThreshold": 0.82,
    "maxChangedExamples": 6
  },
  "logging": {
    "level": "info"
  }
}
```

---

## Non-negotiables to prevent spaghetti

- No business logic in `index.ts`.
- No direct `fs`/`bash` calls from app/domain services.
- No inline constants for thresholds/budgets.
- No hidden side effects in prompt builders.
- Every async workflow behind a named orchestrator/service.
