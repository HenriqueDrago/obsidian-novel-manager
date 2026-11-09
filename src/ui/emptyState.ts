// Placeholder message for empty lists, with an optional action button and link
import { ButtonComponent } from "obsidian";

// Renders a dashed-border message (and a button, if given) into the parent
export function renderEmptyState(
	parentEl: HTMLElement,
	text: string,
	action?: { label: string; onClick: () => void },
	secondaryAction?: { label: string; onClick: () => void }, // A small link below the button
): HTMLElement {
	const emptyEl = parentEl.createDiv({ cls: "novel-empty-state" });
	emptyEl.createDiv({ text });
	if (action) {
		new ButtonComponent(emptyEl).setButtonText(action.label).onClick(action.onClick);
	}
	if (secondaryAction) {
		const linkEl = emptyEl.createEl("a", {
			cls: "novel-empty-state-link",
			text: secondaryAction.label,
			href: "#",
		});
		linkEl.addEventListener("click", (ev) => {
			ev.preventDefault();
			secondaryAction.onClick();
		});
	}
	return emptyEl;
}
