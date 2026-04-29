import test from "node:test";
import assert from "node:assert/strict";
import { ReseedRunner } from "../../dist/app/orchestrators/reseed-runner.js";
import { InMemoryTaskQueue } from "../../dist/infra/queue/in-memory-task-queue.js";

function createConfig() {
	return {
		seed: { maxDiffChars: 3000 },
		reseed: { enabled: true },
		inference: {
			seederModel: "session-default",
			seederThinking: "session-default",
		},
	};
}

function createSeedDraft() {
	return {
		projectIntentSummary: "Project intent.",
		objectivesSummary: "Objectives.",
		constraintsSummary: "Constraints.",
		principlesGuidelinesSummary: "Principles.",
		implementationStatusSummary: "Status.",
		topObjectives: ["Keep reseeds reliable."],
		constraints: [],
		keyFiles: [{ path: "package.json", whyImportant: "Package metadata exists in tests.", category: "other" }],
		categoryFindings: {
			vision: { found: false, rationale: "not relevant", files: [] },
			architecture: { found: false, rationale: "not relevant", files: [] },
			principles_guidelines: { found: false, rationale: "not relevant", files: [] },
		},
		openQuestions: [],
	};
}

function createDeferred() {
	let resolve;
	let reject;
	const promise = new Promise((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

async function waitFor(predicate, message) {
	const startedAt = Date.now();
	while (!predicate()) {
		if (Date.now() - startedAt > 1000) {
			throw new Error(message);
		}
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
}

function createRunner(overrides = {}) {
	const calls = [];
	const savedSeeds = [];
	const firstGenerate = createDeferred();
	const runner = new ReseedRunner({
		config: createConfig(),
		seedStore: {
			async load() { return undefined; },
			async save(seed) { savedSeeds.push(seed); },
		},
		stateStore: {
			async recordUsage() {},
		},
		modelClient: {
			async generateSeed(args) {
				calls.push(args.reseedTrigger);
				if (calls.length === 1) return await firstGenerate.promise;
				return { seed: createSeedDraft(), usage: undefined };
			},
		},
		taskQueue: new InMemoryTaskQueue(),
		logger: {
			debug() {},
			info() {},
			warn() {},
			error() {},
		},
		fileHash: { async hashFile() { return "hash"; } },
		vcs: { async getHeadCommit() { return "head"; } },
		cwd: process.cwd(),
		...overrides,
	});
	return { runner, calls, savedSeeds, firstGenerate };
}

test("ReseedRunner runs a new trigger queued while a cancelled reseed is still in flight", async () => {
	const { runner, calls, savedSeeds, firstGenerate } = createRunner();

	await runner.trigger({ reason: "manual", changedFiles: ["first"] });
	await waitFor(() => calls.length === 1, "first reseed did not start");

	runner.cancelPending();
	await runner.trigger({ reason: "manual", changedFiles: ["second"] });
	firstGenerate.resolve({ seed: createSeedDraft(), usage: undefined });

	await waitFor(() => calls.length === 2, "second reseed did not start after cancelled reseed finished");
	await waitFor(() => !runner.isRunning(), "reseed runner did not settle");

	assert.deepEqual(calls.map((trigger) => trigger.changedFiles), [["first"], ["second"]]);
	assert.equal(savedSeeds.length, 1);
	assert.equal(savedSeeds[0].lastChangedFiles[0], "second");
});
