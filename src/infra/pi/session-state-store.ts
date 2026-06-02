import { promises as fs } from "node:fs";
import type { StateStore } from "../../app/ports/state-store.js";
import { INITIAL_RUNTIME_STATE, type RuntimeState } from "../../domain/state.js";
import { addUsageStats } from "../../domain/usage.js";
import type { SuggestionUsage } from "../../domain/suggestion.js";
import { atomicWriteJson } from "../storage/atomic-write.js";
import { readJsonIfExists } from "../storage/json-file.js";
import { projectSuggesterDir } from "../storage/suggester-paths.js";
import {
	emptyUsagePair,
	normalizeInteractionState,
	toPersistedInteractionState,
	toRuntimeState,
} from "./session-state-data.js";
import { ensureSessionMigration } from "./session-migration.js";
import { SessionUsageLedger } from "./session-usage-ledger.js";
import { createSessionStorageContext, stateFilePath } from "./session-storage-context.js";
import type { InMemorySessionState, PersistedInteractionState, SessionReadableManager, SessionStorageContext } from "./session-state-types.js";

export class SessionStateStore implements StateStore {
	private readonly inMemory = new Map<string, InMemorySessionState>();
	private readonly migrationTasks = new Map<string, Promise<void>>();
	private readonly usageLedger = new SessionUsageLedger();

	public constructor(
		private readonly cwd: string,
		private readonly getSessionManager: () => SessionReadableManager | undefined,
		private readonly projectStorageDir: string = projectSuggesterDir(cwd),
	) {}

	public async load(): Promise<RuntimeState> {
		const context = this.getStorageContext();
		if (!context) return INITIAL_RUNTIME_STATE;

		if (!context.persistent) {
			const current = this.inMemory.get(context.sessionId);
			return current ? toRuntimeState(current.interaction, current.usage) : INITIAL_RUNTIME_STATE;
		}

		await this.ensureMigrated(context);
		const interaction = await this.loadInteractionState(context);
		const usage = await this.usageLedger.load(context);
		return toRuntimeState(interaction, usage);
	}

	public async save(state: RuntimeState): Promise<void> {
		const context = this.getStorageContext();
		if (!context) return;

		const interaction = toPersistedInteractionState(state);
		if (!context.persistent) {
			const current = this.inMemory.get(context.sessionId) ?? { interaction, usage: emptyUsagePair() };
			current.interaction = interaction;
			this.inMemory.set(context.sessionId, current);
			return;
		}

		await this.ensureMigrated(context);
		await fs.mkdir(context.interactionDir!, { recursive: true });
		await atomicWriteJson(stateFilePath(context.interactionDir!, context.currentKey), interaction);
	}

	public async recordUsage(kind: "suggester" | "seeder", usage: SuggestionUsage): Promise<void> {
		const context = this.getStorageContext();
		if (!context) return;

		if (!context.persistent) {
			const current = this.inMemory.get(context.sessionId) ?? {
				interaction: normalizeInteractionState(INITIAL_RUNTIME_STATE),
				usage: emptyUsagePair(),
			};
			current.usage = {
				...current.usage,
				[kind]: addUsageStats(current.usage[kind], usage),
			};
			this.inMemory.set(context.sessionId, current);
			return;
		}

		await this.ensureMigrated(context);
		await this.usageLedger.record(context, kind, usage);
	}

	private getStorageContext(): SessionStorageContext | undefined {
		const sessionManager = this.getSessionManager();
		return sessionManager ? createSessionStorageContext(this.cwd, sessionManager, this.projectStorageDir) : undefined;
	}

	private async loadInteractionState(context: SessionStorageContext): Promise<PersistedInteractionState> {
		for (const key of context.lookupKeys) {
			const state = await readJsonIfExists<PersistedInteractionState>(stateFilePath(context.interactionDir!, key));
			if (state) return normalizeInteractionState(state);
		}
		return normalizeInteractionState(INITIAL_RUNTIME_STATE);
	}

	private async ensureMigrated(context: SessionStorageContext): Promise<void> {
		await ensureSessionMigration({
			context,
			cwd: this.cwd,
			getSessionManager: this.getSessionManager,
			migrationTasks: this.migrationTasks,
		});
	}
}
