// Path autocomplete for settings text inputs (folders and markdown files)
import { AbstractInputSuggest, App, TAbstractFile } from "obsidian";

// Base: suggests vault paths matching what's typed, and fills the input on select
abstract class PathSuggest<T extends TAbstractFile> extends AbstractInputSuggest<T> {
	constructor(
		app: App,
		private inputEl: HTMLInputElement,
	) {
		super(app, inputEl);
	}

	protected abstract getItems(): T[];

	protected getSuggestions(query: string): T[] {
		const lowerQuery = query.toLowerCase();
		return this.getItems()
			.filter((item) => item.path.toLowerCase().includes(lowerQuery))
			.sort((a, b) => a.path.localeCompare(b.path));
	}

	renderSuggestion(item: T, el: HTMLElement): void {
		el.setText(item.path);
	}

	selectSuggestion(item: T): void {
		this.setValue(item.path);
		this.inputEl.dispatchEvent(new Event("input")); // Runs the setting's onChange, which saves
		this.close();
	}
}

// Suggests vault folders (root excluded)
export class FolderSuggest extends PathSuggest<TAbstractFile> {
	protected getItems() {
		return this.app.vault.getAllFolders(false);
	}
}

// Suggests markdown files
export class FileSuggest extends PathSuggest<TAbstractFile> {
	protected getItems() {
		return this.app.vault.getMarkdownFiles();
	}
}
