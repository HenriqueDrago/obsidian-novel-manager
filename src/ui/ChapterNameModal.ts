import { App, ButtonComponent, Modal, Notice, TextComponent } from "obsidian";

// Modal for getting chapter name (Used for creating and renaming chapters)
export class ChapterNameModal extends Modal {
	result: string | null = null; // Result to store the chapter name
	onSubmit: (result: string) => void; // Callback to execute on submit
	private initialValue: string; // Initial value for the input field
	private modalTitle: string; // Title of the modal
	private ctaButtonText: string; // Text for the call-to-action button
	private placeholder: string; // Placeholder for the name input

	constructor(
		app: App,
		title: string,
		ctaText: string,
		initialValue: string,
		onSubmit: (result: string) => void,
		placeholder = "Chapter name",
	) {
		super(app);
		this.modalTitle = title;
		this.ctaButtonText = ctaText;
		this.initialValue = initialValue;
		this.onSubmit = onSubmit;
		this.placeholder = placeholder;
	}

	// When opened, display the modal with input field and buttons
	onOpen() {
		const { contentEl } = this; // Get the content element of the modal
		contentEl.empty(); // Clear existing content

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

		const buttonContainer = contentEl.createDiv({
			cls: "modal-button-container",
		});

		// Create a submit button with the provided text
		const submitButton = new ButtonComponent(buttonContainer)
			.setButtonText(this.ctaButtonText)
			.setCta(); // Set the button as a call-to-action

		// Function to handle the submit action
		const doSubmit = () => {
			const chapterName = textInput.getValue().trim();
			// Submit only a non-empty name
			if (chapterName) {
				this.result = chapterName;
				this.close();
				this.onSubmit(this.result);
			} else {
				new Notice("Name cannot be empty.");
			}
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
