# Changelog

> Note: Some early `0.1.x` entries are best-effort reconstructions from git history plus npm publish history because not every npm publish has a matching git tag or dedicated release commit in the repository history.

## Unreleased

## 0.3.9 - 2026-05-08

### Fixed
- Updated pi core imports and peer dependencies to the new `@earendil-works/*` package scope and adjusted session lifecycle handling for current pi releases.

## 0.3.8 - 2026-04-20

### Added
- Added configurable ghost suggestion accept keys so inline suggestions can now be accepted with `Space`, `Right`, or both.
- Added a `/suggesterSettings` control for choosing the ghost suggestion accept key without editing JSON manually.

### Fixed
- Fixed the packaged default config schema version so the shipped defaults validate correctly with the new ghost accept key setting.

## 0.3.7 - 2026-04-13

### Fixed
- Fixed `session-default` suggester calls with `pi-claude-bridge` by using the bridge's shared global stream shim when the local provider registry cannot resolve `claude-bridge`.
- Fixed unsupported custom session providers to fail gracefully for suggestions with a one-time warning instead of logging noisy provider-registration errors after every turn.
- Improved unsupported-provider handling for seeding so users now get a clear actionable error telling them to configure an explicit supported model.

## 0.3.6 - 2026-04-06

### Fixed
- Fixed ghost suggestion visibility across interactive UI/context resets by reinstalling the ghost editor when pi recreates the active extension context for the same session.

## 0.3.5 - 2026-04-03

### Added
- Added widget-mode suggestion acceptance via `F2`, including an inline widget hint so users can discover how to apply a suggestion without the ghost editor.

### Fixed
- Fixed the extension-interference issue by adding a switchable suggestion display mode so users can move suggestions from the ghost editor into the widget when another extension needs to own the editor.
- Fixed display-mode switching so the ghost editor is correctly removed after switching to widget mode and stale widget suggestion content disappears again after switching back to ghost mode.

## 0.3.4 - 2026-04-01

### Fixed
- Fixed the suggester model picker UI so long model lists stay usable in small terminals and tmux panes by using a bounded searchable overlay instead of an unbounded selector.
- Applied the improved scrollable model picker flow across `/suggester model`, suggester settings, and variant model configuration.

## 0.3.3 - 2026-03-31

### Fixed
- Fixed compatibility with newer `@mariozechner/pi-coding-agent` releases that replaced `ModelRegistry.getApiKey()` with `getApiKeyAndHeaders()`, including forwarding resolved request headers to provider calls.
- Added regression coverage for both the new auth API and the legacy fallback path so auth resolution keeps working across pi versions.

## 0.3.2 - 2026-03-25

### Added
- Added experimental `transcript-steering` suggestion mode, including prompt generation, settings UI controls, and A/B testing support.
- Added panel toggles for showing suggestion status and suggester usage in the inline widget.
- Added documentation for the transcript steering redesign and experiment workflow.

### Changed
- Replaced the earlier `transcript-cache` experiment with the new `transcript-steering` approach.
- Improved package keywords to make the extension easier to discover on npm.
- Moved suggester usage tracking from the crowded footer into the suggester panel.

### Fixed
- Fixed repeated rejected suggestions being shown again.
- Fixed transcript steering to use pi's effective compaction-aware session context instead of rebuilding raw branch history.
- Fixed transcript steering fallback behavior for long sessions so message and character counts no longer incorrectly block suggestions on their own.
- Fixed ghost suggestion editor installation so inline ghost suggestions remain available across interactive session lifecycle changes.
- Fixed several suggestion visibility issues around turn-end timing, hidden suggestions, and panel rendering.

## 0.3.1 - 2026-03-15

- Preserved prompt history across ghost editor swaps so inline suggestions no longer break history navigation.
- Added the first `transcript-cache` experiment pieces, including transcript prompt context building, metrics, and evaluation coverage.
- Refreshed local pi development dependencies and expanded npm package metadata for discoverability.

## 0.2.0 - 2026-03-13

- Added variant-based A/B testing for suggester experiments.
- Expanded variant preset controls for comparing suggester behaviors.
- Reduced overly meta suggestion framing so suggestions read more like plausible next prompts.

## 0.1.30 - 2026-03-13

- Removed stale wrapped footer code after the UI simplifications around ghost suggestions.

## 0.1.29 - 2026-03-13

- Split shared suggester utilities into cleaner modules and added more test coverage.

## 0.1.28 - 2026-03-13

- Fixed the published package to include the compiled extension files required for npm installs.

## 0.1.27 - 2026-03-13

- Reduced semantic restatement when the user is simply approving the assistant's proposed next step.

## 0.1.26 - 2026-03-12

- Prioritized custom suggester instructions more strongly in prompt generation.

## 0.1.25 - 2026-03-12

- Removed the older legacy hint workflow in favor of the newer steering and feedback paths.

## 0.1.24 - 2026-03-12

- Recovered turn context correctly for quote-based suggestion follow-ups.

## 0.1.23 - 2026-03-12

- Refined suggestion approval guidance so short confirmations are handled more naturally.

## 0.1.22 - 2026-03-12

- Auto-normalized invalid override config files instead of leaving broken override state behind.

## 0.1.21 - 2026-03-11

- Added turn-based staleness checking for reseeding.
- Forced final seeder synthesis after the maximum number of seeding steps.
- Suppressed transient background reseed failures so they do not disrupt interactive usage.

## 0.1.15–0.1.20 - 2026-03-11 _(reconstructed)_

- Moved suggester state and usage tracking out of pi session entries into dedicated per-session storage.
- Aligned the suggester model picker with pi's model list.
- Restored the built-in footer, reduced suggester UI noise, and kept the active suggester model visible.
- Added npm repository metadata for the published package.

## 0.1.14 - 2026-03-11

- Added a top-level suggester settings menu.

## 0.1.13 - 2026-03-11

- Added prompt token visibility to the footer.

## 0.1.12 - 2026-03-11

- Avoided reusing stale assistant turns in prompt generation.
- Removed accepted-history prompt plumbing that was no longer helping suggestion quality.

## 0.1.11 - 2026-03-11

- Added scoped `/suggester config` commands, config migrations, and persistent usage totals.
- Continued stabilizing ghost suggestion UI, widget wrapping, and prompt sizing.
- Completed the rename to `pi-prompt-suggester` and the `/suggester` command surface.

## 0.1.1–0.1.10 - 2026-03-11 _(reconstructed)_

- Built the first end-to-end autoprompter / prompt suggester flow.
- Added inline ghosted prompt suggestions inside the editor.
- Improved abort handling and multiline ghost suggestion behavior.
- Added structured seeding summaries plus separate seeder/suggester model and thinking overrides.
- Persisted seed and suggestion trace events for debugging and iteration.
- Migrated config loading toward file-based defaults and npm-friendly package defaults.

## 0.1.0 - 2026-03-11

- Initial npm release.
