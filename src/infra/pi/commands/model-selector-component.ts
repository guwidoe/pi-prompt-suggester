import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { Model } from "@mariozechner/pi-ai";
import { Container, fuzzyFilter, getKeybindings, Input, Spacer, Text } from "@mariozechner/pi-tui";
import type { Keybinding } from "@mariozechner/pi-tui";

interface ModelItem {
	provider: string;
	id: string;
	model: Model<any>;
}

type ModelScope = "all" | "available";

export interface ModelSelectorResult {
	canonicalRef: string;
}

export interface ModelSelectorOptions {
	/** Optional list of special options to prepend to the model list (e.g., "(inherit)", "session-default") */
	prependOptions?: string[];
}

/**
 * Show a model selector with tabs for switching between "all models" and "available models".
 * Available models are those with configured API keys.
 */
export async function showModelSelector(
	ctx: ExtensionCommandContext,
	currentModelRef: string,
	label: string,
	options?: ModelSelectorOptions,
): Promise<ModelSelectorResult | undefined> {
	if (!ctx.hasUI) {
		ctx.ui.notify("Model selection requires TUI.", "error");
		return undefined;
	}

	return await ctx.ui.custom<ModelSelectorResult | undefined>((tui, theme, _kb, done) => {
		const component = new ModelSelectorComponent(
			tui,
			theme,
			currentModelRef,
			ctx.modelRegistry.getAll(),
			ctx.modelRegistry.getAvailable(),
			label,
			(result) => done(result),
			() => done(undefined),
			options?.prependOptions,
		);
		return component;
	}, { overlay: true });
}

class ModelSelectorComponent {
	private tui: any;
	private theme: any;
	private allModels: ModelItem[];
	private availableModels: ModelItem[];
	private activeModels: ModelItem[];
	private filteredModels: ModelItem[];
	private selectedIndex = 0;
	private currentModelRef: string;
	private label: string;
	private scope: ModelScope;
	private searchInput: Input;
	private listContainer: Container;
	private scopeText: Text;
	private scopeHintText: Text;
	private prependOptions: string[];
	private onSelect: (result: ModelSelectorResult) => void;
	private onCancel: () => void;

	constructor(
		tui: any,
		theme: any,
		currentModelRef: string,
		allModels: Model<any>[],
		availableModels: Model<any>[],
		label: string,
		onSelect: (result: ModelSelectorResult) => void,
		onCancel: () => void,
		prependOptions?: string[],
	) {
		this.tui = tui;
		this.theme = theme;
		this.currentModelRef = currentModelRef;
		this.label = label;
		this.onSelect = onSelect;
		this.onCancel = onCancel;
		this.prependOptions = prependOptions ?? [];

		// Build model lists
		this.allModels = this.sortModels(allModels.map((model) => ({
			provider: model.provider,
			id: model.id,
			model,
		})));
		this.availableModels = this.sortModels(availableModels.map((model) => ({
			provider: model.provider,
			id: model.id,
			model,
		})));

		// Default to "available" if there are available models, otherwise "all"
		this.scope = this.availableModels.length > 0 ? "available" : "all";
		this.activeModels = this.scope === "available" ? this.availableModels : this.allModels;
		this.filteredModels = this.activeModels;

		// Build UI
		const container = new Container();

		// Header with label
		container.addChild(new Text(theme.fg("accent", theme.bold(this.label)), 0, 0));
		container.addChild(new Spacer(1));

		// Scope indicators
		this.scopeText = new Text(this.getScopeText(), 0, 0);
		container.addChild(this.scopeText);
		this.scopeHintText = new Text(this.getScopeHintText(), 0, 0);
		container.addChild(this.scopeHintText);
		container.addChild(new Spacer(1));

		// Search input
		this.searchInput = new Input();
		container.addChild(this.searchInput);
		container.addChild(new Spacer(1));

		// Model list container
		this.listContainer = new Container();
		container.addChild(this.listContainer);
		container.addChild(new Spacer(1));

		// Render initial list
		this.updateList();

		// Store the container for rendering
		this.container = container;
	}

	private container: Container;

	private sortModels(models: ModelItem[]): ModelItem[] {
		const sorted = [...models];
		sorted.sort((a, b) => {
			const aIsCurrent = this.isCurrentModel(a);
			const bIsCurrent = this.isCurrentModel(b);
			if (aIsCurrent && !bIsCurrent) return -1;
			if (!aIsCurrent && bIsCurrent) return 1;
			return a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id);
		});
		return sorted;
	}

	private isCurrentModel(item: ModelItem): boolean {
		const ref = `${item.provider}/${item.id}`;
		return ref === this.currentModelRef || item.id === this.currentModelRef;
	}

	private getScopeText(): string {
		const allText = this.scope === "all"
			? this.theme.fg("accent", "all")
			: this.theme.fg("muted", "all");
		const availableText = this.scope === "available"
			? this.theme.fg("accent", "available")
			: this.theme.fg("muted", "available");
		const allCount = this.allModels.length;
		const availableCount = this.availableModels.length;
		return `${this.theme.fg("muted", "Scope: ")}${allText}${this.theme.fg("muted", ` (${allCount}) | `)}${availableText}${this.theme.fg("muted", ` (${availableCount})`)}`;
	}

	private getScopeHintText(): string {
		return keyHint("tab", "scope") + this.theme.fg("muted", " (all/available)  ·  Enter select  ·  Esc cancel");
	}

	private setScope(scope: ModelScope): void {
		if (this.scope === scope) return;
		this.scope = scope;
		this.activeModels = this.scope === "available" ? this.availableModels : this.allModels;
		this.selectedIndex = 0;
		this.filterModels(this.searchInput.getValue());
		this.scopeText.setText(this.getScopeText());
	}

	private filterModels(query: string): void {
		this.filteredModels = query
			? fuzzyFilter(this.activeModels, query, ({ id, provider }) => `${id} ${provider} ${provider}/${id} ${provider} ${id}`)
			: this.activeModels;
		this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.filteredModels.length - 1));
		this.updateList();
	}

	private updateList(): void {
		this.listContainer.clear();
		const maxVisible = 10;
		const prependedCount = this.prependOptions.length;
		const totalItems = prependedCount + this.filteredModels.length;
		
		// Calculate scroll window
		const startIndex = Math.max(0, Math.min(this.selectedIndex - Math.floor(maxVisible / 2), totalItems - maxVisible));
		const endIndex = Math.min(startIndex + maxVisible, totalItems);

		// Show visible slice
		for (let i = startIndex; i < endIndex; i++) {
			const isSelected = i === this.selectedIndex;
			
			// Check if this is a prepended option
			if (i < prependedCount) {
				const option = this.prependOptions[i];
				let line = "";
				if (isSelected) {
					line = `${this.theme.fg("accent", "→ ")}${this.theme.fg("accent", option)}`;
				} else {
					line = `  ${option}`;
				}
				this.listContainer.addChild(new Text(line, 0, 0));
				continue;
			}
			
			// Otherwise it's a model
			const modelIndex = i - prependedCount;
			const item = this.filteredModels[modelIndex];
			if (!item) continue;
			
			const isCurrent = this.isCurrentModel(item);
			let line = "";
			if (isSelected) {
				const prefix = this.theme.fg("accent", "→ ");
				const modelText = `${item.id}`;
				const providerBadge = this.theme.fg("muted", `[${item.provider}]`);
				const checkmark = isCurrent ? this.theme.fg("success", " ✓") : "";
				line = `${prefix + this.theme.fg("accent", modelText)} ${providerBadge}${checkmark}`;
			} else {
				const modelText = `  ${item.id}`;
				const providerBadge = this.theme.fg("muted", `[${item.provider}]`);
				const checkmark = isCurrent ? this.theme.fg("success", " ✓") : "";
				line = `${modelText} ${providerBadge}${checkmark}`;
			}
			this.listContainer.addChild(new Text(line, 0, 0));
		}

		// Add scroll indicator if needed
		if (startIndex > 0 || endIndex < totalItems) {
			const scrollInfo = this.theme.fg("muted", `  (${this.selectedIndex + 1}/${totalItems})`);
			this.listContainer.addChild(new Text(scrollInfo, 0, 0));
		}

		// Show "no results" if empty
		if (totalItems === 0) {
			this.listContainer.addChild(new Text(this.theme.fg("muted", "  No matching models"), 0, 0));
		} else {
			const selected = this.selectedIndex;
			if (selected < prependedCount) {
				// Show description for prepend option
				this.listContainer.addChild(new Spacer(1));
				this.listContainer.addChild(new Text(this.theme.fg("muted", `  ${this.prependOptions[selected]}`), 0, 0));
			} else {
				const item = this.filteredModels[selected - prependedCount];
				if (item) {
					this.listContainer.addChild(new Spacer(1));
					this.listContainer.addChild(new Text(this.theme.fg("muted", `  Model Name: ${item.model.name}`), 0, 0));
				}
			}
		}
	}

	handleInput(data: string): void {
		const kb = getKeybindings();
		const prependedCount = this.prependOptions.length;
		const totalItems = prependedCount + this.filteredModels.length;

		// Tab - toggle scope
		if (kb.matches(data, "tui.input.tab" as Keybinding)) {
			if (this.availableModels.length > 0) {
				const nextScope: ModelScope = this.scope === "all" ? "available" : "all";
				this.setScope(nextScope);
				this.scopeHintText.setText(this.getScopeHintText());
				this.tui.requestRender();
			}
			return;
		}

		// Up arrow - wrap to bottom when at top
		if (kb.matches(data, "tui.select.up" as Keybinding)) {
			if (totalItems === 0) return;
			this.selectedIndex = this.selectedIndex === 0 ? totalItems - 1 : this.selectedIndex - 1;
			this.updateList();
			this.tui.requestRender();
			return;
		}

		// Down arrow - wrap to top when at bottom
		if (kb.matches(data, "tui.select.down" as Keybinding)) {
			if (totalItems === 0) return;
			this.selectedIndex = this.selectedIndex === totalItems - 1 ? 0 : this.selectedIndex + 1;
			this.updateList();
			this.tui.requestRender();
			return;
		}

		// Enter
		if (kb.matches(data, "tui.select.confirm" as Keybinding)) {
			if (this.selectedIndex < prependedCount) {
				// Selected a prepend option
				const option = this.prependOptions[this.selectedIndex];
				this.onSelect({ canonicalRef: option });
			} else {
				const selectedModel = this.filteredModels[this.selectedIndex - prependedCount];
				if (selectedModel) {
					const canonicalRef = `${selectedModel.provider}/${selectedModel.id}`;
					this.onSelect({ canonicalRef });
				}
			}
			return;
		}

		// Escape or Ctrl+C
		if (kb.matches(data, "tui.select.cancel" as Keybinding)) {
			this.onCancel();
			return;
		}

		// Pass everything else to search input
		this.searchInput.handleInput(data);
		this.filterModels(this.searchInput.getValue());
		this.tui.requestRender();
	}

	render(width: number): string[] {
		return this.container.render(width);
	}

	invalidate(): void {
		this.container.invalidate();
	}
}

/**
 * Format a keybinding hint as dim text with the key in square brackets.
 */
function keyHint(key: string, action: string): string {
	// Using a simplified version - the theme instance handles colors
	return `[${key}] ${action}`;
}