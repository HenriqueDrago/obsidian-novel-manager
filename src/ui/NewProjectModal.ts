// Modal for creating a novel project from the view (the full options stay in settings)
import { App, ButtonComponent, Modal, Notice, Setting, TextComponent } from "obsidian";
import { FolderSuggest } from "./suggest";
import { addPathNote, fragmentsPlaceholder, setSettingEnabled } from "./settingHelpers";

export interface NewProjectFields {
	name: string;
	path: string;
	fragmentsPath: string;
}

export class NewProjectModal extends Modal {
	constructor(
		app: App,
		private fragmentsEnabled: boolean,
		private onSubmit: (fields: NewProjectFields) => void,
	) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText("New project");

		let nameInput!: TextComponent;
		let pathInput!: TextComponent;
		let fragmentsInput!: TextComponent;

		new Setting(contentEl).setName("Name").addText((text) => {
			nameInput = text.setPlaceholder("E.g., my epic saga");
		});

		const pathSetting = new Setting(contentEl).setName("Chapters folder");
		const updatePathNote = addPathNote(this.app, pathSetting.descEl, "folder", "Folder");
		pathSetting.addText((text) => {
			pathInput = text.setPlaceholder("E.g., novels/my-epic-saga/chapters").onChange((value) => {
				updatePathNote(value);
				// The fragments fallback follows the chapters folder
				fragmentsInput.setPlaceholder(fragmentsPlaceholder(value.trim()));
			});
			new FolderSuggest(this.app, text.inputEl);
		});

		// Optional; greyed out while fragments are off
		const fragmentsSetting = new Setting(contentEl)
			.setName(this.fragmentsEnabled ? "Fragments folder" : "Fragments folder (fragments are off)")
			.setDesc("Optional. Leave empty to use the folder shown as the example.");
		fragmentsSetting.addText((text) => {
			fragmentsInput = text.setPlaceholder(fragmentsPlaceholder(""));
			new FolderSuggest(this.app, text.inputEl);
		});
		setSettingEnabled(fragmentsSetting, this.fragmentsEnabled);

		const submit = () => {
			const name = nameInput.getValue().trim();
			if (!name) {
				new Notice("Name cannot be empty.");
				nameInput.inputEl.focus();
				return;
			}
			this.close();
			this.onSubmit({
				name,
				path: pathInput.getValue(),
				fragmentsPath: this.fragmentsEnabled ? fragmentsInput.getValue() : "",
			});
		};

		// Enter in any field creates the project (not while an input method is composing)
		for (const input of [nameInput, pathInput, fragmentsInput]) {
			input.inputEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter" && !e.isComposing) {
					e.preventDefault();
					submit();
				}
			});
		}

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
		new ButtonComponent(buttonContainer).setButtonText("Create").setCta().onClick(submit);
		new ButtonComponent(buttonContainer).setButtonText("Cancel").onClick(() => this.close());

		nameInput.inputEl.focus();
	}

	onClose() {
		this.contentEl.empty();
	}
}
