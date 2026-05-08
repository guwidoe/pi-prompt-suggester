import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { GhostAcceptKey } from "../../config/types.js";

export const DEFAULT_GHOST_ACCEPT_KEYS: readonly GhostAcceptKey[] = ["space"];

function isGhostAcceptKey(value: unknown): value is GhostAcceptKey {
	return value === "space" || value === "right";
}

export function normalizeGhostAcceptKeys(ghostAcceptKeys: readonly GhostAcceptKey[] | undefined): GhostAcceptKey[] {
	const normalized = (ghostAcceptKeys ?? DEFAULT_GHOST_ACCEPT_KEYS).filter((entry): entry is GhostAcceptKey => isGhostAcceptKey(entry));
	return normalized.length > 0 ? [...new Set(normalized)] : [...DEFAULT_GHOST_ACCEPT_KEYS];
}

export function matchesGhostAcceptKey(data: string, ghostAcceptKeys: readonly GhostAcceptKey[] | undefined): boolean {
	return normalizeGhostAcceptKeys(ghostAcceptKeys).some((key) => {
		if (key === "space") return matchesKey(data, Key.space);
		return matchesKey(data, Key.right);
	});
}

export function formatGhostAcceptKeys(ghostAcceptKeys: readonly GhostAcceptKey[] | undefined): string {
	return normalizeGhostAcceptKeys(ghostAcceptKeys)
		.map((key) => key === "space" ? "Space" : "Right")
		.join("/");
}
