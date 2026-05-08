import type { SessionTranscriptProvider } from "../../app/ports/session-transcript.js";
import type { RuntimeContextProvider } from "../model/pi-model-client.js";
import { buildSessionContext, type SessionContext, type SessionEntry } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";

function cloneMessages(messages: Message[]): Message[] {
	return JSON.parse(JSON.stringify(messages)) as Message[];
}

type SessionManagerWithContext = {
	getLeafId(): string | null;
	getBranch(fromId?: string): SessionEntry[];
	getSessionId(): string;
	buildSessionContext?: () => SessionContext;
};

export class PiSessionTranscriptProvider implements SessionTranscriptProvider {
	public constructor(private readonly runtime: RuntimeContextProvider) {}

	public getActiveTranscript() {
		const ctx = this.runtime.getContext();
		if (!ctx) return undefined;
		const sessionManager = ctx.sessionManager as SessionManagerWithContext;
		const transcript = typeof sessionManager.buildSessionContext === "function"
			? sessionManager.buildSessionContext()
			: buildSessionContext(
				ctx.sessionManager.getBranch(ctx.sessionManager.getLeafId() ?? undefined) as SessionEntry[],
				ctx.sessionManager.getLeafId() ?? undefined,
			);
		const systemPrompt = ctx.getSystemPrompt().trim();
		if (!systemPrompt) return undefined;
		return {
			systemPrompt,
			messages: cloneMessages(transcript.messages as Message[]),
			contextUsagePercent: ctx.getContextUsage()?.percent ?? undefined,
			sessionId: ctx.sessionManager.getSessionId(),
		};
	}
}
