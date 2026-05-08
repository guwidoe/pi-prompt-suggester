import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { SuggestionSink } from "../../app/orchestrators/turn-end.js";
import type { SuggestionUsageStats } from "../../domain/state.js";
import { formatTokens } from "./display.js";
import { getSuggestionStatusText, usesGhostEditor, usesWidgetSuggestion } from "./suggestion-display-mode.js";
import { isStaleExtensionContextError } from "./stale-context.js";
import type { UiContextLike } from "./ui-context.js";

export const WIDGET_ACCEPT_SHORTCUT_LABEL = "F2 accepts";

function formatUsage(
	usage: { suggester: SuggestionUsageStats; seeder: SuggestionUsageStats },
	suggesterModelDisplay: string | undefined,
): string {
	const combinedInput = usage.suggester.inputTokens + usage.seeder.inputTokens;
	const combinedOutput = usage.suggester.outputTokens + usage.seeder.outputTokens;
	const combinedCacheRead = usage.suggester.cacheReadTokens + usage.seeder.cacheReadTokens;
	const combinedCost = usage.suggester.costTotal + usage.seeder.costTotal;
	const suffix = suggesterModelDisplay ? `, suggester: ${suggesterModelDisplay}` : "";
	return `suggester usage: ↑${formatTokens(combinedInput)} ↓${formatTokens(combinedOutput)} R${formatTokens(combinedCacheRead)} $${combinedCost.toFixed(3)} (${usage.suggester.calls} sugg, ${usage.seeder.calls} seed)${suffix}`;
}

function formatPanelLog(
	ctx: ExtensionContext,
	status: { level: "debug" | "info" | "warn" | "error"; text: string },
): string {
	const theme = ctx.ui.theme;
	if (status.level === "error") return theme.fg("error", status.text);
	if (status.level === "warn") return theme.fg("warning", status.text);
	if (status.level === "debug") return theme.fg("dim", status.text);
	return theme.fg("muted", status.text);
}

export function refreshSuggesterUi(runtime: UiContextLike): void {
	try {
		const ctx = runtime.getContext();
		if (!ctx?.hasUI) return;
		refreshSuggesterUiForContext(ctx, runtime);
	} catch (error) {
		if (isStaleExtensionContextError(error)) return;
		throw error;
	}
}

function refreshSuggesterUiForContext(ctx: ExtensionContext, runtime: UiContextLike): void {
	ctx.ui.setStatus("suggester", undefined);
	ctx.ui.setStatus("suggester-events", undefined);
	ctx.ui.setStatus("suggester-usage", undefined);

	const widgetMode = usesWidgetSuggestion(runtime.suggestionDisplayMode);
	const suggestionText = widgetMode ? runtime.getSuggestion() : undefined;
	const suggestionStatus = runtime.showPanelStatus && widgetMode ? runtime.getPanelSuggestionStatus() : undefined;
	const suggestionHint = suggestionText ? themeHintText(widgetMode) : undefined;
	const usageStatus = runtime.showUsageInPanel ? runtime.getPanelUsageStatus() : undefined;
	const logStatus = runtime.getPanelLogStatus();
	if (!suggestionText && !suggestionStatus && !logStatus && !usageStatus) {
		ctx.ui.setWidget("suggester-panel", undefined);
		return;
	}

	ctx.ui.setWidget(
		"suggester-panel",
		(_tui, theme) => ({
			invalidate() {},
			render(width: number): string[] {
				const lines: string[] = [];
				if (suggestionText) {
					const sourceLines = suggestionText.split("\n");
					for (let index = 0; index < sourceLines.length; index += 1) {
						const prefix = index === 0 ? "✦ " : "  ";
						const wrapped = wrapTextWithAnsi(theme.fg("accent", `${prefix}${sourceLines[index] ?? ""}`), Math.max(10, width));
						for (const wrappedLine of wrapped.length > 0 ? wrapped : [theme.fg("accent", prefix.trimEnd())]) {
							const truncated = truncateToWidth(wrappedLine, Math.max(10, width), "", true);
							const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
							lines.push(truncated + pad);
						}
					}
				}
				const parts: string[] = [];
				if (suggestionStatus) parts.push(theme.fg("accent", suggestionStatus));
				if (suggestionHint) parts.push(theme.fg("muted", suggestionHint));
				if (logStatus) parts.push(formatPanelLog(ctx, logStatus));
				const line = parts.join(" · ");
				if (line) {
					const truncated = truncateToWidth(line, Math.max(10, width), "", true);
					const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
					lines.push(truncated + pad);
				}
				if (usageStatus) {
					const truncated = truncateToWidth(theme.fg("dim", usageStatus), Math.max(10, width), "", true);
					const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
					lines.push(truncated + pad);
				}
				return lines.length > 0 ? lines : [" ".repeat(Math.max(1, width))];
			},
		}),
		{ placement: "belowEditor" },
	);
}

function themeHintText(widgetMode: boolean): string | undefined {
	return widgetMode ? WIDGET_ACCEPT_SHORTCUT_LABEL : undefined;
}

export function acceptWidgetSuggestion(runtime: UiContextLike): "accepted" | "missing-suggestion" | "mismatch" | "unavailable" {
	const ctx = runtime.getContext();
	if (!ctx?.hasUI || !usesWidgetSuggestion(runtime.suggestionDisplayMode)) return "unavailable";
	const suggestion = runtime.getSuggestion();
	if (!suggestion) return "missing-suggestion";
	const editorText = ctx.ui.getEditorText();
	if (editorText.length > 0 && !suggestion.startsWith(editorText)) return "mismatch";
	ctx.ui.setEditorText(suggestion);
	runtime.setSuggestion(undefined);
	runtime.setPanelSuggestionStatus(undefined);
	refreshSuggesterUi(runtime);
	return "accepted";
}

export class PiSuggestionSink implements SuggestionSink {
	public constructor(private readonly runtime: UiContextLike) {}

	public async showSuggestion(text: string, options?: { restore?: boolean; generationId?: number }): Promise<void> {
		if (options?.generationId !== undefined && options.generationId !== this.runtime.getEpoch()) return;
		const ctx = this.runtime.getContext();
		if (!ctx?.hasUI) return;

		const editorText = ctx.ui.getEditorText();
		const trimmedEditorText = editorText.trim();
		const isMultilineSuggestion = text.includes("\n");
		const prefixCompatible = !editorText.includes("\n") && text.startsWith(editorText);
		const canGhostInEditor = usesGhostEditor(this.runtime.suggestionDisplayMode) && (isMultilineSuggestion
			? trimmedEditorText.length === 0
			: this.runtime.prefillOnlyWhenEditorEmpty
				? trimmedEditorText.length === 0
				: trimmedEditorText.length === 0 || prefixCompatible);

		this.runtime.setSuggestion(text);
		this.runtime.setPanelSuggestionStatus(getSuggestionStatusText({
			displayMode: this.runtime.suggestionDisplayMode,
			restored: options?.restore,
			canGhostInEditor,
			ghostAcceptKeys: this.runtime.ghostAcceptKeys,
		}));
		refreshSuggesterUi(this.runtime);
	}

	public async clearSuggestion(options?: { generationId?: number }): Promise<void> {
		if (options?.generationId !== undefined && options.generationId !== this.runtime.getEpoch()) return;
		this.runtime.setSuggestion(undefined);
		this.runtime.setPanelSuggestionStatus(undefined);
		refreshSuggesterUi(this.runtime);
	}

	public async setUsage(usage: { suggester: SuggestionUsageStats; seeder: SuggestionUsageStats }): Promise<void> {
		const ctx = this.runtime.getContext();
		if (!ctx?.hasUI) return;
		if (usage.suggester.calls <= 0 && usage.seeder.calls <= 0) {
			this.runtime.setPanelUsageStatus(undefined);
			refreshSuggesterUi(this.runtime);
			return;
		}
		this.runtime.setPanelUsageStatus(formatUsage(usage, this.runtime.getSuggesterModelDisplay()));
		refreshSuggesterUi(this.runtime);
	}
}
