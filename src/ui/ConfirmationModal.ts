import { App, ButtonComponent, Modal } from "obsidian";

// Generic Confirmation Modal
export class ConfirmationModal extends Modal {
	constructor(
		app: App,
		private message: string,
		private onConfirm: () => void,
		private onCancel?: () => void, // Called when closed without confirming (Cancel, Esc, click outside)
	) {
		super(app);
	}

	private confirmed = false; // Whether the Confirm button was clicked

	// When opened, display the modal with confirmation message and buttons
	onOpen() {
		const { contentEl } = this;
		contentEl.empty(); // Clear existing content
		contentEl.addClass("confirm-modal");
		contentEl.createEl("p", { text: this.message });

		// Create a button container for the modal
		const buttonContainer = contentEl.createDiv({
			cls: "modal-button-container",
		});

		// Create Confirm button
		new ButtonComponent(buttonContainer)
			.setButtonText("Confirm")
			.setWarning()
			.onClick(() => {
				this.confirmed = true;
				this.onConfirm(); // Call the confirm callback
				this.close(); // Call close to hide the modal
			});

		// Create Cancel button
		new ButtonComponent(buttonContainer)
			.setButtonText("Cancel")
			.onClick(() => {
				this.close(); // Call close to hide the modal
			});
	}

	// When closed, clear the content and report a cancel
	onClose() {
		this.contentEl.empty();
		if (!this.confirmed) this.onCancel?.();
	}
}
