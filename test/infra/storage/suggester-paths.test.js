import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import {
	getSuggesterStoragePaths,
	migrateLegacyProjectStorage,
	migrateLegacyUserConfig,
} from "../../../dist/infra/storage/suggester-paths.js";

test("suggester paths live under pi agent dir and are keyed by project", async () => {
	const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-suggester-project-"));
	const agentDir = await mkdtemp(path.join(os.tmpdir(), "pi-agent-dir-"));
	const paths = getSuggesterStoragePaths(cwd, agentDir);

	assert.equal(paths.rootDir, path.join(agentDir, "prompt-suggester"));
	assert.equal(paths.projectDir.startsWith(path.join(agentDir, "prompt-suggester", "projects")), true);
	assert.equal(paths.seedPath, path.join(paths.projectDir, "seed.json"));
	assert.equal(paths.eventLogPath, path.join(paths.projectDir, "logs", "events.ndjson"));
	assert.equal(paths.legacyProjectDir, path.join(cwd, ".pi", "suggester"));
});

test("legacy project storage migrates out of workspace", async () => {
	const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-suggester-project-"));
	const agentDir = await mkdtemp(path.join(os.tmpdir(), "pi-agent-dir-"));
	const paths = getSuggesterStoragePaths(cwd, agentDir);
	await mkdir(path.join(paths.legacyProjectDir, "logs"), { recursive: true });
	await writeFile(path.join(paths.legacyProjectDir, "seed.json"), JSON.stringify({ ok: true }), "utf8");
	await writeFile(path.join(paths.legacyProjectDir, "logs", "events.ndjson"), "{}\n", "utf8");

	const migratedTo = await migrateLegacyProjectStorage(cwd, agentDir);

	assert.equal(migratedTo, paths.projectDir);
	assert.equal(JSON.parse(await readFile(paths.seedPath, "utf8")).ok, true);
	assert.equal(await readFile(paths.eventLogPath, "utf8"), "{}\n");
	await assert.rejects(() => stat(paths.legacyProjectDir), /ENOENT/);
});

test("legacy user config migrates to pi agent dir", async () => {
	const homeDir = await mkdtemp(path.join(os.tmpdir(), "pi-home-"));
	const agentDir = path.join(homeDir, ".pi", "agent");
	const paths = getSuggesterStoragePaths(process.cwd(), agentDir, homeDir);
	await mkdir(path.dirname(paths.legacyUserConfigPath), { recursive: true });
	await writeFile(paths.legacyUserConfigPath, JSON.stringify({ suggestion: { maxSuggestionChars: 123 } }), "utf8");

	const migratedTo = await migrateLegacyUserConfig(agentDir, homeDir);

	assert.equal(migratedTo, paths.userConfigPath);
	assert.equal(JSON.parse(await readFile(paths.userConfigPath, "utf8")).suggestion.maxSuggestionChars, 123);
	await assert.rejects(() => stat(paths.legacyUserConfigPath), /ENOENT/);
});
