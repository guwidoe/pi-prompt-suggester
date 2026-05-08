import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { AppComposition } from "../../../composition/root.js";
import { FileConfigLoader } from "../../../config/loader.js";
import { readObjectJsonIfExists, writeJson } from "../../storage/json-file.js";
import type { ConfigScope } from "./shared.js";
import { setPathValue } from "./shared.js";

export function projectOverridePath(cwd: string): string {
	return path.join(cwd, ".pi", "suggester", "config.json");
}

export function userOverridePath(homeDir: string = os.homedir()): string {
	return path.join(homeDir, ".pi", "suggester", "config.json");
}

export class SuggesterConfigPersistence {
	public constructor(
		private readonly ctx: ExtensionCommandContext,
		private readonly composition: AppComposition,
	) {}

	public overridePathForScope(scope: ConfigScope): string {
		return scope === "user" ? userOverridePath() : projectOverridePath(this.ctx.cwd);
	}

	public async refreshCompositionConfig(): Promise<void> {
		const next = await new FileConfigLoader(this.ctx.cwd).load();
		Object.assign(this.composition.config, next);
	}

	public async readOverride(scope: ConfigScope): Promise<Record<string, unknown>> {
		return await readObjectJsonIfExists(this.overridePathForScope(scope));
	}

	public async readOverrideValue(scope: ConfigScope, configPath: string): Promise<unknown> {
		const raw = await this.readOverride(scope);
		let cursor: unknown = raw;
		for (const segment of configPath.split(".").map((part) => part.trim()).filter(Boolean)) {
			if (!cursor || typeof cursor !== "object" || Array.isArray(cursor) || !(segment in cursor)) {
				return undefined;
			}
			cursor = (cursor as Record<string, unknown>)[segment];
		}
		return cursor;
	}

	public async readOverrideCustomInstruction(scope: ConfigScope): Promise<string> {
		const value = await this.readOverrideValue(scope, "suggestion.customInstruction");
		return typeof value === "string" ? value : "";
	}

	public async writeValue(scope: ConfigScope, configPath: string, value: unknown): Promise<void> {
		const filePath = this.overridePathForScope(scope);
		let previousRaw: string | undefined;
		try {
			previousRaw = await fs.readFile(filePath, "utf8");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw new Error(`Failed to read config override ${filePath}: ${(error as Error).message}`);
			}
		}

		let current: Record<string, unknown> = {};
		if (previousRaw !== undefined) {
			try {
				const parsed = JSON.parse(previousRaw);
				if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
					current = parsed as Record<string, unknown>;
				} else {
					throw new Error(`Override config ${filePath} must be a JSON object.`);
				}
			} catch (error) {
				throw new Error(`Failed to parse config override ${filePath}: ${(error as Error).message}`);
			}
		}

		const next: Record<string, unknown> = JSON.parse(JSON.stringify(current));
		setPathValue(
			next,
			configPath
				.split(".")
				.map((segment) => segment.trim())
				.filter(Boolean),
			value,
		);

		try {
			await writeJson(filePath, next);
			await this.refreshCompositionConfig();
		} catch (error) {
			try {
				if (previousRaw === undefined) {
					await fs.rm(filePath, { force: true });
				} else {
					await fs.mkdir(path.dirname(filePath), { recursive: true });
					await fs.writeFile(filePath, previousRaw, "utf8");
				}
			} catch {
				// Best-effort rollback only.
			}
			throw new Error(`Failed to apply config change: ${(error as Error).message}`);
		}
	}

	public async resetScopes(scopes: ConfigScope[]): Promise<string[]> {
		const removed: string[] = [];
		for (const scope of scopes) {
			const target = this.overridePathForScope(scope);
			try {
				await fs.rm(target, { force: true });
				removed.push(target);
			} catch (error) {
				throw new Error(`Failed to reset config at ${target}: ${(error as Error).message}`);
			}
		}
		await this.refreshCompositionConfig();
		return removed;
	}
}
