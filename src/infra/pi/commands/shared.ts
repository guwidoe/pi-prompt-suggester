import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ThinkingLevel } from "../../../config/types.js";

export type ModelRole = "seeder" | "suggester";
export type ConfigScope = "project" | "user";

export const THINKING_LEVELS: ThinkingLevel[] = ["minimal", "low", "medium", "high", "xhigh"];
export const MODEL_ROLES: ModelRole[] = ["seeder", "suggester"];
export const SESSION_DEFAULT = "session-default";

export function modelToRef(model: Model<any> | undefined): string {
	if (!model) return "(none)";
	return `${model.provider}/${model.id}`;
}

export function parseRole(token: string | undefined): ModelRole | undefined {
	if (!token) return undefined;
	return MODEL_ROLES.find((role) => role === (token.trim().toLowerCase() as ModelRole));
}

export function resolveModelRef(
	models: Model<any>[],
	raw: string,
): { ok: true; canonicalRef: string } | { ok: false; reason: string } {
	const value = raw.trim();
	if (!value) return { ok: false, reason: "Model reference is empty" };
	if (value === SESSION_DEFAULT) return { ok: true, canonicalRef: SESSION_DEFAULT };
	if (value.includes("/")) {
		const [provider, ...rest] = value.split("/");
		const id = rest.join("/");
		const match = models.find((model) => model.provider === provider && model.id === id);
		if (!match) return { ok: false, reason: `Model not found: ${value}` };
		return { ok: true, canonicalRef: `${match.provider}/${match.id}` };
	}

	const matches = models.filter((model) => model.id === value);
	if (matches.length === 0) return { ok: false, reason: `No model with id '${value}' found` };
	if (matches.length > 1) {
		return {
			ok: false,
			reason: `Model id '${value}' is ambiguous. Use provider/id. Matches: ${matches
				.slice(0, 6)
				.map((model) => `${model.provider}/${model.id}`)
				.join(", ")}`,
		};
	}
	const match = matches[0];
	return { ok: true, canonicalRef: `${match.provider}/${match.id}` };
}

export async function getModelSelectionOptions(ctx: ExtensionContext | ExtensionCommandContext): Promise<string[]> {
	const refs = new Set<string>();
	for (const model of await ctx.modelRegistry.getAvailable()) {
		refs.add(`${model.provider}/${model.id}`);
	}
	return [SESSION_DEFAULT, ...Array.from(refs).sort((a, b) => a.localeCompare(b))];
}

export function parsePositiveInt(value: string | undefined, fallback: number): number {
	if (!value) return fallback;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return parsed;
}

export function asString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	return value;
}

export function summarizeInstruction(value: string): string {
	const trimmed = value.trim();
	if (!trimmed) return "(none)";
	return trimmed.replace(/\s+/g, " ").slice(0, 80);
}

export function parseConfigScope(token: string | undefined): ConfigScope | undefined {
	if (!token) return undefined;
	if (token === "project" || token === "user") return token;
	return undefined;
}

export function parseConfigValue(raw: string): unknown {
	const trimmed = raw.trim();
	if (!trimmed) {
		throw new Error("Missing config value.");
	}

	try {
		return JSON.parse(trimmed);
	} catch {
		if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length >= 2) {
			return trimmed.slice(1, -1);
		}
		return trimmed;
	}
}

export function setPathValue(target: Record<string, unknown>, pathSegments: string[], value: unknown): void {
	let cursor: Record<string, unknown> = target;
	for (let index = 0; index < pathSegments.length - 1; index += 1) {
		const segment = pathSegments[index];
		const existing = cursor[segment];
		if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
			cursor[segment] = {};
		}
		cursor = cursor[segment] as Record<string, unknown>;
	}
	cursor[pathSegments[pathSegments.length - 1]] = value;
}
