import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AppComposition } from "../../../composition/root.js";
import { projectOverridePath, SuggesterConfigPersistence, userOverridePath } from "./config-persistence.js";
import { parseConfigScope, parseConfigValue, summarizeInstruction } from "./shared.js";

export async function handleInstructionCommand(
	args: string,
	ctx: ExtensionCommandContext,
	composition: AppComposition,
): Promise<void> {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	const persistence = new SuggesterConfigPersistence(ctx, composition);
	if (tokens.length === 0 || tokens[0] === "show") {
		ctx.ui.notify(
			[
				"suggester custom instruction",
				`- effective value: ${summarizeInstruction(composition.config.suggestion.customInstruction)}`,
				`- project override: ${projectOverridePath(ctx.cwd)}`,
				`- user override: ${userOverridePath()}`,
				"- edit in TUI: /suggesterSettings → Custom instruction",
				"- edit by command: /suggester instruction set [project|user]",
				"- clear: /suggester instruction clear [project|user]",
			].join("\n"),
			"info",
		);
		return;
	}

	const action = tokens[0]?.toLowerCase();
	const scope = parseConfigScope(tokens[1]?.toLowerCase()) ?? "project";
	if (action !== "set" && action !== "clear") {
		ctx.ui.notify("Usage: /suggester instruction [show|set [project|user]|clear [project|user]]", "error");
		return;
	}

	if (action === "clear") {
		await persistence.writeValue(scope, "suggestion.customInstruction", "");
		ctx.ui.notify(`Cleared custom instruction in ${scope} override.`, "info");
		return;
	}

	const initialValue = scope === "project"
		? composition.config.suggestion.customInstruction
		: await persistence.readOverrideCustomInstruction(scope);
	const next = await ctx.ui.editor(
		`Custom suggester instruction (${scope} override)`,
		initialValue,
	);
	if (next === undefined) {
		ctx.ui.notify("Custom instruction edit canceled.", "info");
		return;
	}

	await persistence.writeValue(scope, "suggestion.customInstruction", next);
	ctx.ui.notify(
		next.trim()
			? `Updated custom instruction in ${scope} override.`
			: `Cleared custom instruction in ${scope} override.`,
		"info",
	);
}

export async function handleConfigCommand(
	args: string,
	ctx: ExtensionCommandContext,
	composition: AppComposition,
): Promise<void> {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	const persistence = new SuggesterConfigPersistence(ctx, composition);
	if (tokens.length === 0 || tokens[0] === "show") {
		ctx.ui.notify(
			[
				"suggester config",
				`- effective schemaVersion=${composition.config.schemaVersion}`,
				`- project override: ${projectOverridePath(ctx.cwd)}`,
				`- user override: ${userOverridePath()}`,
				"- set value: /suggester config set [project|user] <path> <json-or-string>",
				"- reset to defaults: /suggester config reset [project|user|all]",
			].join("\n"),
			"info",
		);
		return;
	}

	if (tokens[0] === "set") {
		let index = 1;
		const parsedScope = parseConfigScope(tokens[index]?.toLowerCase());
		const scope = parsedScope ?? "project";
		if (parsedScope) index += 1;

		const configPath = tokens[index]?.trim();
		if (!configPath) {
			ctx.ui.notify(
				"Usage: /suggester config set [project|user] <path> <json-or-string>",
				"error",
			);
			return;
		}
		if (configPath === "schemaVersion" || configPath.startsWith("schemaVersion.")) {
			ctx.ui.notify("schemaVersion is managed automatically and cannot be set manually.", "error");
			return;
		}

		const pathSegments = configPath
			.split(".")
			.map((segment) => segment.trim())
			.filter(Boolean);
		if (pathSegments.length === 0) {
			ctx.ui.notify("Config path is invalid.", "error");
			return;
		}

		const rawValue = tokens.slice(index + 1).join(" ");
		let parsedValue: unknown;
		try {
			parsedValue = parseConfigValue(rawValue);
		} catch (error) {
			ctx.ui.notify((error as Error).message, "error");
			return;
		}

		try {
			await persistence.writeValue(scope, configPath, parsedValue);
		} catch (error) {
			ctx.ui.notify((error as Error).message, "error");
			return;
		}

		ctx.ui.notify(
			`suggester config updated (${scope}): ${configPath}=${JSON.stringify(parsedValue)}`,
			"info",
		);
		return;
	}

	if (tokens[0] !== "reset") {
		ctx.ui.notify(
			"Usage: /suggester config [show|set [project|user] <path> <json-or-string>|reset [project|user|all]]",
			"error",
		);
		return;
	}

	const scopeToken = tokens[1]?.toLowerCase();
	const singleScope = parseConfigScope(scopeToken);
	const targets =
		scopeToken === "all"
			? (["project", "user"] as const)
			: singleScope
				? [singleScope]
				: scopeToken
					? undefined
					: (["project"] as const);
	if (!targets) {
		ctx.ui.notify("Usage: /suggester config reset [project|user|all]", "error");
		return;
	}

	let removed: string[];
	try {
		removed = await persistence.resetScopes([...targets]);
	} catch (error) {
		ctx.ui.notify((error as Error).message, "error");
		return;
	}

	ctx.ui.notify(
		[
			"suggester config reset to defaults",
			`- removed overrides: ${removed.join(", ")}`,
			`- effective schemaVersion=${composition.config.schemaVersion}`,
		].join("\n"),
		"info",
	);
}
