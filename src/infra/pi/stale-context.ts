const STALE_EXTENSION_CONTEXT_MARKER = "extension ctx is stale after session replacement or reload";

export function isStaleExtensionContextError(error: unknown): boolean {
	return error instanceof Error && error.message.includes(STALE_EXTENSION_CONTEXT_MARKER);
}

export function ignoreStaleExtensionContext(run: () => void): void {
	try {
		run();
	} catch (error) {
		if (isStaleExtensionContextError(error)) return;
		throw error;
	}
}

export async function ignoreStaleExtensionContextAsync(run: () => Promise<void>): Promise<void> {
	try {
		await run();
	} catch (error) {
		if (isStaleExtensionContextError(error)) return;
		throw error;
	}
}
