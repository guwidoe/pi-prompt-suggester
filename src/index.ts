import type { ExtensionAPI, ExtensionContext, InputEvent } from "@earendil-works/pi-coding-agent";
import { createAppComposition, type AppComposition } from "./composition/root.js";
import { buildLatestHistoricalTurnContext } from "./app/services/conversation-signals.js";
import { PiExtensionAdapter } from "./infra/pi/extension-adapter.js";
import { GhostSuggestionEditor } from "./infra/pi/ghost-suggestion-editor.js";
import { getGhostEditorSyncAction, type GhostEditorInstallState } from "./infra/pi/ghost-editor-installation.js";
import {
	handleConfigCommand,
	handleInstructionCommand,
	handleModelCommand,
	handleSeedTraceCommand,
	handleSettingsUiCommand,
	handleThinkingCommand,
	handleVariantCommand,
	handleAbCommand,
	renderStatus,
} from "./infra/pi/command-handlers.js";
import { acceptWidgetSuggestion, refreshSuggesterUi } from "./infra/pi/ui-adapter.js";
import { createUiContext, type UiContextLike } from "./infra/pi/ui-context.js";

export default function suggester(pi: ExtensionAPI) {
	let compositionPromise: Promise<AppComposition> | undefined;
	let ghostEditorInstallState: GhostEditorInstallState | undefined;

	function syncGhostEditorInstallation(ctx: ExtensionContext, composition: AppComposition): void {
		if (!ctx.hasUI) return;
		const sessionFile = ctx.sessionManager.getSessionFile() ?? null;
		switch (getGhostEditorSyncAction({
			state: ghostEditorInstallState,
			context: ctx,
			displayMode: composition.config.suggestion.displayMode,
			sessionFile,
		})) {
			case "noop":
				return;
			case "uninstall":
				ctx.ui.setEditorComponent(undefined);
				ghostEditorInstallState = undefined;
				return;
			case "install":
				break;
		}

		ctx.ui.setEditorComponent((tui, theme, kb) =>
			new GhostSuggestionEditor(
				tui,
				theme,
				kb,
				() => composition.runtimeRef.getSuggestion(),
				() => composition.runtimeRef.getSuggestionRevision(),
				composition.config.suggestion.ghostAcceptKeys,
				() => composition.runtimeRef.getEditorHistoryState(),
				(state) => composition.runtimeRef.setEditorHistoryState(state),
			),
		);
		ghostEditorInstallState = { context: ctx, sessionFile };
	}

	async function getComposition(): Promise<AppComposition> {
		if (!compositionPromise) {
			compositionPromise = createAppComposition(pi).catch((error) => {
				compositionPromise = undefined;
				throw error;
			});
		}
		return await compositionPromise;
	}

	async function setRuntimeContext(ctx: ExtensionContext): Promise<AppComposition> {
		const composition = await getComposition();
		composition.runtimeRef.setContext(ctx);
		return composition;
	}

	function getUiContext(composition: AppComposition): UiContextLike {
		return createUiContext({
			runtimeRef: composition.runtimeRef,
			config: composition.config,
			variantStore: composition.stores.variantStore,
			getSessionThinkingLevel: () => pi.getThinkingLevel(),
		});
	}

	function syncSuggestionUi(ctx: ExtensionContext, composition: AppComposition): void {
		if (!ctx.hasUI) return;
		syncGhostEditorInstallation(ctx, composition);
		refreshSuggesterUi(getUiContext(composition));
	}

	pi.registerShortcut("f2", {
		description: "Accept prompt suggestion",
		handler: async (ctx) => {
			const composition = await setRuntimeContext(ctx);
			const result = acceptWidgetSuggestion(getUiContext(composition));
			if (result === "mismatch") {
				ctx.ui.notify("Current editor text no longer matches the suggestion.", "warning");
			}
		},
	});

	const adapter = new PiExtensionAdapter(pi, {
		onSessionStart: async (ctx) => {
			const composition = await setRuntimeContext(ctx);
			const generationId = composition.runtimeRef.bumpEpoch();
			syncSuggestionUi(ctx, composition);
			await composition.orchestrators.sessionStart.handle();

			const sourceLeafId = ctx.sessionManager.getLeafId() ?? `turn-${Date.now()}`;
			if (composition.runtimeRef.getLastBootstrappedLeafId() === sourceLeafId) return;

			const state = await composition.stores.stateStore.load();
			if (state.lastSuggestion?.turnId === sourceLeafId) {
				composition.runtimeRef.markBootstrappedLeafId(sourceLeafId);
				return;
			}

			const branchEntries = ctx.sessionManager
				.getBranch()
				.filter((entry): entry is ReturnType<typeof ctx.sessionManager.getBranch>[number] & { type: "message" } =>
					entry.type === "message"
				);
			const historicalTurn = buildLatestHistoricalTurnContext({ branchEntries });
			if (!historicalTurn) return;

			composition.runtimeRef.markBootstrappedLeafId(sourceLeafId);
			composition.runtimeRef.setLastTurnContext(historicalTurn);
			await composition.orchestrators.agentEnd.handle(historicalTurn, generationId);
		},
		onSessionShutdown: async (ctx) => {
			const composition = await getComposition();
			composition.orchestrators.reseedRunner.cancelPending();
			composition.runtimeRef.clearContext(ctx);
		},
		onAgentEnd: async (turn, ctx) => {
			if (!turn) return;
			const composition = await setRuntimeContext(ctx);
			syncSuggestionUi(ctx, composition);
			composition.runtimeRef.setLastTurnContext(turn);
			const generationId = composition.runtimeRef.bumpEpoch();
			await composition.orchestrators.agentEnd.handle(turn, generationId);
		},
		onUserSubmit: async (event: InputEvent, ctx) => {
			const composition = await setRuntimeContext(ctx);
			syncSuggestionUi(ctx, composition);
			composition.runtimeRef.bumpEpoch();
			await composition.orchestrators.userSubmit.handle({
				turnId: ctx.sessionManager.getLeafId() ?? `input-${Date.now()}`,
				userPrompt: event.text,
				source: event.source,
			});
		},
		onReseedCommand: async (ctx) => {
			const composition = await setRuntimeContext(ctx);
			await composition.orchestrators.reseedRunner.trigger({
				reason: "manual",
				changedFiles: [],
			});
			ctx.ui.notify("suggester reseed queued", "info");
		},
		onStatusCommand: async (ctx) => {
			const composition = await setRuntimeContext(ctx);
			const [seed, state] = await Promise.all([
				composition.stores.seedStore.load(),
				composition.stores.stateStore.load(),
			]);
			const effectiveConfig = composition.stores.variantStore.getEffectiveConfig(composition.config);
			pi.sendMessage(
				{
					customType: "prompt-suggester-status",
					content: renderStatus(
						seed,
						state,
						effectiveConfig,
						ctx,
						composition.stores.variantStore.getActiveVariantName(),
					),
					display: true,
				},
				{ triggerTurn: false },
			);
		},
		onModelCommand: async (args, ctx) => {
			const composition = await setRuntimeContext(ctx);
			await handleModelCommand(args, ctx, composition);
			syncSuggestionUi(ctx, composition);
		},
		onThinkingCommand: async (args, ctx) => {
			const composition = await setRuntimeContext(ctx);
			await handleThinkingCommand(args, ctx, composition);
			syncSuggestionUi(ctx, composition);
		},
		onConfigCommand: async (args, ctx) => {
			const composition = await setRuntimeContext(ctx);
			await handleConfigCommand(args, ctx, composition);
			syncSuggestionUi(ctx, composition);
		},
		onInstructionCommand: async (args, ctx) => {
			const composition = await setRuntimeContext(ctx);
			await handleInstructionCommand(args, ctx, composition);
			syncSuggestionUi(ctx, composition);
		},
		onVariantCommand: async (args, ctx) => {
			const composition = await setRuntimeContext(ctx);
			await handleVariantCommand(args, ctx, composition);
			syncSuggestionUi(ctx, composition);
		},
		onAbCommand: async (args, ctx) => {
			const composition = await setRuntimeContext(ctx);
			await handleAbCommand(args, ctx, composition);
			syncSuggestionUi(ctx, composition);
		},
		onSettingsUiCommand: async (ctx) => {
			const composition = await setRuntimeContext(ctx);
			await handleSettingsUiCommand(ctx, composition);
			syncSuggestionUi(ctx, composition);
		},
		onSeedTraceCommand: async (args, ctx) => {
			const composition = await setRuntimeContext(ctx);
			await handleSeedTraceCommand(args, pi, composition);
			ctx.ui.notify("suggester seed trace sent to chat", "info");
		},
	});

	adapter.register();
}
