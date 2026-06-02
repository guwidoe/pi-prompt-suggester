import { promises as fs } from "node:fs";
import path from "node:path";
import type { InferenceDefault, PromptSuggesterConfig, SuggestionStrategy, ThinkingLevel } from "../../config/types.js";
import { readJsonIfExists, writeJson } from "../storage/json-file.js";
import { projectSuggesterDir } from "../storage/suggester-paths.js";

export interface SuggesterVariant {
	strategy?: SuggestionStrategy;
	suggesterModel?: string;
	suggesterThinking?: ThinkingLevel | InferenceDefault;
	maxSuggestionChars?: number;
	maxRecentUserPrompts?: number;
	maxRecentUserPromptChars?: number;
	maxChangedExamples?: number;
	transcriptMaxContextPercent?: number;
	transcriptMaxMessages?: number;
	transcriptMaxChars?: number;
	transcriptRolloutPercent?: number;
}

interface VariantFile {
	activeVariant: string;
	variants: Record<string, SuggesterVariant>;
}

export type AbWinner = "A" | "B" | "tie" | "both_bad";

export interface AbResultRecord {
	at: string;
	turnId: string;
	variantA: string;
	variantB: string;
	suggestionA: string;
	suggestionB: string;
	winner: AbWinner;
}

export interface VariantStatsEntry {
	compared: number;
	wins: number;
	losses: number;
	ties: number;
	bothBad: number;
}

const DEFAULT_VARIANT_NAME = "default";
const DEFAULT_FILE: VariantFile = {
	activeVariant: DEFAULT_VARIANT_NAME,
	variants: {
		[DEFAULT_VARIANT_NAME]: {},
	},
};

function isThinkingValue(value: unknown): value is ThinkingLevel | InferenceDefault {
	return ["minimal", "low", "medium", "high", "xhigh", "session-default"].includes(String(value));
}

function isPositiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isPercentageInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

function isPositivePercentageInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 100;
}

function isStrategy(value: unknown): value is SuggestionStrategy {
	return value === "compact" || value === "transcript-steering";
}

function normalizeVariant(value: unknown): SuggesterVariant {
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const raw = value as Record<string, unknown>;
	const next: SuggesterVariant = {};
	if (isStrategy(raw.strategy)) next.strategy = raw.strategy;
	if (typeof raw.suggesterModel === "string" && raw.suggesterModel.trim()) next.suggesterModel = raw.suggesterModel.trim();
	if (isThinkingValue(raw.suggesterThinking)) next.suggesterThinking = raw.suggesterThinking;
	if (isPositiveInteger(raw.maxSuggestionChars)) next.maxSuggestionChars = raw.maxSuggestionChars;
	if (isPositiveInteger(raw.maxRecentUserPrompts)) next.maxRecentUserPrompts = raw.maxRecentUserPrompts;
	if (isPositiveInteger(raw.maxRecentUserPromptChars)) next.maxRecentUserPromptChars = raw.maxRecentUserPromptChars;
	if (isPositiveInteger(raw.maxChangedExamples)) next.maxChangedExamples = raw.maxChangedExamples;
	if (isPositivePercentageInteger(raw.transcriptMaxContextPercent)) {
		next.transcriptMaxContextPercent = raw.transcriptMaxContextPercent;
	}
	if (isPositiveInteger(raw.transcriptMaxMessages)) next.transcriptMaxMessages = raw.transcriptMaxMessages;
	if (isPositiveInteger(raw.transcriptMaxChars)) next.transcriptMaxChars = raw.transcriptMaxChars;
	if (isPercentageInteger(raw.transcriptRolloutPercent)) next.transcriptRolloutPercent = raw.transcriptRolloutPercent;
	return next;
}

function normalizeFile(raw: unknown): { value: VariantFile; changed: boolean } {
	if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
		return { value: DEFAULT_FILE, changed: true };
	}

	const input = raw as Record<string, unknown>;
	const normalizedVariants: Record<string, SuggesterVariant> = {};
	let changed = false;
	const rawVariants = input.variants;
	if (rawVariants && typeof rawVariants === "object" && !Array.isArray(rawVariants)) {
		for (const [name, value] of Object.entries(rawVariants)) {
			const trimmed = name.trim();
			if (!trimmed) {
				changed = true;
				continue;
			}
			const normalized = normalizeVariant(value);
			normalizedVariants[trimmed] = normalized;
			if (JSON.stringify(normalized) !== JSON.stringify(value)) changed = true;
		}
	} else if (rawVariants !== undefined) {
		changed = true;
	}

	if (!normalizedVariants[DEFAULT_VARIANT_NAME]) {
		normalizedVariants[DEFAULT_VARIANT_NAME] = {};
		changed = true;
	}

	const activeVariant = typeof input.activeVariant === "string" && normalizedVariants[input.activeVariant]
		? input.activeVariant
		: DEFAULT_VARIANT_NAME;
	if (activeVariant !== input.activeVariant) changed = true;

	const value: VariantFile = {
		activeVariant,
		variants: normalizedVariants,
	};
	if (JSON.stringify(value) !== JSON.stringify(raw)) changed = true;
	return { value, changed };
}

function cloneConfig(config: PromptSuggesterConfig): PromptSuggesterConfig {
	return JSON.parse(JSON.stringify(config)) as PromptSuggesterConfig;
}

function createEmptyStats(): VariantStatsEntry {
	return {
		compared: 0,
		wins: 0,
		losses: 0,
		ties: 0,
		bothBad: 0,
	};
}

export class SuggesterVariantStore {
	private readonly filePath: string;
	private readonly resultsPath: string;
	private state: VariantFile = DEFAULT_FILE;

	public constructor(
		private readonly cwd: string = process.cwd(),
		private readonly projectStorageDir: string = projectSuggesterDir(cwd),
	) {
		this.filePath = path.join(this.projectStorageDir, "variants.json");
		this.resultsPath = path.join(this.projectStorageDir, "ab-results.ndjson");
	}

	public async init(): Promise<void> {
		const raw = await readJsonIfExists(this.filePath);
		if (raw === undefined) {
			this.state = DEFAULT_FILE;
			return;
		}
		const normalized = normalizeFile(raw);
		this.state = normalized.value;
		if (normalized.changed) await this.persist();
	}

	public getActiveVariantName(): string {
		return this.state.activeVariant;
	}

	public listVariants(): Array<{ name: string; variant: SuggesterVariant; active: boolean }> {
		return Object.keys(this.state.variants)
			.sort((a, b) => a.localeCompare(b))
			.map((name) => ({
				name,
				variant: this.state.variants[name],
				active: name === this.state.activeVariant,
			}));
	}

	public getVariant(name: string): SuggesterVariant | undefined {
		return this.state.variants[name];
	}

	public getEffectiveConfig(baseConfig: PromptSuggesterConfig, variantName: string = this.state.activeVariant): PromptSuggesterConfig {
		const config = cloneConfig(baseConfig);
		const variant = this.state.variants[variantName];
		if (!variant) return config;
		if (variant.strategy !== undefined) config.suggestion.strategy = variant.strategy;
		if (variant.suggesterModel !== undefined) config.inference.suggesterModel = variant.suggesterModel;
		if (variant.suggesterThinking !== undefined) config.inference.suggesterThinking = variant.suggesterThinking;
		if (variant.maxSuggestionChars !== undefined) config.suggestion.maxSuggestionChars = variant.maxSuggestionChars;
		if (variant.maxRecentUserPrompts !== undefined) config.suggestion.maxRecentUserPrompts = variant.maxRecentUserPrompts;
		if (variant.maxRecentUserPromptChars !== undefined) {
			config.suggestion.maxRecentUserPromptChars = variant.maxRecentUserPromptChars;
		}
		if (variant.maxChangedExamples !== undefined) config.steering.maxChangedExamples = variant.maxChangedExamples;
		if (variant.transcriptMaxContextPercent !== undefined) {
			config.suggestion.transcriptMaxContextPercent = variant.transcriptMaxContextPercent;
		}
		if (variant.transcriptMaxMessages !== undefined) config.suggestion.transcriptMaxMessages = variant.transcriptMaxMessages;
		if (variant.transcriptMaxChars !== undefined) config.suggestion.transcriptMaxChars = variant.transcriptMaxChars;
		if (variant.transcriptRolloutPercent !== undefined) {
			config.suggestion.transcriptRolloutPercent = variant.transcriptRolloutPercent;
		}
		return config;
	}

	public async createVariant(name: string, sourceName?: string): Promise<void> {
		const trimmed = name.trim();
		if (!trimmed) throw new Error("Variant name is required.");
		if (this.state.variants[trimmed]) throw new Error(`Variant already exists: ${trimmed}`);
		const source = sourceName ? this.state.variants[sourceName] : this.state.variants[this.state.activeVariant];
		this.state = {
			...this.state,
			variants: {
				...this.state.variants,
				[trimmed]: source ? JSON.parse(JSON.stringify(source)) as SuggesterVariant : {},
			},
		};
		await this.persist();
	}

	public async updateVariant(name: string, variant: SuggesterVariant): Promise<void> {
		if (!this.state.variants[name]) throw new Error(`Unknown variant: ${name}`);
		this.state = {
			...this.state,
			variants: {
				...this.state.variants,
				[name]: normalizeVariant(variant),
			},
		};
		await this.persist();
	}

	public async renameVariant(from: string, to: string): Promise<void> {
		if (!this.state.variants[from]) throw new Error(`Unknown variant: ${from}`);
		const trimmed = to.trim();
		if (!trimmed) throw new Error("New variant name is required.");
		if (this.state.variants[trimmed]) throw new Error(`Variant already exists: ${trimmed}`);
		const variants = { ...this.state.variants };
		variants[trimmed] = variants[from];
		delete variants[from];
		this.state = {
			activeVariant: this.state.activeVariant === from ? trimmed : this.state.activeVariant,
			variants,
		};
		await this.persist();
	}

	public async duplicateVariant(sourceName: string, newName: string): Promise<void> {
		if (!this.state.variants[sourceName]) throw new Error(`Unknown variant: ${sourceName}`);
		await this.createVariant(newName, sourceName);
	}

	public async deleteVariant(name: string): Promise<void> {
		if (name === DEFAULT_VARIANT_NAME) throw new Error("The default variant cannot be deleted.");
		if (!this.state.variants[name]) throw new Error(`Unknown variant: ${name}`);
		const variants = { ...this.state.variants };
		delete variants[name];
		this.state = {
			activeVariant: this.state.activeVariant === name ? DEFAULT_VARIANT_NAME : this.state.activeVariant,
			variants,
		};
		await this.persist();
	}

	public async setActiveVariant(name: string): Promise<void> {
		if (!this.state.variants[name]) throw new Error(`Unknown variant: ${name}`);
		this.state = {
			...this.state,
			activeVariant: name,
		};
		await this.persist();
	}

	public async recordResult(record: AbResultRecord): Promise<void> {
		await fs.mkdir(path.dirname(this.resultsPath), { recursive: true });
		await fs.appendFile(this.resultsPath, `${JSON.stringify(record)}\n`, "utf8");
	}

	public async getStats(): Promise<Record<string, VariantStatsEntry>> {
		let raw = "";
		try {
			raw = await fs.readFile(this.resultsPath, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
			throw error;
		}
		const stats: Record<string, VariantStatsEntry> = {};
		for (const line of raw.split(/\r?\n/)) {
			if (!line.trim()) continue;
			let parsed: AbResultRecord;
			try {
				parsed = JSON.parse(line) as AbResultRecord;
			} catch {
				continue;
			}
			const a = stats[parsed.variantA] ?? (stats[parsed.variantA] = createEmptyStats());
			const b = stats[parsed.variantB] ?? (stats[parsed.variantB] = createEmptyStats());
			a.compared += 1;
			b.compared += 1;
			if (parsed.winner === "A") {
				a.wins += 1;
				b.losses += 1;
			} else if (parsed.winner === "B") {
				b.wins += 1;
				a.losses += 1;
			} else if (parsed.winner === "tie") {
				a.ties += 1;
				b.ties += 1;
			} else {
				a.bothBad += 1;
				b.bothBad += 1;
			}
		}
		return stats;
	}

	private async persist(): Promise<void> {
		await writeJson(this.filePath, this.state);
	}
}
