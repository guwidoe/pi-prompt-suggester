import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { completeSimple, type Message, type Model, type ThinkingLevel as AiThinkingLevel, type UserMessage } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ModelClient, ModelInvocationSettings, SuggestionModelContext } from "../../app/ports/model-client.js";
import type { Logger } from "../../app/ports/logger.js";
import type { SuggestionPromptContext } from "../../app/services/prompt-context-builder.js";
import type { TranscriptSuggestionPromptContext } from "../../app/services/transcript-prompt-context-builder.js";
import type { SuggestionUsage } from "../../domain/suggestion.js";
import { accumulateUsage, createEmptyUsage } from "../../domain/usage.js";
import {
	REQUIRED_SEED_CATEGORIES,
	type SeedArtifact,
	type SeedCategoryFindings,
	type SeedDraft,
	type SeedKeyFileCategory,
} from "../../domain/seed.js";
import { renderForcedSeederFinalPrompt, renderSeederSystemPrompt, renderSeederUserPrompt } from "../../prompts/seeder-template.js";
import { renderSuggestionPrompt } from "../../prompts/suggestion-template.js";
import { renderTranscriptSteeringPrompt } from "../../prompts/transcript-steering-template.js";

const execFileAsync = promisify(execFile);
const IGNORED_DIRS = new Set([".git", "node_modules", ".pi", "dist", "build", "coverage"]);
const CLAUDE_BRIDGE_STREAM_SIMPLE_KEY = Symbol.for("claude-bridge:activeStreamSimple");

export interface RuntimeContextProvider {
	getContext(): ExtensionContext | undefined;
}

interface CompletePromptOptions {
	allowEmptyText?: boolean;
}

interface ProviderInvocationContext {
	kind: "suggestion" | "seed";
	configuredModelRef?: string;
	sessionId?: string;
	debugMeta?: Record<string, unknown>;
	allowEmptyText?: boolean;
}

interface CompletionResponseLike {
	content?: unknown;
	usage?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		totalTokens?: number;
		cost?: {
			total?: number;
		};
	};
}

type StreamSimpleLike = (
	model: Model<any>,
	context: { systemPrompt: string; messages: Message[] },
	options: {
		apiKey?: string;
		headers?: Record<string, string>;
		reasoning?: AiThinkingLevel;
		sessionId?: string;
		onPayload?: (payload: unknown) => Promise<undefined>;
	},
) => { result(): Promise<CompletionResponseLike> };

type SeederToolName = "ls" | "find" | "grep" | "read";

type SeederModelResponse =
	| {
			type: "tool";
			tool: SeederToolName;
			arguments?: Record<string, unknown>;
			reason?: string;
	  }
	| {
			type: "final";
			seed: Record<string, unknown>;
	  };

interface SeederHistoryEntry {
	modelResponse: string;
	toolResult?: string;
}

class SeederRunError extends Error {
	public constructor(
		message: string,
		public readonly usage: SuggestionUsage,
	) {
		super(message);
	}
}

class UnsupportedProviderError extends Error {
	public constructor(
		public readonly providerApi: string,
		public readonly model: Model<any>,
		public readonly configuredModelRef: string | undefined,
		public readonly invocationKind: "suggestion" | "seed",
	) {
		super(
			invocationKind === "seed"
				? `Prompt suggester cannot generate a seed with provider '${providerApi}'. Set an explicit supported suggester/seeder model instead of relying on this session provider.`
				: `Prompt suggester skipped a suggestion because provider '${providerApi}' is not directly compatible with this extension. Set an explicit supported suggester model or switch the session to a supported provider.`,
		);
	}
}

function truncate(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars)}\n...[truncated]`;
}

function preview(value: string, maxChars: number = 500): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	if (normalized.length <= maxChars) return normalized;
	return `${normalized.slice(0, maxChars)}…`;
}

function extractText(content: unknown): string {
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (block && typeof block === "object" && "type" in block && (block as { type?: string }).type === "text") {
				return String((block as { text?: unknown }).text ?? "");
			}
			return "";
		})
		.join("\n")
		.trim();
}

function isTranscriptSuggestionContext(context: SuggestionModelContext): context is TranscriptSuggestionPromptContext {
	return "transcriptMessages" in context;
}

function tryParseObjectJson(text: string): Record<string, unknown> | undefined {
	try {
		const parsed = JSON.parse(text);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		return undefined;
	} catch {
		return undefined;
	}
}

function extractBalancedObjectJsonCandidates(text: string): string[] {
	const candidates: string[] = [];
	let inString = false;
	let escaped = false;
	let depth = 0;
	let start = -1;

	for (let i = 0; i < text.length; i += 1) {
		const ch = text[i];
		if (inString) {
			if (escaped) {
				escaped = false;
				continue;
			}
			if (ch === "\\") {
				escaped = true;
				continue;
			}
			if (ch === '"') {
				inString = false;
			}
			continue;
		}

		if (ch === '"') {
			inString = true;
			continue;
		}
		if (ch === "{") {
			if (depth === 0) start = i;
			depth += 1;
			continue;
		}
		if (ch === "}") {
			if (depth > 0) depth -= 1;
			if (depth === 0 && start >= 0) {
				candidates.push(text.slice(start, i + 1));
				start = -1;
			}
		}
	}

	return candidates;
}

function parseJsonObject(text: string): Record<string, unknown> {
	const trimmed = text.trim();
	const direct = tryParseObjectJson(trimmed);
	if (direct) return direct;

	const fencedMatches = trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);
	for (const match of fencedMatches) {
		const candidate = match[1]?.trim();
		if (!candidate) continue;
		const parsed = tryParseObjectJson(candidate);
		if (parsed) return parsed;
	}

	for (const candidate of extractBalancedObjectJsonCandidates(trimmed)) {
		const parsed = tryParseObjectJson(candidate);
		if (parsed) return parsed;
	}

	throw new Error("Model did not return parseable JSON object");
}

function coerceStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value.map((entry) => String(entry)).map((entry) => entry.trim()).filter(Boolean);
}

function coerceCategory(value: unknown): SeedKeyFileCategory {
	const category = String(value ?? "other").trim();
	if (
		category === "vision" ||
		category === "architecture" ||
		category === "principles_guidelines" ||
		category === "code_entrypoint" ||
		category === "other"
	) {
		return category;
	}
	return "other";
}

function coerceCategoryFindings(value: unknown): SeedCategoryFindings | undefined {
	if (!value || typeof value !== "object") return undefined;
	const obj = value as Record<string, unknown>;
	const categories: Array<"vision" | "architecture" | "principles_guidelines"> = [
		"vision",
		"architecture",
		"principles_guidelines",
	];
	const findings = {} as SeedCategoryFindings;
	for (const category of categories) {
		const raw = obj[category];
		if (!raw || typeof raw !== "object") continue;
		const entry = raw as Record<string, unknown>;
		findings[category] = {
			found: Boolean(entry.found),
			rationale: String(entry.rationale ?? "").trim(),
			files: coerceStringArray(entry.files),
		};
	}
	return Object.keys(findings).length > 0 ? findings : undefined;
}

function coerceSeedDraft(payload: Record<string, unknown>): SeedDraft {
	const keyFiles = Array.isArray(payload.keyFiles)
		? payload.keyFiles
				.map((entry) => {
					if (!entry || typeof entry !== "object") return null;
					const filePath = String((entry as { path?: unknown }).path ?? "").trim();
					const whyImportant = String((entry as { whyImportant?: unknown }).whyImportant ?? "").trim();
					if (!filePath) return null;
					return {
						path: filePath,
						whyImportant: whyImportant || "High-signal file",
						category: coerceCategory((entry as { category?: unknown }).category),
					};
				})
				.filter((entry): entry is { path: string; whyImportant: string; category: SeedKeyFileCategory } => entry !== null)
		: [];

	const topObjectives = coerceStringArray(payload.topObjectives);
	const constraints = coerceStringArray(payload.constraints);
	const objectivesSummary = String(payload.objectivesSummary ?? "").trim() || topObjectives.join("\n");
	const constraintsSummary = String(payload.constraintsSummary ?? "").trim() || constraints.join("\n");
	return {
		projectIntentSummary: String(payload.projectIntentSummary ?? payload.visionSummary ?? "").trim(),
		objectivesSummary,
		constraintsSummary,
		principlesGuidelinesSummary: String(payload.principlesGuidelinesSummary ?? payload.guidelinesSummary ?? "").trim(),
		implementationStatusSummary: String(payload.implementationStatusSummary ?? payload.statusSummary ?? "").trim(),
		topObjectives,
		constraints,
		keyFiles,
		categoryFindings: coerceCategoryFindings(payload.categoryFindings),
		openQuestions: coerceStringArray(payload.openQuestions),
		reseedNotes: String(payload.reseedNotes ?? "").trim() || undefined,
	};
}

function parseSeederResponse(text: string): SeederModelResponse {
	const parsed = parseJsonObject(text);
	const type = String(parsed.type ?? "").trim();
	if (type === "tool") {
		const tool = String(parsed.tool ?? "").trim() as SeederToolName;
		if (!tool || !["ls", "find", "grep", "read"].includes(tool)) {
			throw new Error(`Invalid seeder tool: ${tool || "(empty)"}`);
		}
		return {
			type: "tool",
			tool,
			arguments: (parsed.arguments ?? {}) as Record<string, unknown>,
			reason: String(parsed.reason ?? "").trim() || undefined,
		};
	}
	if (type === "final") {
		if (!parsed.seed || typeof parsed.seed !== "object") {
			throw new Error("Seeder final response missing seed object");
		}
		return {
			type: "final",
			seed: parsed.seed as Record<string, unknown>,
		};
	}
	throw new Error(`Invalid seeder response type: ${type || "(empty)"}`);
}

function parseSeederFinalResponse(text: string): Record<string, unknown> {
	const response = parseSeederResponse(text);
	if (response.type !== "final") {
		throw new Error(`Forced seeder final synthesis returned type=${response.type} instead of type=final`);
	}
	return response.seed;
}

function globToRegExp(glob: string): RegExp {
	const escaped = glob
		.replace(/[.+^${}()|[\]\\]/g, "\\$&")
		.replace(/\*\*/g, "::DOUBLE_STAR::")
		.replace(/\*/g, "[^/]*")
		.replace(/::DOUBLE_STAR::/g, ".*");
	return new RegExp(`^${escaped}$`, "i");
}

function validateSeedCoverage(draft: SeedDraft): { ok: boolean; reason?: string } {
	const findings = draft.categoryFindings;
	if (!findings) {
		return { ok: false, reason: "Missing categoryFindings. Provide explicit findings for vision/architecture/principles_guidelines." };
	}

	for (const category of REQUIRED_SEED_CATEGORIES) {
		const finding = findings[category as "vision" | "architecture" | "principles_guidelines"];
		if (!finding) {
			return { ok: false, reason: `Missing categoryFindings.${category}` };
		}
		if (!finding.rationale.trim()) {
			return { ok: false, reason: `categoryFindings.${category}.rationale is empty` };
		}
		const hasCategoryFile = draft.keyFiles.some((file) => file.category === category);
		if (finding.found && !hasCategoryFile) {
			return {
				ok: false,
				reason: `categoryFindings.${category}.found=true but no keyFiles are marked as ${category}`,
			};
		}
	}

	return { ok: true };
}

export class PiModelClient implements ModelClient {
	private readonly cwd: string;
	private readonly warnedCompatibilityKeys = new Set<string>();

	public constructor(
		private readonly runtime: RuntimeContextProvider,
		private readonly logger?: Logger,
		cwd: string = process.cwd(),
	) {
		this.cwd = cwd;
	}

	public async generateSeed(input: {
		reseedTrigger: import("../../domain/seed.js").ReseedTrigger;
		previousSeed: SeedArtifact | null;
		settings?: ModelInvocationSettings;
		runId?: string;
	}): Promise<{ seed: SeedDraft; usage?: SuggestionUsage }> {
		const runId = input.runId ?? `seed-${Date.now().toString(36)}`;
		const systemPrompt = renderSeederSystemPrompt();
		const history: SeederHistoryEntry[] = [];
		const maxSteps = 16;
		let usage = createEmptyUsage();
		this.logger?.info("seeder.run.started", {
			runId,
			reason: input.reseedTrigger.reason,
			changedFiles: input.reseedTrigger.changedFiles,
			modelRef: input.settings?.modelRef,
			thinking: input.settings?.thinkingLevel,
			maxSteps,
		});

		try {
			for (let step = 1; step <= maxSteps; step += 1) {
				const prompt = renderSeederUserPrompt({
					reseedTrigger: input.reseedTrigger,
					previousSeed: input.previousSeed,
					cwd: this.cwd,
					step,
					maxSteps,
					history,
				});
				const responseText = await this.completePrompt(prompt, systemPrompt, input.settings);
				usage = accumulateUsage(usage, responseText.usage);
				const response = parseSeederResponse(responseText.text);

				if (response.type === "final") {
					const draft = coerceSeedDraft(response.seed);
					if (!draft.projectIntentSummary) throw new Error("Seeder final response missing projectIntentSummary");
					if (!draft.objectivesSummary) throw new Error("Seeder final response missing objectivesSummary");
					if (!draft.constraintsSummary) throw new Error("Seeder final response missing constraintsSummary");
					if (!draft.principlesGuidelinesSummary) throw new Error("Seeder final response missing principlesGuidelinesSummary");
					if (!draft.implementationStatusSummary) throw new Error("Seeder final response missing implementationStatusSummary");
					if (draft.keyFiles.length === 0) throw new Error("Seeder final response produced no keyFiles");
					const validation = validateSeedCoverage(draft);
					if (validation.ok) {
						this.logger?.info("seeder.run.completed", {
							runId,
							step,
							keyFiles: draft.keyFiles.map((file) => file.path),
							categoryFindings: draft.categoryFindings,
							tokens: usage.totalTokens,
							cost: usage.costTotal,
						});
						return {
							seed: draft,
							usage,
						};
					}
					this.logger?.warn("seeder.validation.failed", {
						runId,
						step,
						reason: validation.reason,
						modelResponsePreview: preview(responseText.text),
					});
					history.push({
						modelResponse: responseText.text,
						toolResult: `Validation failed: ${validation.reason}. Continue exploring and/or explicitly report not-found categories in categoryFindings.`,
					});
					continue;
				}

				this.logger?.info("seeder.tool.requested", {
					runId,
					step,
					tool: response.tool,
					arguments: response.arguments,
					reason: response.reason,
					modelResponsePreview: preview(responseText.text),
				});
				const toolResult = await this.executeSeederTool(response.tool, response.arguments ?? {});
				this.logger?.info("seeder.tool.result", {
					runId,
					step,
					tool: response.tool,
					toolResultPreview: preview(toolResult, 700),
				});
				history.push({
					modelResponse: responseText.text,
					toolResult,
				});
			}

			this.logger?.warn("seeder.run.max_steps_reached", {
				runId,
				maxSteps,
				tokens: usage.totalTokens,
				cost: usage.costTotal,
			});

			const forcedPrompt = renderForcedSeederFinalPrompt({
				reseedTrigger: input.reseedTrigger,
				previousSeed: input.previousSeed,
				cwd: this.cwd,
				step: maxSteps,
				maxSteps,
				history,
			});
			const forcedResponseText = await this.completePrompt(forcedPrompt, systemPrompt, input.settings);
			usage = accumulateUsage(usage, forcedResponseText.usage);
			const forcedDraft = coerceSeedDraft(parseSeederFinalResponse(forcedResponseText.text));
			if (!forcedDraft.projectIntentSummary) throw new Error("Seeder final response missing projectIntentSummary");
			if (!forcedDraft.objectivesSummary) throw new Error("Seeder final response missing objectivesSummary");
			if (!forcedDraft.constraintsSummary) throw new Error("Seeder final response missing constraintsSummary");
			if (!forcedDraft.principlesGuidelinesSummary) throw new Error("Seeder final response missing principlesGuidelinesSummary");
			if (!forcedDraft.implementationStatusSummary) throw new Error("Seeder final response missing implementationStatusSummary");
			if (forcedDraft.keyFiles.length === 0) throw new Error("Seeder final response produced no keyFiles");
			const forcedValidation = validateSeedCoverage(forcedDraft);
			if (!forcedValidation.ok) {
				throw new Error(`Forced seeder final synthesis failed validation: ${forcedValidation.reason}`);
			}
			this.logger?.info("seeder.run.completed", {
				runId,
				step: maxSteps + 1,
				keyFiles: forcedDraft.keyFiles.map((file) => file.path),
				categoryFindings: forcedDraft.categoryFindings,
				tokens: usage.totalTokens,
				cost: usage.costTotal,
				forcedFinalSynthesis: true,
			});
			return {
				seed: forcedDraft,
				usage,
			};
		} catch (error) {
			if (error instanceof SeederRunError) throw error;
			throw new SeederRunError((error as Error).message, usage);
		}
	}

	public async generateSuggestion(
		context: SuggestionModelContext,
		settings?: ModelInvocationSettings,
	): Promise<{ text: string; usage?: SuggestionUsage }> {
		if (isTranscriptSuggestionContext(context)) {
			const suffixPrompt = renderTranscriptSteeringPrompt(context);
			const userMessage: UserMessage = {
				role: "user",
				content: [{ type: "text", text: suffixPrompt }],
				timestamp: Date.now(),
			};
			return await this.completePrompt(
				[...context.transcriptMessages, userMessage],
				context.systemPrompt,
				settings,
				context.sessionId,
				{ suggestionMode: "transcript-steering", transcriptMessageCount: context.transcriptMessageCount },
				{ allowEmptyText: true },
			);
		}
		return await this.completePrompt(
			[
				{
					role: "user",
					content: [{ type: "text", text: renderSuggestionPrompt(context as SuggestionPromptContext) }],
					timestamp: Date.now(),
				},
			],
			undefined,
			settings,
			undefined,
			{ suggestionMode: "compact" },
			{ allowEmptyText: true },
		);
	}

	private async completePrompt(
		messagesOrPrompt: Message[] | string,
		systemPrompt?: string,
		settings?: ModelInvocationSettings,
		sessionId?: string,
		debugMeta?: Record<string, unknown>,
		options?: CompletePromptOptions,
	): Promise<{ text: string; usage?: SuggestionUsage }> {
		const ctx = this.runtime.getContext();
		if (!ctx?.model) {
			throw new Error("No active model available for suggester");
		}

		const model = this.resolveModelForCall(ctx.model, settings?.modelRef, ctx.modelRegistry.getAll());
		const { apiKey, headers } = await this.resolveRequestAuth(model, ctx.modelRegistry);
		const messages = typeof messagesOrPrompt === "string"
			? [{ role: "user", content: [{ type: "text", text: messagesOrPrompt }], timestamp: Date.now() } satisfies UserMessage]
			: messagesOrPrompt;
		const requestContext = {
			systemPrompt:
				systemPrompt ??
				"You are the internal model used by pi-prompt-suggester. Follow the user prompt exactly and return only the requested format.",
			messages,
		};
		const requestOptions = {
			apiKey,
			headers,
			reasoning: settings?.thinkingLevel,
			sessionId,
			onPayload: async (payload: unknown) => {
				this.logger?.debug("suggestion.provider.payload", {
					...debugMeta,
					sessionId,
					payloadPreview: preview(JSON.stringify(payload), 1000),
				});
				return undefined;
			},
		};

		let response: CompletionResponseLike;
		try {
			response = await this.invokeModel(model, requestContext, requestOptions, {
				kind: options?.allowEmptyText ? "suggestion" : "seed",
				configuredModelRef: settings?.modelRef,
				sessionId,
				debugMeta,
				allowEmptyText: options?.allowEmptyText,
			});
		} catch (error) {
			if (error instanceof UnsupportedProviderError && options?.allowEmptyText) {
				this.warnUnsupportedProviderOnce(error, ctx);
				return { text: "", usage: undefined };
			}
			throw error;
		}

		const text = extractText(response.content);
		if (!text && !options?.allowEmptyText) throw new Error("Model returned empty text");
		return {
			text,
			usage: {
				inputTokens: Number(response.usage?.input ?? 0),
				outputTokens: Number(response.usage?.output ?? 0),
				cacheReadTokens: Number(response.usage?.cacheRead ?? 0),
				cacheWriteTokens: Number(response.usage?.cacheWrite ?? 0),
				totalTokens: Number(response.usage?.totalTokens ?? 0),
				costTotal: Number(response.usage?.cost?.total ?? 0),
			},
		};
	}

	private async invokeModel(
		model: Model<any>,
		context: { systemPrompt: string; messages: Message[] },
		options: {
			apiKey?: string;
			headers?: Record<string, string>;
			reasoning?: AiThinkingLevel;
			sessionId?: string;
			onPayload?: (payload: unknown) => Promise<undefined>;
		},
		invocation: ProviderInvocationContext,
	): Promise<CompletionResponseLike> {
		const claudeBridgeStream = this.getClaudeBridgeStreamSimple();
		if (model.api === "claude-bridge" && claudeBridgeStream) {
			this.logger?.debug("suggestion.provider.compat_shim", {
				providerApi: model.api,
				provider: model.provider,
				model: model.id,
				configuredModelRef: invocation.configuredModelRef,
				kind: invocation.kind,
			});
			return await claudeBridgeStream(model, context, options).result();
		}

		try {
			return await completeSimple(model, context, options);
		} catch (error) {
			if (this.isMissingProviderRegistrationError(error, model.api)) {
				throw new UnsupportedProviderError(model.api, model, invocation.configuredModelRef, invocation.kind);
			}
			throw error;
		}
	}

	private getClaudeBridgeStreamSimple(): StreamSimpleLike | undefined {
		const value = (globalThis as Record<symbol, unknown>)[CLAUDE_BRIDGE_STREAM_SIMPLE_KEY];
		return typeof value === "function" ? (value as StreamSimpleLike) : undefined;
	}

	private isMissingProviderRegistrationError(error: unknown, api: string): boolean {
		return error instanceof Error && error.message.includes(`No API provider registered for api: ${api}`);
	}

	private warnUnsupportedProviderOnce(error: UnsupportedProviderError, ctx: ExtensionContext): void {
		const configuredModelRef = error.configuredModelRef?.trim() || "session-default";
		const key = `${error.invocationKind}:${error.providerApi}:${configuredModelRef}`;
		if (this.warnedCompatibilityKeys.has(key)) return;
		this.warnedCompatibilityKeys.add(key);

		this.logger?.warn("suggestion.provider.incompatible", {
			providerApi: error.providerApi,
			provider: error.model.provider,
			model: error.model.id,
			configuredModelRef,
			resolution:
				"Set /suggester model suggester <supported-provider/model> or switch the session to a provider that this extension can call directly.",
		});

		if (ctx.hasUI) {
			ctx.ui.notify(
				`Prompt suggester skipped this turn because provider '${error.providerApi}' isn't directly compatible. Set /suggester model suggester <supported-provider/model> to use an explicit model.`,
				"warning",
			);
		}
	}

	private async resolveRequestAuth(
		model: Model<any>,
		modelRegistry: {
			getApiKeyAndHeaders?: (model: Model<any>) => Promise<
				| { ok: true; apiKey?: string; headers?: Record<string, string> }
				| { ok: false; error: string }
			>;
			getApiKey?: (model: Model<any>) => Promise<string | undefined>;
		},
	): Promise<{ apiKey?: string; headers?: Record<string, string> }> {
		if (typeof modelRegistry.getApiKeyAndHeaders === "function") {
			const auth = await modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) {
				throw new Error(auth.error);
			}
			return {
				apiKey: auth.apiKey,
				headers: auth.headers,
			};
		}

		return {
			apiKey: await modelRegistry.getApiKey?.(model),
		};
	}

	private resolveModelForCall(currentModel: Model<any>, modelRef: string | undefined, allModels: Model<any>[]): Model<any> {
		const normalized = (modelRef ?? "").trim();
		if (!normalized) return currentModel;
		if (normalized.includes("/")) {
			const [provider, ...rest] = normalized.split("/");
			const id = rest.join("/");
			const exact = allModels.find((entry) => entry.provider === provider && entry.id === id);
			if (exact) return exact;
			throw new Error(`Configured suggester model not found: ${normalized}`);
		}
		const candidates = allModels.filter((entry) => entry.id === normalized);
		if (candidates.length === 1) return candidates[0];
		if (candidates.length > 1) {
			throw new Error(
				`Configured suggester model '${normalized}' is ambiguous. Use provider/id, e.g. ${candidates[0].provider}/${candidates[0].id}`,
			);
		}
		throw new Error(`Configured suggester model not found: ${normalized}`);
	}

	private async executeSeederTool(tool: SeederToolName, args: Record<string, unknown>): Promise<string> {
		switch (tool) {
			case "ls":
				return await this.toolLs(args);
			case "find":
				return await this.toolFind(args);
			case "grep":
				return await this.toolGrep(args);
			case "read":
				return await this.toolRead(args);
			default:
				return "Unsupported tool";
		}
	}

	private resolvePath(inputPath: unknown): string {
		const value = typeof inputPath === "string" && inputPath.trim().length > 0 ? inputPath.trim() : ".";
		const clean = value.replace(/^@/, "");
		const absolute = path.resolve(this.cwd, clean);
		if (absolute !== this.cwd && !absolute.startsWith(`${this.cwd}${path.sep}`)) {
			throw new Error(`Path escapes repository root: ${value}`);
		}
		return absolute;
	}

	private async toolLs(args: Record<string, unknown>): Promise<string> {
		const absolute = this.resolvePath(args.path);
		const limit = Math.min(500, Math.max(1, Number(args.limit ?? 200)));
		const entries = await fs.readdir(absolute, { withFileTypes: true });
		const lines = entries
			.sort((a, b) => a.name.localeCompare(b.name))
			.slice(0, limit)
			.map((entry) => `${entry.isDirectory() ? "d" : "f"} ${path.relative(this.cwd, path.join(absolute, entry.name)) || "."}`);
		return truncate(lines.join("\n") || "(empty)", 8000);
	}

	private async toolFind(args: Record<string, unknown>): Promise<string> {
		const absolute = this.resolvePath(args.path);
		const pattern = String(args.pattern ?? "").trim();
		if (!pattern) throw new Error("find requires pattern");
		const limit = Math.min(500, Math.max(1, Number(args.limit ?? 200)));
		const matcher = globToRegExp(pattern.includes("*") || pattern.includes("?") ? pattern : `**/*${pattern}*`);
		const results: string[] = [];

		const walk = async (dir: string): Promise<void> => {
			if (results.length >= limit) return;
			const entries = await fs.readdir(dir, { withFileTypes: true });
			for (const entry of entries) {
				if (results.length >= limit) break;
				if (entry.isDirectory()) {
					if (IGNORED_DIRS.has(entry.name)) continue;
					await walk(path.join(dir, entry.name));
					continue;
				}
				const rel = path.relative(this.cwd, path.join(dir, entry.name));
				if (matcher.test(rel.replaceAll("\\", "/"))) results.push(rel);
			}
		};

		await walk(absolute);
		return truncate(results.join("\n") || "(no matches)", 8000);
	}

	private async toolGrep(args: Record<string, unknown>): Promise<string> {
		const searchPath = this.resolvePath(args.path);
		const pattern = String(args.pattern ?? "").trim();
		if (!pattern) throw new Error("grep requires pattern");
		const limit = Math.min(200, Math.max(1, Number(args.limit ?? 80)));
		const rgArgs = ["--line-number", "--no-heading", "--color", "never", "--max-count", String(limit)];
		if (args.ignoreCase === true) rgArgs.push("-i");
		if (args.literal === true) rgArgs.push("-F");
		if (typeof args.glob === "string" && args.glob.trim()) rgArgs.push("-g", args.glob.trim());
		rgArgs.push(pattern, searchPath);

		try {
			const { stdout } = await execFileAsync("rg", rgArgs, {
				cwd: this.cwd,
				maxBuffer: 1024 * 1024 * 10,
			});
			return truncate(stdout.trim() || "(no matches)", 8000);
		} catch (error) {
			const err = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: number | string };
			if (String(err.code) === "1") return "(no matches)";
			const stdout = typeof err.stdout === "string" ? err.stdout.trim() : "";
			const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
			return truncate([stdout, stderr].filter(Boolean).join("\n") || "(grep failed)", 8000);
		}
	}

	private async toolRead(args: Record<string, unknown>): Promise<string> {
		const absolute = this.resolvePath(args.path);
		const offset = Math.max(1, Number(args.offset ?? 1));
		const limit = Math.min(1200, Math.max(1, Number(args.limit ?? 220)));
		const raw = await fs.readFile(absolute, "utf8");
		const lines = raw.split(/\r?\n/);
		const start = offset - 1;
		const sliced = lines.slice(start, start + limit);
		const numbered = sliced.map((line, index) => `${start + index + 1}: ${line}`);
		return truncate(numbered.join("\n") || "(empty)", 12000);
	}
}
