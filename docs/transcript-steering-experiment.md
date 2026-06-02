# Transcript Steering Experiment

## Purpose

This experiment tests whether the suggester works better as a **steering layer** than as a predictor of the user's next prompt.

The idea is simple:
- the implementation agent often gets stuck in local momentum
- the suggester should zoom out
- it should help keep the implementation agent aligned with the vision and the highest-leverage next move

This experiment is local-only for now.

## Vision

For the broader rationale, see:
- `docs/suggester-steering-redesign.md`

## What changed

The transcript-based strategy is now:
- `transcript-steering`

It supersedes the old `transcript-cache` strategy.

## How to try it locally

### Option 1: use `/suggesterSettings`

Open:
- `/suggesterSettings`

Then set:
- **Suggestion strategy** → `transcript-steering`

Optional tuning knobs:
- **Transcript max context %**
- **Transcript max messages**
- **Transcript max chars**
- **Transcript rollout %**

You can also create named variants and switch between:
- `compact`
- `transcript-steering`

Useful UI entries:
- **Active variant**
- **Manage variants**
- **Compare variants**
- **A/B stats**

### Option 2: project/user override config

Write an override through the existing config system with:
- `suggestion.strategy = "transcript-steering"`

The settings UI is the easiest path for manual testing.

## What to look for

Do **not** judge the experiment by asking whether it predicted the literal next user prompt.

Instead ask:
- did it reduce drift?
- did it help the implementation agent zoom out?
- did it tell the agent to verify or close loops at the right time?
- did it move on when the current thread was done enough?
- did it ask better questions when the next move was unclear?
- did it feel more useful than compact mode?

## How to inspect what happened

### Status
Use:
- `/suggester status`

This shows:
- active strategy
- active variant
- transcript guardrails
- configured model / thinking
- last suggestion

### Logs
Inspect:
- `${PI_CODING_AGENT_DIR:-~/.pi/agent}/prompt-suggester/projects/<project-key>/logs/events.ndjson`

Relevant fields include:
- `variantName`
- `requestedStrategy`
- `strategy`
- `fallbackReason`
- `sampledOut`
- `transcriptMessageCount`
- `transcriptCharCount`
- `contextUsagePercent`

This makes it possible to tell whether transcript steering was actually used or whether it fell back to compact mode.

## Important note about variant comparisons

Variant-based suggestion generation should now honor transcript steering as well, so local A/B comparisons can exercise the transcript strategy instead of silently collapsing to compact mode.

## Not in scope yet

This experiment does **not** yet try to:
- redesign the whole package
- add a scout/explorer subagent
- publish a new npm version
- fully remove every legacy steering-related setting

The goal right now is just to learn whether transcript steering is actually better in real sessions.
