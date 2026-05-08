import { Container, SelectList, Text } from "@earendil-works/pi-tui";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { GhostAcceptKey } from "../../../config/types.js";
import type { AppComposition } from "../../../composition/root.js";
import { SuggesterConfigPersistence } from "./config-persistence.js";
import { resolveModelRef, SESSION_DEFAULT, THINKING_LEVELS, type ConfigScope, summarizeInstruction } from "./shared.js";
import { manageVariantsUi, runAbTestingUi, showAbStats } from "./ab-testing.js";
import { showModelSelector } from "./model-selector.js";
import { formatGhostAcceptKeys } from "../ghost-accept-keys.js";
import { isSuggestionDisplayMode, usesGhostEditor } from "../suggestion-display-mode.js";

export async function handleSettingsUiCommand(
	ctx: ExtensionCommandContext,
	composition: AppComposition,
): Promise<void> {
	if (!ctx.hasUI) {
		ctx.ui.notify("Interactive suggester settings require the TUI.", "error");
		return;
	}

	const persistence = new SuggesterConfigPersistence(ctx, composition);
	let activeScope: ConfigScope = "project";
	const thinkingOptions = [...THINKING_LEVELS, SESSION_DEFAULT];
	const strategyOptions = ["compact", "transcript-steering"] as const;
	const suggestionDisplayOptions = ["ghost", "widget"] as const;

	const formatScopeName = (scope: ConfigScope): string => scope === "project" ? "Project override" : "User override";
	const formatValue = (value: unknown): string => {
		if (typeof value === "string") {
			const trimmed = value.trim();
			return trimmed ? trimmed.replace(/\s+/g, " ").slice(0, 80) : "(empty)";
		}
		if (typeof value === "boolean") return value ? "on" : "off";
		if (typeof value === "number") return String(value);
		if (value === undefined) return "inherit";
		return JSON.stringify(value);
	};
	const describeScopedValue = async (configPath: string, effectiveValue: unknown): Promise<string> => {
		const overrideValue = await persistence.readOverrideValue(activeScope, configPath);
		if (overrideValue === undefined) return `inherit → ${formatValue(effectiveValue)}`;
		return `${formatValue(overrideValue)} (${formatScopeName(activeScope).toLowerCase()})`;
	};
	const describeScopedGhostAcceptKeys = async (): Promise<string> => {
		const overrideValue = await persistence.readOverrideValue(activeScope, "suggestion.ghostAcceptKeys");
		if (overrideValue === undefined) return `inherit → ${formatGhostAcceptKeys(composition.config.suggestion.ghostAcceptKeys)}`;
		return `${formatGhostAcceptKeys(Array.isArray(overrideValue) ? overrideValue as GhostAcceptKey[] : undefined)} (${formatScopeName(activeScope).toLowerCase()})`;
	};
	const getScopedEditorValue = async <T>(configPath: string, effectiveValue: T): Promise<T> => {
		const overrideValue = await persistence.readOverrideValue(activeScope, configPath);
		return (overrideValue === undefined ? effectiveValue : (overrideValue as T));
	};

	const pickMenuAction = async (): Promise<string | null> => {
		const items = [
			{
				value: "ab.activeVariant",
				label: "Active variant",
				description: composition.stores.variantStore.getActiveVariantName(),
			},
			{
				value: "ab.manageVariants",
				label: "Manage variants",
				description: `${composition.stores.variantStore.listVariants().length} variants • strategy, model, thinking, guardrails`,
			},
			{
				value: "ab.compareVariants",
				label: "Compare variants",
				description: "Generate two suggestions and pick the better one",
			},
			{
				value: "ab.stats",
				label: "A/B stats",
				description: "Wins, losses, ties, both-bad",
			},
			{
				value: "scope",
				label: "Base settings scope",
				description: `${formatScopeName(activeScope)} → ${persistence.overridePathForScope(activeScope)}`,
			},
			{
				value: "suggestion.strategy",
				label: "Suggestion strategy",
				description: await describeScopedValue("suggestion.strategy", composition.config.suggestion.strategy),
			},
			{
				value: "suggestion.customInstruction",
				label: "Custom instruction",
				description: await describeScopedValue(
					"suggestion.customInstruction",
					summarizeInstruction(composition.config.suggestion.customInstruction),
				),
			},
			{
				value: "suggestion.maxSuggestionChars",
				label: "Max suggestion chars",
				description: await describeScopedValue("suggestion.maxSuggestionChars", composition.config.suggestion.maxSuggestionChars),
			},
			{
				value: "suggestion.maxRecentUserPrompts",
				label: "Recent user prompts",
				description: await describeScopedValue("suggestion.maxRecentUserPrompts", composition.config.suggestion.maxRecentUserPrompts),
			},
			{
				value: "suggestion.maxRecentUserPromptChars",
				label: "Recent user prompt chars",
				description: await describeScopedValue(
					"suggestion.maxRecentUserPromptChars",
					composition.config.suggestion.maxRecentUserPromptChars,
				),
			},
			{
				value: "suggestion.transcriptMaxContextPercent",
				label: "Transcript max context %",
				description: await describeScopedValue(
					"suggestion.transcriptMaxContextPercent",
					composition.config.suggestion.transcriptMaxContextPercent,
				),
			},
			{
				value: "suggestion.transcriptMaxMessages",
				label: "Transcript max messages",
				description: await describeScopedValue(
					"suggestion.transcriptMaxMessages",
					composition.config.suggestion.transcriptMaxMessages,
				),
			},
			{
				value: "suggestion.transcriptMaxChars",
				label: "Transcript max chars",
				description: await describeScopedValue(
					"suggestion.transcriptMaxChars",
					composition.config.suggestion.transcriptMaxChars,
				),
			},
			{
				value: "suggestion.transcriptRolloutPercent",
				label: "Transcript rollout %",
				description: await describeScopedValue(
					"suggestion.transcriptRolloutPercent",
					composition.config.suggestion.transcriptRolloutPercent,
				),
			},
			{
				value: "steering.maxChangedExamples",
				label: "Changed examples in prompt",
				description: await describeScopedValue("steering.maxChangedExamples", composition.config.steering.maxChangedExamples),
			},
			{
				value: "suggestion.displayMode",
				label: "Suggestion display",
				description: await describeScopedValue(
					"suggestion.displayMode",
					composition.config.suggestion.displayMode,
				),
			},
			{
				value: "suggestion.ghostAcceptKeys",
				label: "Ghost accept keys",
				description: await describeScopedGhostAcceptKeys(),
			},
			{
				value: "suggestion.prefillOnlyWhenEditorEmpty",
				label: "Ghost only on empty editor",
				description: await describeScopedValue(
					"suggestion.prefillOnlyWhenEditorEmpty",
					composition.config.suggestion.prefillOnlyWhenEditorEmpty,
				),
			},
			{
				value: "suggestion.showPanelStatus",
				label: "Show suggestion status in panel",
				description: await describeScopedValue(
					"suggestion.showPanelStatus",
					composition.config.suggestion.showPanelStatus,
				),
			},
			{
				value: "suggestion.showUsageInPanel",
				label: "Show suggester usage in panel",
				description: await describeScopedValue(
					"suggestion.showUsageInPanel",
					composition.config.suggestion.showUsageInPanel,
				),
			},
			{
				value: "suggestion.fastPathContinueOnError",
				label: "Fast-path continue on error",
				description: await describeScopedValue(
					"suggestion.fastPathContinueOnError",
					composition.config.suggestion.fastPathContinueOnError,
				),
			},
			{
				value: "reseed.enabled",
				label: "Automatic reseeding enabled",
				description: await describeScopedValue("reseed.enabled", composition.config.reseed.enabled),
			},
			{
				value: "reseed.checkOnSessionStart",
				label: "Check staleness on session start",
				description: await describeScopedValue("reseed.checkOnSessionStart", composition.config.reseed.checkOnSessionStart),
			},
			{
				value: "reseed.checkAfterEveryTurn",
				label: "Check staleness after every turn",
				description: await describeScopedValue("reseed.checkAfterEveryTurn", composition.config.reseed.checkAfterEveryTurn),
			},
			{
				value: "reseed.turnCheckInterval",
				label: "Turn staleness check interval",
				description: await describeScopedValue("reseed.turnCheckInterval", composition.config.reseed.turnCheckInterval),
			},
			{
				value: "inference.seederModel",
				label: "Seeder model",
				description: await describeScopedValue("inference.seederModel", composition.config.inference.seederModel),
			},
			{
				value: "inference.suggesterModel",
				label: "Suggester model",
				description: await describeScopedValue("inference.suggesterModel", composition.config.inference.suggesterModel),
			},
			{
				value: "inference.seederThinking",
				label: "Seeder thinking",
				description: await describeScopedValue("inference.seederThinking", composition.config.inference.seederThinking),
			},
			{
				value: "inference.suggesterThinking",
				label: "Suggester thinking",
				description: await describeScopedValue("inference.suggesterThinking", composition.config.inference.suggesterThinking),
			},
			{
				value: "reset",
				label: `Reset ${formatScopeName(activeScope)}`,
				description: "Delete override file for the selected base scope",
			},
			{
				value: "close",
				label: "Close",
				description: "Exit suggester settings",
			},
		];

		return await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
			const container = new Container();
			container.addChild(new Text(theme.fg("accent", theme.bold("Suggester Settings")), 1, 0));
			container.addChild(new Text(theme.fg("accent", `${formatScopeName(activeScope)} • ${persistence.overridePathForScope(activeScope)}`), 1, 0));
			container.addChild(new Text(theme.fg("dim", "Base settings write to the selected scope. Variants are edited separately below. Enter select • Esc close"), 1, 0));
			const selectList = new SelectList(items, Math.min(items.length + 1, 16), {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			});
			selectList.onSelect = (item) => done(String(item.value));
			selectList.onCancel = () => done(null);
			container.addChild(selectList);
			return {
				render(width: number) {
					return container.render(width);
				},
				invalidate() {
					container.invalidate();
				},
				handleInput(data: string) {
					selectList.handleInput(data);
					tui.requestRender();
				},
			};
		}, { overlay: true });
	};

	const promptPositiveInt = async (label: string, currentValue: number): Promise<number | undefined> => {
		const raw = await ctx.ui.editor(label, String(currentValue));
		if (raw === undefined) return undefined;
		const parsed = Number.parseInt(raw.trim(), 10);
		if (!Number.isInteger(parsed) || parsed <= 0) {
			ctx.ui.notify("Value must be a positive integer.", "error");
			return undefined;
		}
		return parsed;
	};

	const promptNonNegativeInt = async (label: string, currentValue: number): Promise<number | undefined> => {
		const raw = await ctx.ui.editor(label, String(currentValue));
		if (raw === undefined) return undefined;
		const parsed = Number.parseInt(raw.trim(), 10);
		if (!Number.isInteger(parsed) || parsed < 0) {
			ctx.ui.notify("Value must be a non-negative integer.", "error");
			return undefined;
		}
		return parsed;
	};

	const promptPercent = async (
		label: string,
		currentValue: number,
		options: { allowZero: boolean },
	): Promise<number | undefined> => {
		const raw = await ctx.ui.editor(label, String(currentValue));
		if (raw === undefined) return undefined;
		const parsed = Number.parseInt(raw.trim(), 10);
		const min = options.allowZero ? 0 : 1;
		if (!Number.isInteger(parsed) || parsed < min || parsed > 100) {
			ctx.ui.notify(`Value must be an integer between ${min} and 100.`, "error");
			return undefined;
		}
		return parsed;
	};

	const promptModel = async (label: string, currentValue: string): Promise<string | undefined> => {
		const selected = await showModelSelector(ctx, {
			title: `${label} (current: ${currentValue})`,
			currentValue,
			specialOptions: [{ value: SESSION_DEFAULT, description: "Use the current session model" }],
		});
		if (!selected) return undefined;
		const resolved = resolveModelRef(ctx.modelRegistry.getAll(), selected);
		if (!resolved.ok) {
			ctx.ui.notify(resolved.reason, "error");
			return undefined;
		}
		return resolved.canonicalRef;
	};

	while (true) {
		const action = await pickMenuAction();
		if (!action || action === "close") return;

		try {
			if (action === "ab.activeVariant") {
				const selected = await ctx.ui.select(
					"Active variant",
					composition.stores.variantStore.listVariants().map((entry) => entry.name),
				);
				if (!selected) continue;
				await composition.stores.variantStore.setActiveVariant(selected);
				ctx.ui.notify(`Active variant set to '${selected}'.`, "info");
				continue;
			}

			if (action === "ab.manageVariants") {
				await manageVariantsUi(ctx, composition);
				continue;
			}

			if (action === "ab.compareVariants") {
				await runAbTestingUi(ctx, composition);
				continue;
			}

			if (action === "ab.stats") {
				await showAbStats(ctx, composition);
				continue;
			}

			if (action === "scope") {
				const selected = await ctx.ui.select("Edit which base settings scope?", ["project", "user"]);
				if (selected === "project" || selected === "user") activeScope = selected;
				continue;
			}

			if (action === "reset") {
				const confirmed = await ctx.ui.select(
					`Reset ${activeScope} override?`,
					["cancel", `reset ${activeScope}`],
				);
				if (confirmed !== `reset ${activeScope}`) continue;
				await persistence.resetScopes([activeScope]);
				ctx.ui.notify(`Reset ${activeScope} suggester override.`, "info");
				continue;
			}

			if (action === "suggestion.customInstruction") {
				const currentValue = await getScopedEditorValue(
					"suggestion.customInstruction",
					composition.config.suggestion.customInstruction,
				);
				const next = await ctx.ui.editor(`Custom suggester instruction (${formatScopeName(activeScope)})`, currentValue);
				if (next === undefined) continue;
				await persistence.writeValue(activeScope, action, next);
				ctx.ui.notify(
					next.trim()
						? `Updated ${action} in ${activeScope} override.`
						: `Cleared ${action} in ${activeScope} override.`,
					"info",
				);
				continue;
			}

			if (action === "suggestion.strategy") {
				const currentValue = await getScopedEditorValue("suggestion.strategy", composition.config.suggestion.strategy);
				const selected = await ctx.ui.select(
					`Suggestion strategy (${formatScopeName(activeScope)}, current: ${currentValue})`,
					[...strategyOptions],
				);
				if (!selected) continue;
				await persistence.writeValue(activeScope, action, selected);
				ctx.ui.notify(`Updated ${action} in ${activeScope} override.`, "info");
				continue;
			}

			if (action === "suggestion.prefillOnlyWhenEditorEmpty") {
				const currentValue = await getScopedEditorValue(
					"suggestion.prefillOnlyWhenEditorEmpty",
					composition.config.suggestion.prefillOnlyWhenEditorEmpty,
				);
				const selected = await ctx.ui.select(
					`Ghost only on empty editor? (${formatScopeName(activeScope)}, current: ${currentValue ? "true" : "false"})`,
					["true", "false"],
				);
				if (!selected) continue;
				await persistence.writeValue(activeScope, action, selected === "true");
				ctx.ui.notify(`Updated ${action} in ${activeScope} override.`, "info");
				continue;
			}

			if (action === "suggestion.displayMode") {
				const currentValue = await getScopedEditorValue(
					"suggestion.displayMode",
					composition.config.suggestion.displayMode,
				);
				const selected = await ctx.ui.select(
					`Show suggestions via which surface? (${formatScopeName(activeScope)}, current: ${currentValue})`,
					[...suggestionDisplayOptions],
				);
				if (!selected || !isSuggestionDisplayMode(selected)) continue;
				await persistence.writeValue(activeScope, action, selected);
				ctx.ui.notify(
					usesGhostEditor(selected)
						? "Suggestions will use the inline ghost editor."
						: "Suggestions will be shown in the widget, leaving the default editor untouched.",
					"info",
				);
				continue;
			}

			if (action === "suggestion.ghostAcceptKeys") {
				const currentValue = await getScopedEditorValue(
					"suggestion.ghostAcceptKeys",
					composition.config.suggestion.ghostAcceptKeys,
				);
				const selected = await ctx.ui.select(
					`Ghost accept keys (${formatScopeName(activeScope)}, current: ${formatGhostAcceptKeys(currentValue)})`,
					["Space", "Right", "Space + Right"],
				);
				if (!selected) continue;
				const next = selected === "Space"
					? ["space"]
					: selected === "Right"
						? ["right"]
						: ["space", "right"];
				await persistence.writeValue(activeScope, action, next);
				ctx.ui.notify(`Updated ${action} in ${activeScope} override.`, "info");
				continue;
			}

			if (action === "suggestion.showPanelStatus") {
				const currentValue = await getScopedEditorValue(
					"suggestion.showPanelStatus",
					composition.config.suggestion.showPanelStatus,
				);
				const selected = await ctx.ui.select(
					`Show suggestion status in panel? (${formatScopeName(activeScope)}, current: ${currentValue ? "true" : "false"})`,
					["true", "false"],
				);
				if (!selected) continue;
				await persistence.writeValue(activeScope, action, selected === "true");
				ctx.ui.notify(`Updated ${action} in ${activeScope} override.`, "info");
				continue;
			}

			if (action === "suggestion.showUsageInPanel") {
				const currentValue = await getScopedEditorValue(
					"suggestion.showUsageInPanel",
					composition.config.suggestion.showUsageInPanel,
				);
				const selected = await ctx.ui.select(
					`Show suggester usage in panel? (${formatScopeName(activeScope)}, current: ${currentValue ? "true" : "false"})`,
					["true", "false"],
				);
				if (!selected) continue;
				await persistence.writeValue(activeScope, action, selected === "true");
				ctx.ui.notify(`Updated ${action} in ${activeScope} override.`, "info");
				continue;
			}

			if (action === "suggestion.fastPathContinueOnError") {
				const currentValue = await getScopedEditorValue(
					"suggestion.fastPathContinueOnError",
					composition.config.suggestion.fastPathContinueOnError,
				);
				const selected = await ctx.ui.select(
					`Fast-path continue on error? (${formatScopeName(activeScope)}, current: ${currentValue ? "true" : "false"})`,
					["true", "false"],
				);
				if (!selected) continue;
				await persistence.writeValue(activeScope, action, selected === "true");
				ctx.ui.notify(`Updated ${action} in ${activeScope} override.`, "info");
				continue;
			}

			if (action === "reseed.enabled" || action === "reseed.checkOnSessionStart" || action === "reseed.checkAfterEveryTurn") {
				const currentValue = await getScopedEditorValue<boolean>(
					action,
					action === "reseed.enabled"
						? composition.config.reseed.enabled
						: action === "reseed.checkOnSessionStart"
							? composition.config.reseed.checkOnSessionStart
							: composition.config.reseed.checkAfterEveryTurn,
				);
				const selected = await ctx.ui.select(
					`${action}? (${formatScopeName(activeScope)}, current: ${currentValue ? "true" : "false"})`,
					["true", "false"],
				);
				if (!selected) continue;
				await persistence.writeValue(activeScope, action, selected === "true");
				ctx.ui.notify(`Updated ${action} in ${activeScope} override.`, "info");
				continue;
			}

			if (action === "reseed.turnCheckInterval") {
				const next = await promptNonNegativeInt(
					`Turn staleness check interval (${formatScopeName(activeScope)}; 0 disables turn checks)`,
					await getScopedEditorValue("reseed.turnCheckInterval", composition.config.reseed.turnCheckInterval),
				);
				if (next === undefined) continue;
				await persistence.writeValue(activeScope, action, next);
				ctx.ui.notify(`Updated ${action} in ${activeScope} override.`, "info");
				continue;
			}

			if (action === "suggestion.maxSuggestionChars") {
				const next = await promptPositiveInt(
					`Max suggestion chars (${formatScopeName(activeScope)})`,
					await getScopedEditorValue("suggestion.maxSuggestionChars", composition.config.suggestion.maxSuggestionChars),
				);
				if (next === undefined) continue;
				await persistence.writeValue(activeScope, action, next);
				ctx.ui.notify(`Updated ${action} in ${activeScope} override.`, "info");
				continue;
			}

			if (action === "suggestion.maxRecentUserPrompts") {
				const next = await promptPositiveInt(
					`Recent user prompts (${formatScopeName(activeScope)})`,
					await getScopedEditorValue("suggestion.maxRecentUserPrompts", composition.config.suggestion.maxRecentUserPrompts),
				);
				if (next === undefined) continue;
				await persistence.writeValue(activeScope, action, next);
				ctx.ui.notify(`Updated ${action} in ${activeScope} override.`, "info");
				continue;
			}

			if (action === "suggestion.maxRecentUserPromptChars") {
				const next = await promptPositiveInt(
					`Recent user prompt chars (${formatScopeName(activeScope)})`,
					await getScopedEditorValue(
						"suggestion.maxRecentUserPromptChars",
						composition.config.suggestion.maxRecentUserPromptChars,
					),
				);
				if (next === undefined) continue;
				await persistence.writeValue(activeScope, action, next);
				ctx.ui.notify(`Updated ${action} in ${activeScope} override.`, "info");
				continue;
			}

			if (action === "suggestion.transcriptMaxContextPercent") {
				const next = await promptPercent(
					`Transcript max context % (${formatScopeName(activeScope)})`,
					await getScopedEditorValue(
						"suggestion.transcriptMaxContextPercent",
						composition.config.suggestion.transcriptMaxContextPercent,
					),
					{ allowZero: false },
				);
				if (next === undefined) continue;
				await persistence.writeValue(activeScope, action, next);
				ctx.ui.notify(`Updated ${action} in ${activeScope} override.`, "info");
				continue;
			}

			if (action === "suggestion.transcriptMaxMessages") {
				const next = await promptPositiveInt(
					`Transcript max messages (${formatScopeName(activeScope)})`,
					await getScopedEditorValue(
						"suggestion.transcriptMaxMessages",
						composition.config.suggestion.transcriptMaxMessages,
					),
				);
				if (next === undefined) continue;
				await persistence.writeValue(activeScope, action, next);
				ctx.ui.notify(`Updated ${action} in ${activeScope} override.`, "info");
				continue;
			}

			if (action === "suggestion.transcriptMaxChars") {
				const next = await promptPositiveInt(
					`Transcript max chars (${formatScopeName(activeScope)})`,
					await getScopedEditorValue(
						"suggestion.transcriptMaxChars",
						composition.config.suggestion.transcriptMaxChars,
					),
				);
				if (next === undefined) continue;
				await persistence.writeValue(activeScope, action, next);
				ctx.ui.notify(`Updated ${action} in ${activeScope} override.`, "info");
				continue;
			}

			if (action === "suggestion.transcriptRolloutPercent") {
				const next = await promptPercent(
					`Transcript rollout % (${formatScopeName(activeScope)}; 0 disables transcript steering)`,
					await getScopedEditorValue(
						"suggestion.transcriptRolloutPercent",
						composition.config.suggestion.transcriptRolloutPercent,
					),
					{ allowZero: true },
				);
				if (next === undefined) continue;
				await persistence.writeValue(activeScope, action, next);
				ctx.ui.notify(`Updated ${action} in ${activeScope} override.`, "info");
				continue;
			}

			if (action === "steering.maxChangedExamples") {
				const next = await promptPositiveInt(
					`Changed examples in prompt (${formatScopeName(activeScope)})`,
					await getScopedEditorValue("steering.maxChangedExamples", composition.config.steering.maxChangedExamples),
				);
				if (next === undefined) continue;
				await persistence.writeValue(activeScope, action, next);
				ctx.ui.notify(`Updated ${action} in ${activeScope} override.`, "info");
				continue;
			}

			if (action === "inference.seederModel") {
				const next = await promptModel(
					`Seeder model (${formatScopeName(activeScope)}; provider/model or session-default)`,
					await getScopedEditorValue("inference.seederModel", composition.config.inference.seederModel),
				);
				if (next === undefined) continue;
				await persistence.writeValue(activeScope, action, next);
				ctx.ui.notify(`Updated ${action} in ${activeScope} override.`, "info");
				continue;
			}

			if (action === "inference.suggesterModel") {
				const next = await promptModel(
					`Suggester model (${formatScopeName(activeScope)}; provider/model or session-default)`,
					await getScopedEditorValue("inference.suggesterModel", composition.config.inference.suggesterModel),
				);
				if (next === undefined) continue;
				await persistence.writeValue(activeScope, action, next);
				ctx.ui.notify(`Updated ${action} in ${activeScope} override.`, "info");
				continue;
			}

			if (action === "inference.seederThinking" || action === "inference.suggesterThinking") {
				const current = await getScopedEditorValue(
					action,
					action === "inference.seederThinking"
						? composition.config.inference.seederThinking
						: composition.config.inference.suggesterThinking,
				);
				const selected = await ctx.ui.select(`${action} (${formatScopeName(activeScope)}, current: ${current})`, thinkingOptions);
				if (!selected) continue;
				await persistence.writeValue(activeScope, action, selected);
				ctx.ui.notify(`Updated ${action} in ${activeScope} override.`, "info");
				continue;
			}
		} catch (error) {
			ctx.ui.notify((error as Error).message, "error");
		}
	}
}
