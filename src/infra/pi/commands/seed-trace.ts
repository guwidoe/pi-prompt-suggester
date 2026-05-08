import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AppComposition } from "../../../composition/root.js";
import { renderSeedTrace } from "./rendering.js";
import { parsePositiveInt } from "./shared.js";

export async function handleSeedTraceCommand(
	args: string,
	pi: ExtensionAPI,
	composition: AppComposition,
): Promise<void> {
	const limit = parsePositiveInt(args.trim() || undefined, 240);
	const events = await composition.eventLog.readRecent(limit, { messagePrefix: "seeder." });
	pi.sendMessage(
		{
			customType: "prompt-suggester-seed-trace",
			content: renderSeedTrace(events),
			display: true,
		},
		{ triggerTurn: false },
	);
}
