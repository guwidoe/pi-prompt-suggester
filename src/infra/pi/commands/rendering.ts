import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { LoggedEvent } from "../../../app/ports/event-log.js";
import type { AppComposition } from "../../../composition/root.js";
import type { PromptSuggesterConfig } from "../../../config/types.js";
import { formatTokens } from "../display.js";
import { asString, modelToRef, summarizeInstruction } from "./shared.js";

export function renderSeedTrace(events: LoggedEvent[]): string {
	if (events.length === 0) {
		return "Suggester seed trace\n- no seeder events found in persistent logs.";
	}

	const withRunId = events.filter((event) => typeof event.meta?.runId === "string");
	const latestRunId = asString(withRunId.at(-1)?.meta?.runId);
	const scoped = latestRunId ? events.filter((event) => event.meta?.runId === latestRunId) : events;
	const lines = scoped.slice(-80).map((event) => {
		const time = event.at.split("T")[1]?.replace("Z", "") ?? event.at;
		const run = asString(event.meta?.runId);
		const step = event.meta?.step;
		const reason = asString(event.meta?.reason);
		const tool = asString(event.meta?.tool);
		const preview = asString(event.meta?.toolResultPreview) ?? asString(event.meta?.modelResponsePreview);
		const detailBits = [
			run ? `run=${run}` : undefined,
			step !== undefined ? `step=${step}` : undefined,
			tool ? `tool=${tool}` : undefined,
			reason ? `reason=${reason}` : undefined,
		].filter(Boolean);
		const detail = detailBits.length > 0 ? ` (${detailBits.join(", ")})` : "";
		const previewSuffix = preview ? ` | ${preview.slice(0, 180)}` : "";
		return `- ${time} ${event.message}${detail}${previewSuffix}`;
	});

	return [
		"Suggester seed trace",
		`- events shown: ${lines.length}`,
		latestRunId ? `- latest run: ${latestRunId}` : "- latest run: (unknown)",
		"- log file: .pi/suggester/logs/events.ndjson",
		...lines,
	].join("\n");
}

export function renderStatus(
	seed: Awaited<ReturnType<AppComposition["stores"]["seedStore"]["load"]>>,
	state: Awaited<ReturnType<AppComposition["stores"]["stateStore"]["load"]>>,
	config: PromptSuggesterConfig,
	ctx?: ExtensionContext,
	activeVariantName?: string,
): string {
	const steeringSummary = {
		exact: state.steeringHistory.filter((event) => event.classification === "accepted_exact").length,
		edited: state.steeringHistory.filter((event) => event.classification === "accepted_edited").length,
		changed: state.steeringHistory.filter((event) => event.classification === "changed_course").length,
	};
	const activeModel = modelToRef(ctx?.model);
	const combinedInput = state.suggestionUsage.inputTokens + state.seederUsage.inputTokens;
	const combinedOutput = state.suggestionUsage.outputTokens + state.seederUsage.outputTokens;
	const combinedCacheRead = state.suggestionUsage.cacheReadTokens + state.seederUsage.cacheReadTokens;
	const combinedCost = state.suggestionUsage.costTotal + state.seederUsage.costTotal;
	const suggesterPromptTokens = state.suggestionUsage.last?.inputTokens ?? 0;
	const compactUsageLine = `suggester usage: ↑${formatTokens(combinedInput)} ↓${formatTokens(combinedOutput)} R${formatTokens(combinedCacheRead)} $${combinedCost.toFixed(3)} (${state.suggestionUsage.calls} sugg, ${state.seederUsage.calls} seed), last suggester prompt: ${formatTokens(suggesterPromptTokens)} tok`;

	return [
		"Suggester status",
		`- seed: ${seed ? `present (${seed.generatedAt})` : "missing"}`,
		`- key files: ${seed?.keyFiles.map((file) => `${file.path} [${file.category}]`).join(", ") || "(none)"}`,
		`- last reseed reason: ${seed?.lastReseedReason ?? "(none)"}`,
		`- implementation status: ${seed?.implementationStatusSummary?.slice(0, 140) ?? "(none)"}`,
		`- active session model: ${activeModel}`,
		`- config schemaVersion: ${config.schemaVersion}`,
		`- active variant: ${activeVariantName ?? "default"}`,
		`- custom instruction: ${summarizeInstruction(config.suggestion.customInstruction)}`,
		`- suggestion strategy: ${config.suggestion.strategy}`,
		`- steering transcript guardrails: ctx<=${config.suggestion.transcriptMaxContextPercent}% msgs<=${config.suggestion.transcriptMaxMessages} chars<=${config.suggestion.transcriptMaxChars} rollout=${config.suggestion.transcriptRolloutPercent}%`,
		"- local experiment controls: /suggesterSettings → strategy / variants / transcript guardrails",
		`- models (config): seeder=${config.inference.seederModel}, suggester=${config.inference.suggesterModel}`,
		`- thinking (config): seeder=${config.inference.seederThinking}, suggester=${config.inference.suggesterThinking}`,
		`- ${compactUsageLine}`,
		`- logs: .pi/suggester/logs/events.ndjson (use /suggester seed-trace)`,
		`- last suggestion: ${state.lastSuggestion?.text ?? "(none)"}`,
		`- steering history: exact=${steeringSummary.exact}, edited=${steeringSummary.edited}, changed=${steeringSummary.changed}`,
	].join("\n");
}
