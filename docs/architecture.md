# Architecture (Current)

## Overview

`pi-prompt-suggester` has five runtime pieces:

1. **Suggestion pipeline** (runs on `agent_end`)
2. **Agentic reseed runner** (background, non-blocking)
3. **Steering tracker** (session/branch-aware)
4. **UI sink** (ghost suggestion + usage line)
5. **Persistent observability log** (`${PI_CODING_AGENT_DIR:-~/.pi/agent}/prompt-suggester/projects/<project-key>/logs/events.ndjson`)

---

## 1) State model

### Project-global (file)
`${PI_CODING_AGENT_DIR:-~/.pi/agent}/prompt-suggester/projects/<project-key>/seed.json`

Contains:
- seed summaries (intent/objectives/constraints/principles/status)
- key files (+ hashes + category)
- required-category findings (`vision`, `architecture`, `principles_guidelines`) with `found/not_found` rationale
- generator/prompt/config fingerprints

### Session/branch-local (extension-owned files)
`${PI_CODING_AGENT_DIR:-~/.pi/agent}/prompt-suggester/projects/<project-key>/sessions/<session-id>/...`

Contains:
- last shown suggestion
- steering history (`accepted_exact | accepted_edited | changed_course`)
- session-persistent suggester usage/cost counters
- session-persistent seeder usage/cost counters
- combined totals for status/UI display

Older `suggester-state` / `suggester-usage` Pi custom entries are only used as a one-time legacy migration source.

---

## 2) Agentic seeding

Reseeding is queued async and never blocks interaction.

Trigger points:
- session lifecycle events (`session_start/tree/fork/switch`)
- `agent_end` stale check
- manual `/suggester reseed`

Seeder implementation:
- iterative model loop with read-only tools: `ls`, `find`, `grep`, `read`
- explicit required-category coverage in final output
- accepts `found: false` when rationale is provided
- multiple files per category supported

Validation requires:
- all required `categoryFindings`
- non-empty rationale for each
- if `found=true`, at least one matching key file tagged with that category

---

## 3) Suggestion pipeline

Trigger:
- `agent_end` only

Inputs:
- assistant completion + status (`success | error | aborted`)
- recent user prompts
- tool signals + touched files + unresolved questions
- full intent seed summaries + categorized key files + category findings
- recent accepted/changed steering examples

Behavior:
- non-success turns (`error`, `aborted`) can fast-path to `continue` (configurable)
- output is one suggestion or `[no suggestion]`
- multi-line suggestions allowed; bounded by `maxSuggestionChars`

---

## 4) UI behavior

- Suggestions can ghost in the editor when safe (idle, no pending messages, editor-empty policy; multiline requires an empty editor)
- Ghost suggestions accept on configured keys when the editor is empty (`Space` by default; `Right` also supported)
- Non-compatible cases hide the ghost suggestion; the suggestion text is never moved into the below-editor widget
- The stock pi footer is preserved
- Compact suggester info uses status lines
- Richer suggester state/warnings use a below-editor widget

---

## 5) Observability

Persistent log file:
- `${PI_CODING_AGENT_DIR:-~/.pi/agent}/prompt-suggester/projects/<project-key>/logs/events.ndjson`

Logged events include:
- seeder run start/completion/exhaustion
- seeder tool requests/results and validation failures
- suggestion turn received, suggestion generated, no-suggestion
- steering classification events

Inspection:
- `/suggester seed-trace [limit]`
- `/suggester status` includes log path plus usage breakdown (suggester/seeder/combined)

---

## 6) Commands

- `/suggester status`
- `/suggester reseed`
- `/suggester model [show|set|clear] ...` (writes project override under Pi's agent data directory)
- `/suggester thinking [show|set|clear] ...` (writes project override under Pi's agent data directory)
- `/suggester config [show|set [project|user] <path> <value>|reset [project|user|all]]`
- `/suggesterSettings` (interactive TUI settings menu)
- `/suggester instruction [show|set|clear]`
- `/suggester seed-trace [limit]`
