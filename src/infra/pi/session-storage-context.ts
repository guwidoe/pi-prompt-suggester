import path from "node:path";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { ROOT_STATE_KEY, type SessionReadableManager, type SessionStorageContext } from "./session-state-types.js";

export function normalizeSessionKey(value: string): string {
	return value.replace(/[^A-Za-z0-9._-]/g, "_");
}

export function stateFilePath(interactionDir: string, key: string): string {
	return path.join(interactionDir, `${normalizeSessionKey(key)}.json`);
}

export function createSessionStorageContext(
	cwd: string,
	sessionManager: SessionReadableManager,
): SessionStorageContext {
	const sessionId = normalizeSessionKey(sessionManager.getSessionId());
	const sessionFile = sessionManager.getSessionFile();
	const branch = sessionManager.getBranch();
	const lookupKeys = branch.map((entry: SessionEntry) => entry.id).reverse();
	lookupKeys.push(ROOT_STATE_KEY);
	const currentKey = sessionManager.getLeafId() ?? ROOT_STATE_KEY;
	if (!sessionFile) {
		return {
			sessionId,
			sessionFile,
			lookupKeys,
			currentKey,
			persistent: false,
		};
	}

	const storageDir = path.join(cwd, ".pi", "suggester", "sessions", sessionId);
	return {
		sessionId,
		sessionFile,
		storageDir,
		interactionDir: path.join(storageDir, "interaction"),
		usageFile: path.join(storageDir, "usage.json"),
		metaFile: path.join(storageDir, "meta.json"),
		lookupKeys,
		currentKey,
		persistent: true,
	};
}
