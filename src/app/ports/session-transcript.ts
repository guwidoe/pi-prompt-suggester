import type { Message } from "@earendil-works/pi-ai";

export interface ActiveSessionTranscript {
	systemPrompt: string;
	messages: Message[];
	contextUsagePercent?: number;
	sessionId?: string;
}

export interface SessionTranscriptProvider {
	getActiveTranscript(): ActiveSessionTranscript | undefined;
}
