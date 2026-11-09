// Rename dialog for numbered chapters: edits the title and shows the real file name
import { App, ButtonComponent, Modal, Notice, Setting, TextComponent } from "obsidian";

// What a typed title would become, for the preview line under the input
export interface NamePreview {
	name: string; // The file name it ends up with
	note?: string; // E.g. "Renumbers 3 other chapters."
	error?: string; // Blocks submitting (e.g. the name is taken)
}

// Shows the preview line and its note or error; returns whether it can be submitted
export function renderNamePreview(el: HTMLElement, preview: NamePreview | null, label: string): boolean {
	el.empty();
	if (!preview) return false;
	const line = el.createDiv({ cls: "novel-name-preview-line" });
	line.createSpan({ cls: "novel-name-preview-label", text: `${label} ` });
	line.createSpan({ cls: "novel-name-preview-name", text: preview.name || "…" });
	if (preview.error) el.createDiv({ cls: "mod-warning", text: preview.error });
	else if (preview.note) el.createDiv({ cls: "novel-name-preview-note", text: preview.note });
	return !preview.error;
}

export class RenameChapterModal extends Modal {
	constructor(
		app: App,
		private options: {
			initialTitle: string;
			initialExcluded: boolean;
			preview: (title: string, excluded: boolean) => NamePreview;
			onSubmit: (title: string, excluded: boolean) => void;
		},
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl("h2", { text: "Rename chapter" });

		let excluded = this.options.initialExcluded;
		const inputContainer = contentEl.createDiv({ cls: "modal-input-container" });
		const textInput = new TextComponent(inputContainer).setValue(this.options.initialTitle);
		textInput.inputEl.addClass("modal-text-input");
		const previewEl = contentEl.createDiv({ cls: "novel-name-preview" });

		let canSubmit = false;
		const update = () => {
			// Unnumbered chapters are named freely; numbered ones only get a title
			textInput.setPlaceholder(excluded ? "Chapter name" : "Chapter title");
			canSubmit = renderNamePreview(
				previewEl,
				this.options.preview(textInput.getValue().trim(), excluded),
				"Saved as:",
			);
		};
		textInput.onChange(update);

		new Setting(contentEl)
			.setName("Leave out of numbering")
			.setDesc("No number in its name; it keeps its place between the numbered chapters.")
			.addToggle((toggle) =>
				toggle.setValue(excluded).onChange((value) => {
					excluded = value;
					update();
				}),
			);
		update();

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
		const doSubmit = () => {
			const title = textInput.getValue().trim();
			if (!title) {
				new Notice("Name cannot be empty.");
				return;
			}
			if (!canSubmit) return; // The preview says why
			this.close();
			this.options.onSubmit(title, excluded);
		};
		new ButtonComponent(buttonContainer).setButtonText("Rename").setCta().onClick(doSubmit);
		new ButtonComponent(buttonContainer).setButtonText("Cancel").onClick(() => this.close());

		textInput.inputEl.addEventListener("keydown", (e) => {
			// Ignore Enter while an input method is still composing
			if (e.key === "Enter" && !e.isComposing) {
				e.preventDefault();
				doSubmit();
			}
		});
		textInput.inputEl.focus();
		textInput.inputEl.select();
	}

	onClose() {
		this.contentEl.empty();
	}
}
