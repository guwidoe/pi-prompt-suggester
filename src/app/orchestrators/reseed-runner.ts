import { promises as fs } from "node:fs";
import path from "node:path";
import type { PromptSuggesterConfig } from "../../config/types.js";
import { toInvocationThinkingLevel } from "../../config/inference.js";
import {
	CURRENT_GENERATOR_VERSION,
	CURRENT_SEED_VERSION,
	SEEDER_PROMPT_VERSION,
	SUGGESTION_PROMPT_VERSION,
	type ReseedTrigger,
	type SeedArtifact,
	type SeedDraft,
} from "../../domain/seed.js";
import type { FileHash } from "../ports/file-hash.js";
import type { Logger } from "../ports/logger.js";
import type { SeedStore } from "../ports/seed-store.js";
import type { StateStore } from "../ports/state-store.js";
import type { ModelClient } from "../ports/model-client.js";
import type { TaskQueue } from "../ports/task-queue.js";
import type { VcsClient } from "../ports/vcs-client.js";
import { computeConfigFingerprint } from "../services/seed-metadata.js";
import type { SuggestionUsage } from "../../domain/suggestion.js";

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

function createRunId(): string {
	return `seed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export interface ReseedRunnerDeps {
	config: PromptSuggesterConfig;
	seedStore: SeedStore;
	stateStore: StateStore;
	modelClient: ModelClient;
	taskQueue: TaskQueue;
	logger: Logger;
	fileHash: FileHash;
	vcs: VcsClient;
	cwd?: string;
}

export class ReseedRunner {
	private running = false;
	private runningEpoch: number | null = null;
	private pendingTrigger: { epoch: number; trigger: ReseedTrigger } | null = null;
	private consecutiveFailureCount = 0;
	private cancellationEpoch = 0;
	private readonly cwd: string;
	private readonly configFingerprint: string;

	public constructor(private readonly deps: ReseedRunnerDeps) {
		this.cwd = deps.cwd ?? process.cwd();
		this.configFingerprint = computeConfigFingerprint(deps.config);
	}

	public cancelPending(): void {
		this.cancellationEpoch += 1;
		this.pendingTrigger = null;
	}

	private isCancelled(epoch: number): boolean {
		return epoch !== this.cancellationEpoch;
	}

	public async trigger(trigger: ReseedTrigger): Promise<void> {
		if (!this.deps.config.reseed.enabled) return;
		const epoch = this.cancellationEpoch;
		if (this.running && this.runningEpoch === epoch) {
			const pendingTrigger = this.pendingTrigger?.epoch === epoch ? this.pendingTrigger.trigger : null;
			this.pendingTrigger = {
				epoch,
				trigger: this.mergeTriggers(pendingTrigger, trigger),
			};
			this.deps.logger.info("reseed.pending", { reason: trigger.reason, changedFiles: trigger.changedFiles });
			return;
		}

		this.running = true;
		this.runningEpoch = epoch;
		void this.deps.taskQueue
			.enqueue("suggester:reseed", async () => {
				await this.processTriggerLoop(trigger, epoch);
			})
			.catch((error) => {
				this.deps.logger.error("reseed.queue.failed", {
					error: (error as Error).message,
				});
			})
			.finally(() => {
				if (this.runningEpoch === epoch) {
					this.running = false;
					this.runningEpoch = null;
				}
			});
	}

	private async processTriggerLoop(initialTrigger: ReseedTrigger, epoch: number): Promise<void> {
		let nextTrigger: ReseedTrigger | null = initialTrigger;
		while (nextTrigger && !this.isCancelled(epoch)) {
			const current = nextTrigger;
			nextTrigger = null;
			const runId = createRunId();
			this.deps.logger.info("reseed.started", {
				runId,
				reason: current.reason,
				changedFiles: current.changedFiles,
			});

			try {
				const previousSeed = await this.deps.seedStore.load();
				if (this.isCancelled(epoch)) return;
				const seedResult = await this.deps.modelClient.generateSeed({
					reseedTrigger: current,
					previousSeed,
					settings: {
						modelRef:
							this.deps.config.inference.seederModel === "session-default"
								? undefined
								: this.deps.config.inference.seederModel,
						thinkingLevel: toInvocationThinkingLevel(this.deps.config.inference.seederThinking),
					},
					runId,
				});
				if (this.isCancelled(epoch)) return;
				await this.recordSeederUsage(seedResult.usage);
				if (this.isCancelled(epoch)) return;
				const seed = await this.finalizeSeed(seedResult.seed, current);
				await this.deps.seedStore.save(seed);
				this.consecutiveFailureCount = 0;
				this.deps.logger.info("reseed.completed", {
					runId,
					reason: current.reason,
					keyFiles: seed.keyFiles.map((file) => file.path),
					categoryFindings: seed.categoryFindings,
					tokens: seedResult.usage?.totalTokens,
					cost: seedResult.usage?.costTotal,
				});
			} catch (error) {
				if (this.isCancelled(epoch)) return;
				const usage = this.extractUsageFromError(error);
				if (usage) {
					await this.recordSeederUsage(usage);
				}
				this.consecutiveFailureCount += 1;
				const meta = {
					runId,
					reason: current.reason,
					error: (error as Error).message,
					tokens: usage?.totalTokens,
					cost: usage?.costTotal,
					consecutiveFailures: this.consecutiveFailureCount,
				};
				if (this.consecutiveFailureCount >= 3) {
					this.deps.logger.error("reseed.failed", meta);
				} else {
					this.deps.logger.debug("reseed.failed", meta);
				}
			}

			if (!this.isCancelled(epoch) && this.pendingTrigger?.epoch === epoch) {
				nextTrigger = this.pendingTrigger.trigger;
				this.pendingTrigger = null;
			}
		}
	}

	private async recordSeederUsage(usage: SuggestionUsage | undefined): Promise<void> {
		if (!usage) return;
		await this.deps.stateStore.recordUsage("seeder", usage);
	}

	private extractUsageFromError(error: unknown): SuggestionUsage | undefined {
		if (!error || typeof error !== "object") return undefined;
		const usage = (error as { usage?: SuggestionUsage }).usage;
		if (!usage) return undefined;
		if (
			typeof usage.inputTokens !== "number" ||
			typeof usage.outputTokens !== "number" ||
			typeof usage.cacheReadTokens !== "number" ||
			typeof usage.cacheWriteTokens !== "number" ||
			typeof usage.totalTokens !== "number" ||
			typeof usage.costTotal !== "number"
		) {
			return undefined;
		}
		return usage;
	}

	public isRunning(): boolean {
		return this.running;
	}

	private async finalizeSeed(
		seedDraft: SeedDraft,
		trigger: ReseedTrigger,
	): Promise<SeedArtifact> {
		const headCommit = await this.deps.vcs.getHeadCommit();
		const keyFiles = await this.resolveKeyFiles(seedDraft.keyFiles);
		return {
			seedVersion: CURRENT_SEED_VERSION,
			generatedAt: new Date().toISOString(),
			sourceCommit: headCommit ?? undefined,
			generatorVersion: CURRENT_GENERATOR_VERSION,
			seederPromptVersion: SEEDER_PROMPT_VERSION,
			suggestionPromptVersion: SUGGESTION_PROMPT_VERSION,
			configFingerprint: this.configFingerprint,
			modelId: undefined,
			projectIntentSummary: seedDraft.projectIntentSummary,
			objectivesSummary: seedDraft.objectivesSummary,
			constraintsSummary: seedDraft.constraintsSummary,
			principlesGuidelinesSummary: seedDraft.principlesGuidelinesSummary,
			implementationStatusSummary: seedDraft.implementationStatusSummary,
			topObjectives: seedDraft.topObjectives,
			constraints: seedDraft.constraints,
			keyFiles,
			categoryFindings: seedDraft.categoryFindings,
			openQuestions: seedDraft.openQuestions,
			reseedNotes: seedDraft.reseedNotes,
			lastReseedReason: trigger.reason,
			lastChangedFiles: trigger.changedFiles,
		};
	}

	private async resolveKeyFiles(
		candidateKeyFiles: Array<{ path: string; whyImportant: string; category: SeedArtifact["keyFiles"][number]["category"] }>,
	): Promise<SeedArtifact["keyFiles"]> {
		const normalizeToRepoRelative = (inputPath: string): string | undefined => {
			const trimmed = inputPath.trim();
			if (!trimmed) return undefined;
			const absolute = path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(this.cwd, trimmed);
			if (absolute !== this.cwd && !absolute.startsWith(`${this.cwd}${path.sep}`)) return undefined;
			const relative = path.relative(this.cwd, absolute);
			if (!relative || relative === ".") return undefined;
			if (relative.startsWith(`..${path.sep}`) || relative === "..") return undefined;
			return path.normalize(relative);
		};

		const uniqueCandidates = Array.from(
			new Map(
				candidateKeyFiles
					.map((file) => {
						const normalizedPath = normalizeToRepoRelative(file.path);
						if (!normalizedPath) return undefined;
						return {
							path: normalizedPath,
							whyImportant: file.whyImportant.trim() || "High-signal repository file",
							category: file.category,
						};
					})
					.filter((file): file is { path: string; whyImportant: string; category: SeedArtifact["keyFiles"][number]["category"] } => Boolean(file))
					.map((file) => [file.path, file]),
			).values(),
		);

		const chosen = uniqueCandidates.slice(0, 32);
		if (chosen.length === 0) {
			throw new Error("Seeder returned no keyFiles. Agentic seeding requires explicit key file selection.");
		}

		const hashed: SeedArtifact["keyFiles"] = [];
		for (const file of chosen) {
			const absolute = path.resolve(this.cwd, file.path);
			if (!(await fileExists(absolute))) continue;
			hashed.push({
				path: file.path,
				hash: await this.deps.fileHash.hashFile(absolute),
				whyImportant: file.whyImportant,
				category: file.category,
			});
		}
		if (hashed.length === 0) {
			throw new Error("Seeder returned keyFiles, but none could be resolved on disk.");
		}
		return hashed;
	}

	private mergeTriggers(left: ReseedTrigger | null, right: ReseedTrigger): ReseedTrigger {
		if (!left) return right;
		return {
			reason: right.reason,
			changedFiles: Array.from(new Set([...left.changedFiles, ...right.changedFiles])),
			gitDiffSummary: [left.gitDiffSummary, right.gitDiffSummary].filter(Boolean).join("\n\n") || undefined,
		};
	}
}
