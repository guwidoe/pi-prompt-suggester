import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { RuntimeState, SuggestionUsageStats } from "../../domain/state.js";
import type { SuggestionUsage } from "../../domain/suggestion.js";

export const LEGACY_STATE_CUSTOM_TYPE = "suggester-state";
export const LEGACY_USAGE_CUSTOM_TYPE = "suggester-usage";
export const STORE_SCHEMA_VERSION = 1;
export const ROOT_STATE_KEY = "__root__";

export interface SessionReadableManager {
	getBranch(): SessionEntry[];
	getEntries(): SessionEntry[];
	getSessionFile(): string | undefined;
	getSessionId(): string;
	getLeafId(): string | null;
	getCwd(): string;
}

export interface UsageLedgerEntry {
	kind: "suggester" | "seeder";
	usage: SuggestionUsage;
	at?: string;
}

export interface PersistedInteractionState {
	stateVersion: number;
	lastSuggestion?: RuntimeState["lastSuggestion"];
	pendingNextTurnObservation?: RuntimeState["pendingNextTurnObservation"];
	steeringHistory: RuntimeState["steeringHistory"];
	turnsSinceLastStalenessCheck: number;
}

export interface PersistedUsageState {
	schemaVersion: number;
	suggestionUsage: SuggestionUsageStats;
	seederUsage: SuggestionUsageStats;
	updatedAt: string;
}

export interface PersistedSessionMetadata {
	schemaVersion: number;
	sessionId: string;
	sessionFile?: string;
	cwd: string;
	ignoreLegacyPiSessionEntries: true;
	legacyMigration: {
		performedAt: string;
		importedLegacyEntries: boolean;
		legacyStateEntryCount: number;
		legacyUsageEntryCount: number;
		note: string;
	};
}

export interface SessionStorageContext {
	sessionId: string;
	sessionFile: string | undefined;
	storageDir?: string;
	interactionDir?: string;
	usageFile?: string;
	metaFile?: string;
	lookupKeys: string[];
	currentKey: string;
	persistent: boolean;
}

export interface SuggestionUsageStatsPair {
	suggester: SuggestionUsageStats;
	seeder: SuggestionUsageStats;
}

export interface InMemorySessionState {
	interaction: PersistedInteractionState;
	usage: SuggestionUsageStatsPair;
}
