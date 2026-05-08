import type {
	AgentEndEvent,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	InputEvent,
	SessionStartEvent,
	SessionTreeEvent,
} from "@earendil-works/pi-coding-agent";
import type { TurnContext } from "../../domain/suggestion.js";
import { buildTurnContext } from "../../app/services/conversation-signals.js";
import { ignoreStaleExtensionContextAsync } from "./stale-context.js";

export interface ExtensionWiring {
	onSessionStart: (ctx: ExtensionContext) => Promise<void>;
	onSessionShutdown: (ctx: ExtensionContext) => Promise<void>;
	onAgentEnd: (turn: ReturnType<typeof buildTurnContext>, ctx: ExtensionContext) => Promise<void>;
	onUserSubmit: (event: InputEvent, ctx: ExtensionContext) => Promise<void>;
	onReseedCommand: (ctx: ExtensionCommandContext) => Promise<void>;
	onStatusCommand: (ctx: ExtensionCommandContext) => Promise<void>;
	onModelCommand: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
	onThinkingCommand: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
	onConfigCommand: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
	onInstructionCommand: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
	onVariantCommand: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
	onAbCommand: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
	onSettingsUiCommand: (ctx: ExtensionCommandContext) => Promise<void>;
	onSeedTraceCommand: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
}

async function handleSessionEvent(
	ctx: ExtensionContext,
	handler: (ctx: ExtensionContext) => Promise<void>,
): Promise<void> {
	await handler(ctx);
}

function extractRecentUserPrompts(branchMessages: unknown[]): string[] {
	return [...branchMessages]
		.reverse()
		.filter((message): message is { role: string; content?: unknown } =>
			typeof message === "object" && message !== null && "role" in message && (message as { role: string }).role === "user",
		)
		.map((message) => {
			if (typeof message.content === "string") return message.content;
			if (!Array.isArray(message.content)) return "";
			return message.content
				.map((block) => {
					if (block && typeof block === "object" && "type" in block && (block as { type?: string }).type === "text") {
						return String((block as { text?: unknown }).text ?? "");
					}
					return "";
				})
				.join("\n");
		})
		.map((text) => text.trim())
		.filter(Boolean);
}

function buildAbortedFallbackTurn(sourceLeafId: string, branchMessages: unknown[]): TurnContext {
	return {
		turnId: sourceLeafId,
		sourceLeafId,
		assistantText: "[aborted]",
		assistantUsage: undefined,
		status: "aborted",
		occurredAt: new Date().toISOString(),
		recentUserPrompts: extractRecentUserPrompts(branchMessages),
		toolSignals: [],
		touchedFiles: [],
		unresolvedQuestions: [],
		abortContextNote:
			"The user explicitly aborted the previous agent turn. Suggest a clear next prompt that either resumes intentionally or redirects the work.",
	};
}

export class PiExtensionAdapter {
	public constructor(
		private readonly pi: ExtensionAPI,
		private readonly wiring: ExtensionWiring,
	) {}

	public register(): void {
		this.pi.on("session_start", async (_event: SessionStartEvent, ctx) => {
			await ignoreStaleExtensionContextAsync(() => handleSessionEvent(ctx, this.wiring.onSessionStart));
		});
		this.pi.on("session_tree", async (_event: SessionTreeEvent, ctx) => {
			await ignoreStaleExtensionContextAsync(() => handleSessionEvent(ctx, this.wiring.onSessionStart));
		});
		this.pi.on("session_shutdown", async (_event, ctx) => {
			await ignoreStaleExtensionContextAsync(() => this.wiring.onSessionShutdown(ctx));
		});

		this.pi.on("agent_end", async (event: AgentEndEvent, ctx) => {
			await ignoreStaleExtensionContextAsync(async () => {
				const branchEntries = ctx.sessionManager.getBranch();
				const branchMessages = branchEntries
					.filter((entry): entry is typeof branchEntries[number] & { type: "message" } => entry.type === "message")
					.map((entry) => entry.message);
				const sourceLeafId = ctx.sessionManager.getLeafId() ?? `turn-${Date.now()}`;
				const turn = buildTurnContext({
					turnId: sourceLeafId,
					sourceLeafId,
					messagesFromPrompt: event.messages,
					branchMessages,
					occurredAt: new Date().toISOString(),
				});
				if (turn) {
					await this.wiring.onAgentEnd(turn, ctx);
					return;
				}

				if (event.messages.length === 0) {
					await this.wiring.onAgentEnd(buildAbortedFallbackTurn(sourceLeafId, branchMessages), ctx);
				}
			});
		});

		this.pi.on("input", async (event: InputEvent, ctx) => {
			await ignoreStaleExtensionContextAsync(() => this.wiring.onUserSubmit(event, ctx));
			return { action: "continue" };
		});

		this.pi.registerCommand("suggesterSettings", {
			description: "Interactive suggester settings menu",
			handler: async (_args, ctx) => {
				await this.wiring.onSettingsUiCommand(ctx);
			},
		});

		this.pi.registerCommand("suggester", {
			description:
				"suggester controls: status | reseed | model | thinking | instruction | variant | ab | config | seed-trace [limit]",
			handler: async (args, ctx) => {
				const trimmed = args.trim();
				const [subcommand, ...rest] = trimmed.length > 0 ? trimmed.split(/\s+/) : ["status"];
				if (subcommand === "reseed") {
					await this.wiring.onReseedCommand(ctx);
					return;
				}
				if (subcommand === "model") {
					await this.wiring.onModelCommand(rest.join(" "), ctx);
					return;
				}
				if (subcommand === "thinking") {
					await this.wiring.onThinkingCommand(rest.join(" "), ctx);
					return;
				}
				if (subcommand === "config") {
					await this.wiring.onConfigCommand(rest.join(" "), ctx);
					return;
				}
				if (subcommand === "instruction") {
					await this.wiring.onInstructionCommand(rest.join(" "), ctx);
					return;
				}
				if (subcommand === "variant") {
					await this.wiring.onVariantCommand(rest.join(" "), ctx);
					return;
				}
				if (subcommand === "ab") {
					await this.wiring.onAbCommand(rest.join(" "), ctx);
					return;
				}
				if (subcommand === "seed-trace") {
					await this.wiring.onSeedTraceCommand(rest.join(" "), ctx);
					return;
				}
				await this.wiring.onStatusCommand(ctx);
			},
		});
	}
}
