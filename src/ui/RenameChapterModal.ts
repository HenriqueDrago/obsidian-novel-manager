// Rename dialog for numbered chapters: edits the title and shows the real file name
import { App, ButtonComponent, Modal, Setting, TextComponent } from "obsidian";

// What a typed title would become, for the preview line under the input
export interface NamePreview {
	name: string; // The file name it ends up with
	note?: string; // E.g. "Renumbers 3 other chapters."
	error?: string; // Blocks submitting (e.g. the name is taken)
	warning?: string; // Shown like an error, but doesn't block (e.g. same name in another case)
}

// Shows the preview line and its note or error; returns whether it can be submitted
export function renderNamePreview(el: HTMLElement, preview: NamePreview | null, label: string): boolean {
	el.empty();
	if (!preview) return false;
	const line = el.createDiv({ cls: "novel-name-preview-line" });
	line.createSpan({ cls: "novel-name-preview-label", text: `${label} ` });
	line.createSpan({ cls: "novel-name-preview-name", text: preview.name || "…" });
	if (preview.error) {
		el.createDiv({ cls: "mod-warning", text: preview.error });
	} else {
		if (preview.warning) el.createDiv({ cls: "mod-warning", text: preview.warning });
		if (preview.note) el.createDiv({ cls: "novel-name-preview-note", text: preview.note });
	}
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
		this.modalEl.addClass("novel-chapter-modal"); // Scopes the greyed-out button style
		contentEl.createEl("h2", { text: "Rename chapter" });

		let excluded = this.options.initialExcluded;
		const inputContainer = contentEl.createDiv({ cls: "modal-input-container" });
		const textInput = new TextComponent(inputContainer).setValue(this.options.initialTitle);
		textInput.inputEl.addClass("modal-text-input");
		const previewEl = contentEl.createDiv({ cls: "novel-name-preview" });

		new Setting(contentEl)
			.setClass("novel-modal-toggle")
			.setName("Leave out of numbering")
			.setDesc("No number in its name; it keeps its place between the numbered chapters.")
			.addToggle((toggle) =>
				toggle.setValue(excluded).onChange((value) => {
					excluded = value;
					update();
				}),
			);

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
		const submitButton = new ButtonComponent(buttonContainer).setButtonText("Rename").setCta();
		new ButtonComponent(buttonContainer).setButtonText("Cancel").onClick(() => this.close());

		// Greys out Rename while the title is empty or the preview has an error
		let canSubmit = false;
		const update = () => {
			// Unnumbered chapters are named freely; numbered ones only get a title
			textInput.setPlaceholder(excluded ? "Chapter name" : "Chapter title");
			canSubmit = renderNamePreview(
				previewEl,
				this.options.preview(textInput.getValue().trim(), excluded),
				"Saved as:",
			) && textInput.getValue().trim() !== "";
			submitButton.setDisabled(!canSubmit);
		};
		textInput.onChange(update);
		update();

		const doSubmit = () => {
			if (!canSubmit) return; // Empty, or the preview says why
			this.close();
			this.options.onSubmit(textInput.getValue().trim(), excluded);
		};
		submitButton.onClick(doSubmit);

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
