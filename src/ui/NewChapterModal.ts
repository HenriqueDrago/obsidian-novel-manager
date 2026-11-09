import { App, ButtonComponent, Modal, Setting, TextComponent } from "obsidian";
import { NamePreview, renderNamePreview } from "./RenameChapterModal";

// Modal for creating a new chapter, with folder selection
export class NewChapterModal extends Modal {
	onSubmit: (folderPath: string, chapterName: string, excluded: boolean) => void; // Callback to execute on submit
	private folderOptions: { name: string; path: string }[]; // List of options for the folder selector
	private modalTitle: string; // Title of the Modal
	private ctaButtonText: string; // Text of the call-to-action button

	constructor(
		app: App,
		title: string,
		ctaText: string,
		folderOptions: { name: string; path: string }[],
		onSubmit: (folderPath: string, chapterName: string, excluded: boolean) => void,
		private defaultFolderPath?: string, // Folder preselected in the dropdown, if it's one of the options
		// With numbering: the file name a title gets in a folder (the input is then just the title)
		private numberingPreview?: (folderPath: string, title: string, excluded: boolean) => NamePreview,
		// Without numbering: why a name can't be used in a folder (e.g. it's taken), or null
		private nameError?: (folderPath: string, name: string) => string | null,
		// Without numbering: a warning that doesn't block, or null
		private nameWarning?: (folderPath: string, name: string) => string | null,
	) {
		super(app);
		this.modalTitle = title;
		this.ctaButtonText = ctaText;
		this.folderOptions = folderOptions;
		this.onSubmit = onSubmit;
	}

	// Execute on open
	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.modalEl.addClass("novel-chapter-modal"); // Scopes the greyed-out button style

		contentEl.createEl("h2", { text: this.modalTitle });

		// Text input for the new chapter name
		const textInput = new TextComponent(contentEl).setPlaceholder(
			this.numberingPreview ? "Chapter title" : "Chapter name",
		);
		textInput.inputEl.addClass("modal-text-input");
		textInput.inputEl.focus(); // Focus on the name input first

		// Dropdown for folder selection
		const folderSelectContainer = contentEl.createDiv({
			cls: "modal-folder-select-container",
		});
		folderSelectContainer.createEl("label", { text: "Create in folder: " });
		const folderSelectEl = folderSelectContainer.createEl("select");

		// Set the options for the dropdown
		this.folderOptions.forEach((opt) => {
			folderSelectEl.createEl("option", {
				text: opt.name,
				value: opt.path,
			});
		});

		// Preselect the default folder (otherwise the first option stays selected)
		if (
			this.defaultFolderPath &&
			this.folderOptions.some((opt) => opt.path === this.defaultFolderPath)
		) {
			folderSelectEl.value = this.defaultFolderPath;
		}

		// With numbering: the real file name; without: why the name can't be used
		const previewEl = contentEl.createDiv({ cls: "novel-name-preview" });
		let excluded = false;
		const numberingPreview = this.numberingPreview;
		const nameError = this.nameError;
		const nameWarning = this.nameWarning;
		if (numberingPreview) {
			new Setting(contentEl)
				.setClass("novel-modal-toggle")
				.setName("Leave out of numbering")
				.setDesc("No number in its name; it's added after the last chapter of the folder.")
				.addToggle((toggle) =>
					toggle.setValue(excluded).onChange((value) => {
						excluded = value;
						update();
					}),
				);
		}

		const buttonContainer = contentEl.createDiv({
			cls: "modal-button-container",
		});
		const submitButton = new ButtonComponent(buttonContainer)
			.setButtonText(this.ctaButtonText)
			.setCta();
		new ButtonComponent(buttonContainer)
			.setButtonText("Cancel")
			.onClick(() => this.close());

		// Greys out the button while the name is empty or can't be used
		let canSubmit = false;
		const update = () => {
			const name = textInput.getValue().trim();
			const folderPath = folderSelectEl.value;
			if (numberingPreview) {
				canSubmit = renderNamePreview(
					previewEl,
					name ? numberingPreview(folderPath, name, excluded) : null,
					"Created as:",
				);
			} else {
				const error = name ? nameError?.(folderPath, name) ?? null : null;
				const warning = name && !error ? nameWarning?.(folderPath, name) ?? null : null;
				previewEl.empty();
				const message = error ?? warning;
				if (message) previewEl.createDiv({ cls: "mod-warning", text: message });
				canSubmit = name !== "" && error === null;
			}
			submitButton.setDisabled(!canSubmit);
		};
		textInput.onChange(update);
		folderSelectEl.addEventListener("change", update);
		update();

		// OnSubmit action (confirm button)
		const doSubmit = () => {
			if (!canSubmit) return; // Empty, or the message says why
			this.close();
			this.onSubmit(folderSelectEl.value, textInput.getValue().trim(), excluded);
		};
		submitButton.onClick(doSubmit);

		textInput.inputEl.addEventListener("keydown", (e) => {
			// Ignore Enter while an input method is still composing
			if (e.key === "Enter" && !e.isComposing) {
				e.preventDefault();
				doSubmit();
			}
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}
