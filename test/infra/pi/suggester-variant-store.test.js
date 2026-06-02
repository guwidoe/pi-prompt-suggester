import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { SuggesterVariantStore } from "../../../dist/infra/pi/suggester-variant-store.js";

const baseConfig = {
	schemaVersion: 7,
	seed: { maxDiffChars: 3000 },
	reseed: { enabled: true, checkOnSessionStart: true, checkAfterEveryTurn: true, turnCheckInterval: 10 },
	suggestion: {
		noSuggestionToken: "[no suggestion]",
		customInstruction: "base",
		fastPathContinueOnError: true,
		displayMode: "ghost",
		maxAssistantTurnChars: 100000,
		maxRecentUserPrompts: 20,
		maxRecentUserPromptChars: 500,
		maxToolSignals: 8,
		maxToolSignalChars: 240,
		maxTouchedFiles: 8,
		maxUnresolvedQuestions: 6,
		maxAbortContextChars: 280,
		maxSuggestionChars: 200,
		prefillOnlyWhenEditorEmpty: true,
		strategy: "compact",
		transcriptMaxContextPercent: 70,
		transcriptMaxMessages: 120,
		transcriptMaxChars: 120000,
		transcriptRolloutPercent: 100,
	},
	steering: { historyWindow: 20, acceptedThreshold: 0.82, maxChangedExamples: 3 },
	logging: { level: "info" },
	inference: {
		seederModel: "session-default",
		suggesterModel: "session-default",
		seederThinking: "session-default",
		suggesterThinking: "session-default",
	},
};

test("variant store applies active variant overrides to effective config", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "pi-suggester-variants-"));
	const store = new SuggesterVariantStore(dir, path.join(dir, "storage"));
	await store.init();
	await store.createVariant("terse");
	await store.updateVariant("terse", {
		strategy: "transcript-steering",
		suggesterModel: "openai/gpt-5",
		suggesterThinking: "high",
		maxSuggestionChars: 42,
		maxRecentUserPrompts: 7,
		maxRecentUserPromptChars: 180,
		maxChangedExamples: 2,
		transcriptMaxContextPercent: 65,
		transcriptMaxMessages: 80,
		transcriptMaxChars: 80000,
		transcriptRolloutPercent: 50,
	});
	await store.setActiveVariant("terse");

	const effective = store.getEffectiveConfig(baseConfig);
	assert.equal(store.getActiveVariantName(), "terse");
	assert.equal(effective.suggestion.customInstruction, "base");
	assert.equal(effective.inference.suggesterModel, "openai/gpt-5");
	assert.equal(effective.inference.suggesterThinking, "high");
	assert.equal(effective.suggestion.strategy, "transcript-steering");
	assert.equal(effective.suggestion.maxSuggestionChars, 42);
	assert.equal(effective.suggestion.maxRecentUserPrompts, 7);
	assert.equal(effective.suggestion.maxRecentUserPromptChars, 180);
	assert.equal(effective.steering.maxChangedExamples, 2);
	assert.equal(effective.suggestion.transcriptMaxContextPercent, 65);
	assert.equal(effective.suggestion.transcriptMaxMessages, 80);
	assert.equal(effective.suggestion.transcriptMaxChars, 80000);
	assert.equal(effective.suggestion.transcriptRolloutPercent, 50);
	assert.equal(effective.inference.seederModel, "session-default");
});

test("variant store normalizes invalid files and preserves default variant", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "pi-suggester-variants-"));
	const storageDir = path.join(dir, "storage");
	await mkdir(storageDir, { recursive: true });
	await writeFile(
		path.join(storageDir, "variants.json"),
		JSON.stringify({
			activeVariant: "missing",
			variants: {
				"": { bad: true },
				custom: { maxSuggestionChars: -1, customInstruction: "legacy" },
			},
		}),
		"utf8",
	);
	const store = new SuggesterVariantStore(dir, storageDir);
	await store.init();
	assert.equal(store.getActiveVariantName(), "default");
	assert.deepEqual(store.listVariants().map((entry) => entry.name).sort(), ["custom", "default"]);
	assert.deepEqual(store.getVariant("custom"), {});
});

test("variant stats aggregate wins, ties, and both-bad outcomes", async () => {
	const dir = await mkdtemp(path.join(os.tmpdir(), "pi-suggester-variants-"));
	const store = new SuggesterVariantStore(dir, path.join(dir, "storage"));
	await store.init();
	await store.createVariant("a");
	await store.createVariant("b");
	await store.recordResult({
		at: "2026-03-13T12:00:00.000Z",
		turnId: "t1",
		variantA: "a",
		variantB: "b",
		suggestionA: "Yes.",
		suggestionB: "Proceed.",
		winner: "A",
	});
	await store.recordResult({
		at: "2026-03-13T12:01:00.000Z",
		turnId: "t2",
		variantA: "a",
		variantB: "b",
		suggestionA: "Yes.",
		suggestionB: "Proceed.",
		winner: "tie",
	});
	await store.recordResult({
		at: "2026-03-13T12:02:00.000Z",
		turnId: "t3",
		variantA: "a",
		variantB: "b",
		suggestionA: "Yes.",
		suggestionB: "Proceed.",
		winner: "both_bad",
	});

	const stats = await store.getStats();
	assert.deepEqual(stats.a, { compared: 3, wins: 1, losses: 0, ties: 1, bothBad: 1 });
	assert.deepEqual(stats.b, { compared: 3, wins: 0, losses: 1, ties: 1, bothBad: 1 });
});
