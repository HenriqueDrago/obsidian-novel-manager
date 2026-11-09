import { App, ButtonComponent, Modal, Notice, Setting, TextComponent } from "obsidian";
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

		// With numbering: the real file name, and a toggle to leave it unnumbered
		let excluded = false;
		let canSubmit = true;
		const numberingPreview = this.numberingPreview;
		if (numberingPreview) {
			const previewEl = contentEl.createDiv({ cls: "novel-name-preview" });
			const update = () => {
				const title = textInput.getValue().trim();
				canSubmit = renderNamePreview(
					previewEl,
					title ? numberingPreview(folderSelectEl.value, title, excluded) : null,
					"Created as:",
				);
			};
			textInput.onChange(update);
			folderSelectEl.addEventListener("change", update);
			new Setting(contentEl)
				.setName("Leave out of numbering")
				.setDesc("No number in its name; it's added after the last chapter of the folder.")
				.addToggle((toggle) =>
					toggle.setValue(excluded).onChange((value) => {
						excluded = value;
						update();
					}),
				);
			update();
		}

		const buttonContainer = contentEl.createDiv({
			cls: "modal-button-container",
		});

		// OnSubmit action (confirm button)
		const doSubmit = () => {
			const chapterName = textInput.getValue().trim(); // Get chapter name
			const selectedFolderPath = folderSelectEl.value; // Get selected folder

			// Check if there's a chapter name selected
			if (!chapterName) {
				new Notice("Chapter name cannot be empty.");
				return;
			}
			if (numberingPreview && !canSubmit) return; // The preview says why
			this.close();
			this.onSubmit(selectedFolderPath, chapterName, excluded);
		};

		new ButtonComponent(buttonContainer)
			.setButtonText(this.ctaButtonText)
			.setCta()
			.onClick(doSubmit);

		new ButtonComponent(buttonContainer)
			.setButtonText("Cancel")
			.onClick(() => this.close());

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
