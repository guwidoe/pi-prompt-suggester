import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AppComposition } from "../../../composition/root.js";
import type { PromptSuggesterConfig, ThinkingLevel } from "../../../config/types.js";
import { SuggesterConfigPersistence } from "./config-persistence.js";
import { parseRole, resolveModelRef, SESSION_DEFAULT, THINKING_LEVELS } from "./shared.js";
import { showModelSelector } from "./model-selector.js";

async function applyInferenceConfigChange(
	ctx: ExtensionCommandContext,
	composition: AppComposition,
	key: keyof PromptSuggesterConfig["inference"],
	value: string,
): Promise<void> {
	await new SuggesterConfigPersistence(ctx, composition).writeValue("project", `inference.${key}`, value);
	ctx.ui.notify(`suggester config updated: inference.${key}=${value}`, "info");
}

export async function handleModelCommand(
	args: string,
	ctx: ExtensionCommandContext,
	composition: AppComposition,
): Promise<void> {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0 || tokens[0] === "show") {
		ctx.ui.notify(
			`suggester models (config): seeder=${composition.config.inference.seederModel}, suggester=${composition.config.inference.suggesterModel}`,
			"info",
		);
		return;
	}

	let action: "set" | "clear" = "set";
	if (tokens[0] === "set" || tokens[0] === "clear") {
		action = tokens[0] as "set" | "clear";
		tokens.shift();
	}

	const role = parseRole(tokens[0]);
	if (!role) {
		ctx.ui.notify(
			"Usage: /suggester model [show] | [set] <seeder|suggester> <provider/model|model-id|session-default> | clear <seeder|suggester>",
			"error",
		);
		return;
	}

	const key = role === "seeder" ? "seederModel" : "suggesterModel";
	if (action === "clear" || (tokens[1] ?? "").toLowerCase() === "clear") {
		await applyInferenceConfigChange(ctx, composition, key, SESSION_DEFAULT);
		return;
	}

	let rawModelRef = tokens.slice(1).join(" ").trim();
	if (!rawModelRef) {
		if (!ctx.hasUI) {
			ctx.ui.notify("Missing model reference.", "error");
			return;
		}
		const selected = await showModelSelector(ctx, {
			title: `Select ${role} model`,
			currentValue: composition.config.inference[key],
			specialOptions: [{ value: SESSION_DEFAULT, description: "Use the current session model" }],
		});
		if (!selected) return;
		rawModelRef = selected;
	}
	const resolved = resolveModelRef(ctx.modelRegistry.getAll(), rawModelRef);
	if (!resolved.ok) {
		ctx.ui.notify(resolved.reason, "error");
		return;
	}

	await applyInferenceConfigChange(ctx, composition, key, resolved.canonicalRef);
}

export async function handleThinkingCommand(
	args: string,
	ctx: ExtensionCommandContext,
	composition: AppComposition,
): Promise<void> {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0 || tokens[0] === "show") {
		ctx.ui.notify(
			`suggester thinking (config): seeder=${composition.config.inference.seederThinking}, suggester=${composition.config.inference.suggesterThinking}`,
			"info",
		);
		return;
	}

	let action: "set" | "clear" = "set";
	if (tokens[0] === "set" || tokens[0] === "clear") {
		action = tokens[0] as "set" | "clear";
		tokens.shift();
	}

	const role = parseRole(tokens[0]);
	if (!role) {
		ctx.ui.notify(
			"Usage: /suggester thinking [show] | [set] <seeder|suggester> <minimal|low|medium|high|xhigh|session-default> | clear <seeder|suggester>",
			"error",
		);
		return;
	}

	const key = role === "seeder" ? "seederThinking" : "suggesterThinking";
	if (action === "clear" || (tokens[1] ?? "").toLowerCase() === "clear") {
		await applyInferenceConfigChange(ctx, composition, key, SESSION_DEFAULT);
		return;
	}

	const rawLevel = tokens[1]?.trim().toLowerCase();
	if (!rawLevel || ![...THINKING_LEVELS, SESSION_DEFAULT].includes(rawLevel as ThinkingLevel | typeof SESSION_DEFAULT)) {
		ctx.ui.notify("Thinking level must be one of: minimal, low, medium, high, xhigh, session-default", "error");
		return;
	}

	await applyInferenceConfigChange(ctx, composition, key, rawLevel);
}
