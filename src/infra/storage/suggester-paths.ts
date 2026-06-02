import { constants as fsConstants, promises as fs, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const STORAGE_DIR_NAME = "prompt-suggester";
const PROJECTS_DIR_NAME = "projects";

export interface SuggesterStoragePaths {
	rootDir: string;
	userConfigPath: string;
	projectDir: string;
	projectConfigPath: string;
	seedPath: string;
	eventLogPath: string;
	variantsPath: string;
	abResultsPath: string;
	sessionsDir: string;
	legacyProjectDir: string;
	legacyUserConfigPath: string;
}

function canonicalizeCwd(cwd: string): string {
	try {
		return realpathSync(cwd);
	} catch {
		return path.resolve(cwd);
	}
}

function sanitizePathSegment(value: string): string {
	const sanitized = value.trim().replace(/[^A-Za-z0-9._-]/g, "_").replace(/^_+|_+$/g, "");
	return (sanitized || "project").slice(0, 80);
}

export function projectStorageKey(cwd: string): string {
	const canonical = canonicalizeCwd(cwd);
	const name = sanitizePathSegment(path.basename(canonical) || "root");
	const hash = createHash("sha256").update(canonical).digest("hex").slice(0, 12);
	return `${name}-${hash}`;
}

export function suggesterRootDir(agentDir: string = getAgentDir()): string {
	return path.join(agentDir, STORAGE_DIR_NAME);
}

export function projectSuggesterDir(cwd: string, agentDir: string = getAgentDir()): string {
	return path.join(suggesterRootDir(agentDir), PROJECTS_DIR_NAME, projectStorageKey(cwd));
}

export function getSuggesterStoragePaths(
	cwd: string = process.cwd(),
	agentDir: string = getAgentDir(),
	homeDir: string = os.homedir(),
): SuggesterStoragePaths {
	const rootDir = suggesterRootDir(agentDir);
	const projectDir = projectSuggesterDir(cwd, agentDir);
	return {
		rootDir,
		userConfigPath: path.join(rootDir, "config.json"),
		projectDir,
		projectConfigPath: path.join(projectDir, "config.json"),
		seedPath: path.join(projectDir, "seed.json"),
		eventLogPath: path.join(projectDir, "logs", "events.ndjson"),
		variantsPath: path.join(projectDir, "variants.json"),
		abResultsPath: path.join(projectDir, "ab-results.ndjson"),
		sessionsDir: path.join(projectDir, "sessions"),
		legacyProjectDir: path.join(cwd, ".pi", "suggester"),
		legacyUserConfigPath: path.join(homeDir, ".pi", "suggester", "config.json"),
	};
}

async function exists(filePath: string): Promise<boolean> {
	try {
		await fs.access(filePath);
		return true;
	} catch {
		return false;
	}
}

async function copyMissingRecursive(source: string, destination: string): Promise<void> {
	const stat = await fs.lstat(source);
	if (stat.isDirectory()) {
		await fs.mkdir(destination, { recursive: true });
		const entries = await fs.readdir(source);
		for (const entry of entries) {
			await copyMissingRecursive(path.join(source, entry), path.join(destination, entry));
		}
		return;
	}

	if (stat.isSymbolicLink()) {
		try {
			const target = await fs.readlink(source);
			await fs.symlink(target, destination);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
		return;
	}

	await fs.mkdir(path.dirname(destination), { recursive: true });
	try {
		await fs.copyFile(source, destination, fsConstants.COPYFILE_EXCL);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
}

export async function migrateLegacyProjectStorage(
	cwd: string = process.cwd(),
	agentDir: string = getAgentDir(),
): Promise<string | undefined> {
	const paths = getSuggesterStoragePaths(cwd, agentDir);
	if (!(await exists(paths.legacyProjectDir))) return undefined;
	await copyMissingRecursive(paths.legacyProjectDir, paths.projectDir);
	await fs.rm(paths.legacyProjectDir, { recursive: true, force: true });
	return paths.projectDir;
}

export async function migrateLegacyUserConfig(
	agentDir: string = getAgentDir(),
	homeDir: string = os.homedir(),
): Promise<string | undefined> {
	const paths = getSuggesterStoragePaths(process.cwd(), agentDir, homeDir);
	if (!(await exists(paths.legacyUserConfigPath))) return undefined;
	await fs.mkdir(path.dirname(paths.userConfigPath), { recursive: true });
	try {
		await fs.copyFile(paths.legacyUserConfigPath, paths.userConfigPath, fsConstants.COPYFILE_EXCL);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
	await fs.rm(paths.legacyUserConfigPath, { force: true });
	try {
		await fs.rmdir(path.dirname(paths.legacyUserConfigPath));
	} catch {
		// Leave the legacy directory in place if it contains anything else.
	}
	return paths.userConfigPath;
}
