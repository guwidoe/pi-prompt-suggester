import { CustomEditor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { GhostAcceptKey } from "../../config/types.js";
import { matchesGhostAcceptKey } from "./ghost-accept-keys.js";
import type { EditorHistoryState } from "./runtime-ref.js";

const GHOST_COLOR = "\x1b[38;5;244m";
const RESET = "\x1b[0m";
// Cursor rendering varies across themes/terminal modes (e.g. 7m, 5;7m, etc.).
// Match any ANSI-styled single-space cursor block instead of one exact sequence.
const END_CURSOR = /(?:\x1b\[[0-9;]*m \x1b\[[0-9;]*m|█|▌|▋|▉|▓)/;

interface GhostState {
	text: string;
	suggestion: string;
	suffix: string;
	suffixLines: string[];
	multiline: boolean;
}

interface EditorHistoryCarrier {
	history: string[];
	historyIndex: number;
}

export class GhostSuggestionEditor extends CustomEditor {
	private suppressGhost = false;
	private suppressGhostArmedByNonEmptyText = false;
	private lastSuggestion: string | undefined;
	private lastSuggestionRevision = -1;
	private needsInitialHistoryRestore = true;

	public constructor(
		tui: ConstructorParameters<typeof CustomEditor>[0],
		theme: ConstructorParameters<typeof CustomEditor>[1],
		keybindings: ConstructorParameters<typeof CustomEditor>[2],
		private readonly getSuggestion: () => string | undefined,
		private readonly getSuggestionRevision: () => number,
		private readonly ghostAcceptKeys: readonly GhostAcceptKey[],
		private readonly getHistoryState: () => EditorHistoryState,
		private readonly setHistoryState: (state: EditorHistoryState) => void,
	) {
		super(tui, theme, keybindings);
		this.restoreSharedHistoryState();
		this.syncSharedHistoryState();
	}

	public override handleInput(data: string): void {
		const ghost = this.getGhostState();
		// Accept ghost suggestion with a configured shortcut when the editor is still empty.
		// Any other key should hide ghost mode and reveal normal editor UI behavior.
		if (ghost && ghost.text.length === 0) {
			if (matchesGhostAcceptKey(data, this.ghostAcceptKeys)) {
				this.setText(ghost.suggestion);
				return;
			}
			this.suppressGhost = true;
			this.suppressGhostArmedByNonEmptyText = false;
			super.handleInput(data);
			this.updateGhostSuppressionLifecycle();
			this.syncSharedHistoryState();
			return;
		}

		super.handleInput(data);
		this.updateGhostSuppressionLifecycle();
		this.syncSharedHistoryState();
	}

	public override addToHistory(text: string): void {
		super.addToHistory(text);
		this.syncSharedHistoryState();
	}

	public override setText(text: string): void {
		super.setText(text);
		if (this.needsInitialHistoryRestore) {
			this.restoreSharedHistoryState();
			this.needsInitialHistoryRestore = false;
		}
		this.syncSharedHistoryState();
	}

	public override insertTextAtCursor(text: string): void {
		super.insertTextAtCursor(text);
		this.syncSharedHistoryState();
	}

	public render(width: number): string[] {
		const lines = super.render(width);
		const ghost = this.getGhostState();
		if (!ghost) return lines;
		if (lines.length < 3) return lines;

		const contentLineIndex = 1;
		const firstContentLine = lines[contentLineIndex];
		if (!firstContentLine) return lines;
		const match = END_CURSOR.exec(firstContentLine);
		if (!match) return lines;

		const cursorCol = visibleWidth(firstContentLine.slice(0, match.index));
		const lineStartCol = Math.max(0, cursorCol - visibleWidth(ghost.text));
		const firstSuffixLine = ghost.suffixLines[0] ?? "";
		const firstLineAvailable = Math.max(1, width - (cursorCol + 1));
		const firstSuffixWrapped = wrapTextWithAnsi(firstSuffixLine, firstLineAvailable);
		const firstLineGhost = firstSuffixWrapped[0] ?? "";

		lines[contentLineIndex] = truncateToWidth(
			firstContentLine.replace(END_CURSOR, (cursor) => `${cursor}${GHOST_COLOR}${firstLineGhost}${RESET}`),
			width,
			"",
		);

		const continuationLines: string[] = [];
		continuationLines.push(...firstSuffixWrapped.slice(1));
		for (let index = 1; index < ghost.suffixLines.length; index += 1) {
			continuationLines.push(...wrapTextWithAnsi(ghost.suffixLines[index] ?? "", Math.max(1, width - lineStartCol)));
		}
		if (continuationLines.length === 0) return lines;

		for (let index = 0; index < continuationLines.length; index += 1) {
			const ghostLine = this.renderGhostLineAtColumn(continuationLines[index] ?? "", lineStartCol, width);
			const targetIndex = contentLineIndex + 1 + index;
			const bottomBorderIndex = lines.length - 1;
			if (targetIndex < bottomBorderIndex) lines[targetIndex] = ghostLine;
			else lines.splice(bottomBorderIndex, 0, ghostLine);
		}

		return lines;
	}

	private renderGhostLineAtColumn(text: string, col: number, width: number): string {
		const available = Math.max(0, width - col);
		const truncated = truncateToWidth(text, available, "");
		const used = col + visibleWidth(truncated);
		const padding = " ".repeat(Math.max(0, width - used));
		return truncateToWidth(`${" ".repeat(col)}${GHOST_COLOR}${truncated}${RESET}${padding}`, width, "");
	}

	private getHistoryCarrier(): EditorHistoryCarrier {
		return this as unknown as EditorHistoryCarrier;
	}

	private restoreSharedHistoryState(): void {
		const carrier = this.getHistoryCarrier();
		const state = this.getHistoryState();
		carrier.history = [...state.entries];
		carrier.historyIndex = state.entries.length === 0 ? -1 : Math.max(-1, Math.min(state.index, state.entries.length - 1));
	}

	private syncSharedHistoryState(): void {
		const carrier = this.getHistoryCarrier();
		this.setHistoryState({
			entries: [...carrier.history],
			index: carrier.historyIndex,
		});
	}

	private updateGhostSuppressionLifecycle(): void {
		if (!this.suppressGhost) return;
		const text = this.getText();
		if (text.length > 0) {
			this.suppressGhostArmedByNonEmptyText = true;
			return;
		}
		if (this.suppressGhostArmedByNonEmptyText) {
			this.suppressGhost = false;
			this.suppressGhostArmedByNonEmptyText = false;
		}
	}

	private getGhostState(): GhostState | undefined {
		const revision = this.getSuggestionRevision();
		const suggestion = this.getSuggestion()?.trim();
		if (revision !== this.lastSuggestionRevision || suggestion !== this.lastSuggestion) {
			this.lastSuggestionRevision = revision;
			this.lastSuggestion = suggestion;
			this.suppressGhost = false;
			this.suppressGhostArmedByNonEmptyText = false;
		}

		if (!suggestion || this.suppressGhost) return undefined;
		const text = this.getText();
		const cursor = this.getCursor();
		if (text.includes("\n")) return undefined;
		if (cursor.line !== 0 || cursor.col !== text.length) return undefined;
		if (!suggestion.startsWith(text)) return undefined;
		const suffix = suggestion.slice(text.length);
		if (!suffix) return undefined;
		const suffixLines = suffix.split("\n");
		const multiline = suffixLines.length > 1;
		if (multiline && text.length > 0) return undefined;
		return { text, suggestion, suffix, suffixLines, multiline };
	}
}
