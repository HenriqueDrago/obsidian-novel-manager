// Helpers shared by the settings tab and the new project modal
import { App, normalizePath, Setting, TFile, TFolder } from "obsidian";

// Greys out a setting that depends on another one (kept visible, never hidden)
export function setSettingEnabled(setting: Setting, enabled: boolean): void {
	setting.setDisabled(!enabled); // Disables its controls
	setting.settingEl.toggleClass("novel-setting-disabled", !enabled); // Fades the name and description too
}

// Adds a note line to an element; returns a function that updates it for a path value
export function addPathNote(
	app: App,
	parentEl: HTMLElement,
	kind: "folder" | "file",
	label: string,
): (value: string) => void {
	// Missing folders are created when needed (neutral note); a missing template is a real problem
	const noteEl = parentEl.createDiv({
		cls: kind === "file" ? "mod-warning" : "novel-path-note",
	});
	return (value: string) => {
		const trimmed = value.trim();
		const found = trimmed ? app.vault.getAbstractFileByPath(normalizePath(trimmed)) : null;
		const missing =
			trimmed !== "" && !(kind === "file" ? found instanceof TFile : found instanceof TFolder);
		noteEl.setText(
			!missing
				? ""
				: kind === "file"
					? `${label} not found.`
					: `${label} doesn't exist yet; it will be created when needed.`,
		);
		noteEl.toggle(missing);
	};
}

// The fragments folder placeholder: the fallback path the plugin uses when it's empty
export function fragmentsPlaceholder(chaptersPath: string): string {
	return chaptersPath ? `${chaptersPath}/Fragments` : "E.g., novels/my-epic-saga/fragments";
}
