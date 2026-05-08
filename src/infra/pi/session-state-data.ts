import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { CURRENT_RUNTIME_STATE_VERSION, INITIAL_RUNTIME_STATE, type RuntimeState, type SuggestionUsageStats } from "../../domain/state.js";
import type { SuggestionUsage } from "../../domain/suggestion.js";
import { addUsageStats, cloneUsageStats, emptyUsageStats, normalizeUsageStats } from "../../domain/usage.js";
import {
	LEGACY_STATE_CUSTOM_TYPE,
	LEGACY_USAGE_CUSTOM_TYPE,
	type PersistedInteractionState,
	type SuggestionUsageStatsPair,
	type UsageLedgerEntry,
} from "./session-state-types.js";

export function emptyUsagePair(): SuggestionUsageStatsPair {
	return {
		suggester: emptyUsageStats(),
		seeder: emptyUsageStats(),
	};
}

export function cloneUsagePair(pair: SuggestionUsageStatsPair): SuggestionUsageStatsPair {
	return {
		suggester: cloneUsageStats(pair.suggester),
		seeder: cloneUsageStats(pair.seeder),
	};
}

export function parseUsage(raw: unknown): SuggestionUsage | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const usage = raw as Partial<SuggestionUsage>;
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
	return {
		inputTokens: usage.inputTokens,
		outputTokens: usage.outputTokens,
		cacheReadTokens: usage.cacheReadTokens,
		cacheWriteTokens: usage.cacheWriteTokens,
		totalTokens: usage.totalTokens,
		costTotal: usage.costTotal,
	};
}

export function normalizeInteractionState(raw: unknown): PersistedInteractionState {
	const latest = (raw ?? INITIAL_RUNTIME_STATE) as Partial<RuntimeState> & { steeringHistory?: unknown };
	return {
		stateVersion: CURRENT_RUNTIME_STATE_VERSION,
		lastSuggestion: latest.lastSuggestion,
		pendingNextTurnObservation: latest.pendingNextTurnObservation,
		steeringHistory: Array.isArray(latest.steeringHistory) ? latest.steeringHistory : [],
		turnsSinceLastStalenessCheck: Math.max(0, Number(latest.turnsSinceLastStalenessCheck ?? 0)),
	};
}

export function toRuntimeState(interaction: PersistedInteractionState, usage: SuggestionUsageStatsPair): RuntimeState {
	return {
		stateVersion: CURRENT_RUNTIME_STATE_VERSION,
		lastSuggestion: interaction.lastSuggestion,
		pendingNextTurnObservation: interaction.pendingNextTurnObservation,
		steeringHistory: interaction.steeringHistory,
		suggestionUsage: cloneUsageStats(usage.suggester),
		seederUsage: cloneUsageStats(usage.seeder),
		turnsSinceLastStalenessCheck: interaction.turnsSinceLastStalenessCheck,
	};
}

export function toPersistedInteractionState(state: RuntimeState): PersistedInteractionState {
	return normalizeInteractionState({
		stateVersion: CURRENT_RUNTIME_STATE_VERSION,
		lastSuggestion: state.lastSuggestion,
		pendingNextTurnObservation: state.pendingNextTurnObservation,
		steeringHistory: state.steeringHistory,
		turnsSinceLastStalenessCheck: state.turnsSinceLastStalenessCheck,
	});
}

export function extractUsageTotals(entries: SessionEntry[]): {
	hasLedger: boolean;
	suggester: SuggestionUsageStats;
	seeder: SuggestionUsageStats;
	legacyUsageEntryCount: number;
} {
	let hasLedger = false;
	let legacyUsageEntryCount = 0;
	let suggester = emptyUsageStats();
	let seeder = emptyUsageStats();

	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== LEGACY_USAGE_CUSTOM_TYPE) continue;
		legacyUsageEntryCount += 1;
		const data = entry.data as UsageLedgerEntry;
		const usage = parseUsage(data?.usage);
		if (!usage) continue;
		hasLedger = true;
		if (data.kind === "seeder") seeder = addUsageStats(seeder, usage);
		else suggester = addUsageStats(suggester, usage);
	}

	return { hasLedger, suggester, seeder, legacyUsageEntryCount };
}

export function extractLegacyInteractionSnapshots(entries: SessionEntry[]): Map<string, PersistedInteractionState> {
	const snapshots = new Map<string, PersistedInteractionState>();
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== LEGACY_STATE_CUSTOM_TYPE) continue;
		snapshots.set(entry.id, normalizeInteractionState(entry.data));
	}
	return snapshots;
}

export function normalizePersistedUsagePair(raw: {
	suggestionUsage?: unknown;
	seederUsage?: unknown;
} | undefined): SuggestionUsageStatsPair {
	return {
		suggester: normalizeUsageStats(raw?.suggestionUsage, emptyUsageStats()),
		seeder: normalizeUsageStats(raw?.seederUsage, emptyUsageStats()),
	};
}
