import { App, ButtonComponent, Modal, TextComponent } from "obsidian";

// Modal for getting chapter name (Used for creating and renaming chapters)
export class ChapterNameModal extends Modal {
	result: string | null = null; // Result to store the chapter name
	onSubmit: (result: string) => void; // Callback to execute on submit
	private initialValue: string; // Initial value for the input field
	private modalTitle: string; // Title of the modal
	private ctaButtonText: string; // Text for the call-to-action button
	private placeholder: string; // Placeholder for the name input
	private getNote?: (value: string) => string | null; // Warning shown under the input while typing
	private getError?: (value: string) => string | null; // Blocks submitting: a message, or "" to block silently

	constructor(
		app: App,
		title: string,
		ctaText: string,
		initialValue: string,
		onSubmit: (result: string) => void,
		placeholder = "Chapter name",
		getNote?: (value: string) => string | null,
		getError?: (value: string) => string | null,
	) {
		super(app);
		this.modalTitle = title;
		this.ctaButtonText = ctaText;
		this.initialValue = initialValue;
		this.onSubmit = onSubmit;
		this.placeholder = placeholder;
		this.getNote = getNote;
		this.getError = getError;
	}

	// When opened, display the modal with input field and buttons
	onOpen() {
		const { contentEl } = this; // Get the content element of the modal
		contentEl.empty(); // Clear existing content
		this.modalEl.addClass("novel-chapter-modal"); // Scopes the greyed-out button style

		contentEl.createEl("h2", { text: this.modalTitle }); // Set the modal title

		// Create a container for the input field
		const inputContainer = contentEl.createDiv({
			cls: "modal-input-container",
		});
		// Create a text input field for the chapter name
		const textInput = new TextComponent(inputContainer)
			.setPlaceholder(this.placeholder)
			.setValue(this.initialValue);
		textInput.inputEl.addClass("modal-text-input");
		textInput.inputEl.focus(); // Focus the input field when the modal opens

		// Optional live warning about what the typed name will do, or why it can't be used
		const noteEl = contentEl.createDiv({ cls: "mod-warning novel-modal-note" });
		noteEl.hide();

		const buttonContainer = contentEl.createDiv({
			cls: "modal-button-container",
		});

		// Create a submit button with the provided text
		const submitButton = new ButtonComponent(buttonContainer)
			.setButtonText(this.ctaButtonText)
			.setCta(); // Set the button as a call-to-action

		// Greys out the button while the name is empty or can't be used
		let canSubmit = false;
		const update = () => {
			const value = textInput.getValue();
			const error = this.getError?.(value) ?? null;
			const note = error || this.getNote?.(value) || null;
			noteEl.setText(note ?? "");
			noteEl.toggle(note !== null);
			canSubmit = value.trim() !== "" && error === null;
			submitButton.setDisabled(!canSubmit);
		};
		textInput.onChange(update);
		update();

		// Function to handle the submit action
		const doSubmit = () => {
			if (!canSubmit) return; // Empty, or the note says why
			this.result = textInput.getValue().trim();
			this.close();
			this.onSubmit(this.result);
		};

		submitButton.onClick(doSubmit); // Attach the submit function to the button click event

		// Add a Cancel button to close the modal without submitting
		new ButtonComponent(buttonContainer)
			.setButtonText("Cancel")
			.onClick(() => this.close());

		// Add an event listener to handle Enter key press for submitting
		textInput.inputEl.addEventListener("keydown", (e) => {
			// Ignore Enter while an input method is still composing
			if (e.key === "Enter" && !e.isComposing) {
				e.preventDefault();
				doSubmit();
			}
		});
	}

	// When closed, clear the content of the modal
	onClose() {
		this.contentEl.empty();
	}
}
