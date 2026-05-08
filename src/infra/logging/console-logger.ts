import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { EventLog } from "../../app/ports/event-log.js";
import type { Logger } from "../../app/ports/logger.js";
import { isStaleExtensionContextError } from "../pi/stale-context.js";

type Level = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<Level, number> = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

function truncate(value: string, maxChars: number): string {
	if (value.length <= maxChars) return value;
	return `${value.slice(0, maxChars)}…`;
}

export interface ConsoleLoggerOptions {
	getContext?: () => ExtensionContext | undefined;
	statusKey?: string;
	mirrorToConsoleWhenNoUi?: boolean;
	eventLog?: EventLog;
	setWidgetLogStatus?: (status: { level: Level; text: string } | undefined) => void;
}

export class ConsoleLogger implements Logger {
	private readonly statusKey: string;
	private readonly mirrorToConsoleWhenNoUi: boolean;

	public constructor(
		private readonly level: Level = "info",
		private readonly options: ConsoleLoggerOptions = {},
	) {
		this.statusKey = options.statusKey ?? "suggester-log";
		this.mirrorToConsoleWhenNoUi = options.mirrorToConsoleWhenNoUi ?? true;
	}

	public debug(message: string, meta?: Record<string, unknown>): void {
		this.log("debug", message, meta);
	}

	public info(message: string, meta?: Record<string, unknown>): void {
		this.log("info", message, meta);
	}

	public warn(message: string, meta?: Record<string, unknown>): void {
		this.log("warn", message, meta);
	}

	public error(message: string, meta?: Record<string, unknown>): void {
		this.log("error", message, meta);
	}

	private log(level: Level, message: string, meta?: Record<string, unknown>): void {
		if (this.options.eventLog) {
			void this.options.eventLog
				.append({
					at: new Date().toISOString(),
					level,
					message,
					meta,
				})
				.catch(() => undefined);
		}
		if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
		const payload = meta && Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : "";
		const line = truncate(`[suggester ${level}] ${message}${payload}`, 220);
		const statusLine = truncate(`[suggester ${level}] ${message}`, 120);
		try {
			const ctx = this.options.getContext?.();
			this.options.setWidgetLogStatus?.(level === "warn" || level === "error" ? { level, text: statusLine } : undefined);
			if (ctx?.hasUI && !this.options.setWidgetLogStatus) {
				const theme = ctx.ui.theme;
				const colorized =
					level === "error"
						? theme.fg("error", statusLine)
						: level === "warn"
							? theme.fg("warning", statusLine)
							: level === "debug"
								? theme.fg("dim", statusLine)
								: theme.fg("muted", statusLine);
				ctx.ui.setStatus(this.statusKey, colorized);
				return;
			}
		} catch (error) {
			if (!isStaleExtensionContextError(error)) throw error;
			return;
		}

		if (!this.mirrorToConsoleWhenNoUi) return;
		if (level === "error") console.error(line);
		else if (level === "warn") console.warn(line);
		else console.log(line);
	}
}
