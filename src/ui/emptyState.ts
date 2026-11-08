// Placeholder message for empty lists, with an optional action button
import { ButtonComponent } from "obsidian";

// Renders a dashed-border message (and a button, if given) into the parent
export function renderEmptyState(
	parentEl: HTMLElement,
	text: string,
	action?: { label: string; onClick: () => void },
): HTMLElement {
	const emptyEl = parentEl.createDiv({ cls: "novel-empty-state" });
	emptyEl.createDiv({ text });
	if (action) {
		new ButtonComponent(emptyEl).setButtonText(action.label).onClick(action.onClick);
	}
	return emptyEl;
}
