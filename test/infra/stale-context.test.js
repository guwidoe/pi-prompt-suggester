import test from "node:test";
import assert from "node:assert/strict";
import { ConsoleLogger } from "../../dist/infra/logging/console-logger.js";
import { refreshSuggesterUi } from "../../dist/infra/pi/ui-adapter.js";

function createStaleContext() {
	return {
		get hasUI() {
			throw new Error("This extension ctx is stale after session replacement or reload.");
		},
	};
}

function createStaleUiContext() {
	return {
		hasUI: true,
		ui: {
			theme: { fg: (_color, text) => text },
			setStatus: () => {
				throw new Error("This extension ctx is stale after session replacement or reload.");
			},
			setWidget: () => {
				throw new Error("This extension ctx is stale after session replacement or reload.");
			},
		},
	};
}

function createUiRuntime(ctx) {
	return {
		getContext: () => ctx,
		suggestionDisplayMode: "panel",
		showPanelStatus: true,
		showUsageInPanel: true,
		getSuggestion: () => undefined,
		getPanelSuggestionStatus: () => undefined,
		getPanelUsageStatus: () => undefined,
		getPanelLogStatus: () => undefined,
	};
}

test("refreshSuggesterUi ignores stale Pi contexts during session teardown", () => {
	assert.doesNotThrow(
		() => refreshSuggesterUi(createUiRuntime(createStaleContext())),
		/stale after session replacement/,
	);
});

test("refreshSuggesterUi ignores stale Pi UI writes during session teardown", () => {
	assert.doesNotThrow(
		() => refreshSuggesterUi(createUiRuntime(createStaleUiContext())),
		/stale after session replacement/,
	);
});

test("ConsoleLogger ignores stale widget status updates during session teardown", () => {
	const logger = new ConsoleLogger("debug", {
		getContext: () => createStaleContext(),
		mirrorToConsoleWhenNoUi: false,
		setWidgetLogStatus: () => {
			throw new Error("This extension ctx is stale after session replacement or reload.");
		},
	});

	assert.doesNotThrow(
		() => logger.error("reseed.failed", { reason: "session-start" }),
		/stale after session replacement/,
	);
});

test("ConsoleLogger ignores stale footer status writes during session teardown", () => {
	const logger = new ConsoleLogger("debug", {
		getContext: () => createStaleUiContext(),
		mirrorToConsoleWhenNoUi: false,
	});

	assert.doesNotThrow(
		() => logger.error("reseed.failed", { reason: "session-start" }),
		/stale after session replacement/,
	);
});
