import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PromptSuggesterConfig } from "../../config/types.js";
import type { SuggesterVariantStore } from "./suggester-variant-store.js";
import { getConfiguredModelDisplay } from "./display.js";
import type { RuntimeRef } from "./runtime-ref.js";

export interface WidgetLogStatus {
	level: "debug" | "info" | "warn" | "error";
	text: string;
}

export interface UiContextLike {
	getContext(): ExtensionContext | undefined;
	getEpoch(): number;
	getSuggestion(): string | undefined;
	setSuggestion(text: string | undefined): void;
	getPanelSuggestionStatus(): string | undefined;
	setPanelSuggestionStatus(text: string | undefined): void;
	getPanelUsageStatus(): string | undefined;
	setPanelUsageStatus(text: string | undefined): void;
	getPanelLogStatus(): WidgetLogStatus | undefined;
	setPanelLogStatus(status: WidgetLogStatus | undefined): void;
	getSuggesterModelDisplay(): string | undefined;
	suggestionDisplayMode: PromptSuggesterConfig["suggestion"]["displayMode"];
	ghostAcceptKeys: PromptSuggesterConfig["suggestion"]["ghostAcceptKeys"];
	prefillOnlyWhenEditorEmpty: boolean;
	showUsageInPanel: boolean;
	showPanelStatus: boolean;
}

export function createUiContext(params: {
	runtimeRef: RuntimeRef;
	config: PromptSuggesterConfig;
	variantStore?: SuggesterVariantStore;
	getSessionThinkingLevel: () => string;
}): UiContextLike {
	const { runtimeRef, config, variantStore, getSessionThinkingLevel } = params;
	return {
		getContext: () => runtimeRef.getContext(),
		getEpoch: () => runtimeRef.getEpoch(),
		getSuggestion: () => runtimeRef.getSuggestion(),
		setSuggestion: (text) => runtimeRef.setSuggestion(text),
		getPanelSuggestionStatus: () => runtimeRef.getPanelSuggestionStatus(),
		setPanelSuggestionStatus: (text) => runtimeRef.setPanelSuggestionStatus(text),
		getPanelUsageStatus: () => runtimeRef.getPanelUsageStatus(),
		setPanelUsageStatus: (text) => runtimeRef.setPanelUsageStatus(text),
		getPanelLogStatus: () => runtimeRef.getPanelLogStatus(),
		setPanelLogStatus: (status) => runtimeRef.setPanelLogStatus(status),
		getSuggesterModelDisplay: () => {
			const effectiveConfig = variantStore?.getEffectiveConfig(config) ?? config;
			return getConfiguredModelDisplay({
				ctx: runtimeRef.getContext(),
				configuredModel: effectiveConfig.inference.suggesterModel,
				configuredThinking: effectiveConfig.inference.suggesterThinking,
				getSessionThinkingLevel,
			});
		},
		get suggestionDisplayMode() {
			return config.suggestion.displayMode;
		},
		get ghostAcceptKeys() {
			return config.suggestion.ghostAcceptKeys;
		},
		get prefillOnlyWhenEditorEmpty() {
			return config.suggestion.prefillOnlyWhenEditorEmpty;
		},
		get showUsageInPanel() {
			return config.suggestion.showUsageInPanel;
		},
		get showPanelStatus() {
			return config.suggestion.showPanelStatus;
		},
	};
}
