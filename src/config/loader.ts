import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { fileURLToPath } from "node:url";
import { readJsonIfExists, writeJson } from "../infra/storage/json-file.js";
import { getSuggesterStoragePaths, migrateLegacyProjectStorage, migrateLegacyUserConfig } from "../infra/storage/suggester-paths.js";
import type { PromptSuggesterConfig } from "./types.js";
import { normalizeConfig, normalizeOverrideConfig, validateConfig } from "./schema.js";

export interface ConfigLoader {
	load(): Promise<PromptSuggesterConfig>;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T>(base: T, override: unknown): T {
	if (!isObject(base) || !isObject(override)) {
		return (override as T) ?? base;
	}

	const result: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(override)) {
		const existing = result[key];
		if (isObject(existing) && isObject(value)) {
			result[key] = deepMerge(existing, value);
		} else if (value !== undefined) {
			result[key] = value;
		}
	}
	return result as T;
}

async function readOverrideConfig(
	filePath: string,
	defaultConfig: PromptSuggesterConfig,
): Promise<Record<string, unknown> | undefined> {
	let parsed: unknown;
	try {
		parsed = await readJsonIfExists(filePath);
	} catch (error) {
		throw new Error(`Failed to load config ${filePath}: ${(error as Error).message}`);
	}
	if (parsed === undefined) return undefined;

	const normalized = normalizeOverrideConfig(parsed, defaultConfig);
	if (normalized.changed) {
		await writeJson(filePath, normalized.config);
	}
	return normalized.config;
}

async function readRequiredConfig(filePath: string): Promise<PromptSuggesterConfig> {
	let parsed: unknown;
	try {
		const raw = await fs.readFile(filePath, "utf8");
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(`Failed to load required default config ${filePath}: ${(error as Error).message}`);
	}

	if (!validateConfig(parsed)) {
		throw new Error(`Default config at ${filePath} is invalid.`);
	}
	return parsed;
}

const PACKAGE_DEFAULT_CONFIG_PATH = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../config/prompt-suggester.config.json",
);

async function pathExists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

export class FileConfigLoader implements ConfigLoader {
	public constructor(
		private readonly cwd: string = process.cwd(),
		private readonly agentDir: string = getAgentDir(),
		private readonly homeDir: string = os.homedir(),
	) {}

	public async load(): Promise<PromptSuggesterConfig> {
		await Promise.all([
			migrateLegacyProjectStorage(this.cwd, this.agentDir),
			migrateLegacyUserConfig(this.agentDir, this.homeDir),
		]);
		const storagePaths = getSuggesterStoragePaths(this.cwd, this.agentDir, this.homeDir);
		const cwdDefaultPath = path.join(this.cwd, "config", "prompt-suggester.config.json");
		const defaultPath = (await pathExists(cwdDefaultPath)) ? cwdDefaultPath : PACKAGE_DEFAULT_CONFIG_PATH;
		const userPath = storagePaths.userConfigPath;
		const projectPath = storagePaths.projectConfigPath;

		const defaultConfig = await readRequiredConfig(defaultPath);
		const [userConfig, projectConfig] = await Promise.all([
			readOverrideConfig(userPath, defaultConfig),
			readOverrideConfig(projectPath, defaultConfig),
		]);
		const merged = deepMerge(deepMerge(defaultConfig, userConfig), projectConfig);
		const normalized = normalizeConfig(merged, defaultConfig);

		if (!validateConfig(normalized.config)) {
			throw new Error(
				`Failed to normalize suggester config. Base defaults from ${defaultPath}; overrides from ${userPath} and ${projectPath}.`,
			);
		}
		return normalized.config;
	}
}
