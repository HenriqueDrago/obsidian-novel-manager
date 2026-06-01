import {
	Plugin,
	WorkspaceLeaf,
	Notice,
	ItemView,
	TFile,
	normalizePath,
	Modal,
	TextComponent,
	ButtonComponent,
	App,
	Menu,
	setIcon,
	TFolder,
	MenuItem,
	debounce,
} from "obsidian";
import {
	NovelChapterPluginSettingsTab,
	NovelChapterPluginSettings,
	DEFAULT_SETTINGS as EXTERNAL_DEFAULT_SETTINGS,
	NovelProject,
} from "./settings";

// Define the constant for the custom view type
const NOVEL_CHAPTER_VIEW_TYPE = "novel-chapter-view";

// Augment settings for internal use within main.ts
interface InternalNovelChapterPluginSettings extends NovelChapterPluginSettings {
	lastSelectedNovelId: string | null;
}

// Default settings with internal properties
const DEFAULT_SETTINGS: InternalNovelChapterPluginSettings = {
	...EXTERNAL_DEFAULT_SETTINGS, // Spread the external default settings
	lastSelectedNovelId: null, // Initialize last selected novel ID to null
	// Ensure novelProjects is initialized properly
	novelProjects:
		Array.isArray(EXTERNAL_DEFAULT_SETTINGS.novelProjects) &&
		EXTERNAL_DEFAULT_SETTINGS.novelProjects.length > 0
			? EXTERNAL_DEFAULT_SETTINGS.novelProjects
			: [
					{
						id: `default-${Date.now()}`,
						name: "My First Novel",
						path: "Novel/Chapters",
					},
				],
};

// Helper function to check if a file is within a specific folder path
function isFileInFolder(file: TFile, folderPath: string): boolean {
	if (!folderPath || folderPath.trim() === "") return false; // If no folder path is provided, return false
	const normalizedFilePath = normalizePath(file.path); // Normalize the file path
	let normalizedFolderPath = normalizePath(folderPath); // Normalize the folder path

	// Ensure the folder path ends with a slash for accurate comparison
	if (!normalizedFolderPath.endsWith("/")) {
		normalizedFolderPath += "/";
	}
	return normalizedFilePath.startsWith(normalizedFolderPath); // Check if the file path starts with the folder path
}

// Helper function for sleep
const sleep = (ms: number) =>
	new Promise((resolve) => window.setTimeout(resolve, ms));

// Generic Confirmation Modal
class ConfirmationModal extends Modal {
	constructor(
		app: App,
		private message: string,
		private onConfirm: () => void,
	) {
		super(app);
	}

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

	// When closed, clear the content
	onClose() {
		this.contentEl.empty();
	}
}

// Modal for getting chapter name (Used for creating and renaming chapters)
class ChapterNameModal extends Modal {
	result: string | null = null; // Result to store the chapter name
	onSubmit: (result: string) => void; // Callback to execute on submit
	private initialValue: string; // Initial value for the input field
	private modalTitle: string; // Title of the modal
	private ctaButtonText: string; // Text for the call-to-action button

	// Constructor to initialize the modal with title, button text, initial value, and submit callback
	constructor(
		app: App,
		title: string,
		ctaText: string,
		initialValue: string,
		onSubmit: (result: string) => void,
	) {
		super(app);
		this.modalTitle = title;
		this.ctaButtonText = ctaText;
		this.initialValue = initialValue;
		this.onSubmit = onSubmit;
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
			.setPlaceholder("Chapter name")
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
			const chapterName = textInput.getValue().trim(); // Get the trimmed value from the input field
			// Validate the chapter name
			// If the chapter name is not empty, set the result and close the modal
			if (chapterName) {
				this.result = chapterName;
				this.close();
				this.onSubmit(this.result);
			} else {
				new Notice("Chapter name cannot be empty.");
			}
		};

		submitButton.onClick(doSubmit); // Attach the submit function to the button click event

		// Add a Cancel button to close the modal without submitting
		new ButtonComponent(buttonContainer)
			.setButtonText("Cancel")
			.onClick(() => this.close());

		// Add an event listener to handle Enter key press for submitting
		textInput.inputEl.addEventListener("keypress", (e) => {
			if (e.key === "Enter") {
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

// Modal for creating a new chapter, with folder selection
class NewChapterModal extends Modal {
	onSubmit: (folderPath: string, chapterName: string) => void; // Callback to execute on submit
	private folderOptions: { name: string; path: string }[]; // List of options for the folder selector
	private modalTitle: string; // Title of the Modal
	private ctaButtonText: string; // Text of the call-to-action button

	constructor(
		app: App,
		title: string,
		ctaText: string,
		folderOptions: { name: string; path: string }[],
		onSubmit: (folderPath: string, chapterName: string) => void,
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
			"Chapter name",
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

		const buttonContainer = contentEl.createDiv({
			cls: "modal-button-container",
		});

		// OnSubmit action (confirm button)
		const doSubmit = () => {
			const chapterName = textInput.getValue().trim(); // Get chapter name
			const selectedFolderPath = folderSelectEl.value; // Get selected folder

			// Check if there's a chapter name selected
			if (chapterName) {
				this.close();
				this.onSubmit(selectedFolderPath, chapterName);
			} else {
				new Notice("Chapter name cannot be empty.");
			}
		};

		new ButtonComponent(buttonContainer)
			.setButtonText(this.ctaButtonText)
			.setCta()
			.onClick(doSubmit);

		new ButtonComponent(buttonContainer)
			.setButtonText("Cancel")
			.onClick(() => this.close());

		textInput.inputEl.addEventListener("keypress", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				doSubmit();
			}
		});
	}

	onClose() {
		this.contentEl.empty();
	}
}

// Define the custom view class
class NovelChapterView extends ItemView {
	plugin: NovelChapterPlugin; // Reference to the plugin instance

	// Layout Containers
	tabsContainer!: HTMLDivElement;
	chaptersTabContainer!: HTMLDivElement;
	fragmentsTabContainer!: HTMLDivElement;
	controlsContainer!: HTMLDivElement;
	tableContainer!: HTMLDivElement;

	activeTab: "chapters" | "fragments" = "chapters"; // Track current tab
	selectedNovelProjectId: string | null = null; // ID of the currently selected novel project

	// State for filtering and searching
	private searchTerm = "";
	private filterValue = "all";
	private fragmentSearchTerm = "";
	private allCollapsed = false;

	constructor(leaf: WorkspaceLeaf, plugin: NovelChapterPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	// Returns the view type for this custom view
	getViewType(): string {
		return NOVEL_CHAPTER_VIEW_TYPE;
	}

	// Returns the display text for the view, which is shown in the sidebar
	getDisplayText(): string {
		const selectedProject = this.plugin.settings.novelProjects.find(
			(p) => p.id === this.selectedNovelProjectId,
		);
		return selectedProject
			? `Novel Manager: ${selectedProject.name}`
			: "Novel Manager";
	}

	// Returns the icon for the view, which is shown in the sidebar
	getIcon(): string {
		return "list-ordered";
	}

	// Called when the view is opened
	async onOpen(): Promise<void> {
		const contentEl = this.containerEl.children[1]; // Get the content element of the view
		contentEl.empty(); // Clear existing content
		contentEl.addClass("novel-chapter-view-container");

		// Create the Tab Toggle Container
		this.tabsContainer = contentEl.createDiv({ cls: "novel-view-tabs" });

		// Create the Wrappers for each Tab
		this.chaptersTabContainer = contentEl.createDiv({
			cls: "novel-tab-content chapters-tab",
		});
		this.fragmentsTabContainer = contentEl.createDiv({
			cls: "novel-tab-content fragments-tab",
			attr: { style: "display: none;" },
		});

		// Inject existing containers into the Chapters tab wrapper
		this.controlsContainer = this.chaptersTabContainer.createDiv({
			cls: "novel-chapter-controls",
		});
		this.tableContainer = this.chaptersTabContainer.createDiv({
			cls: "novel-chapter-table-container",
		});

		await this.updateView(true); // Initial render
	}

	// Called when the view is closed
	async onClose(): Promise<void> {
		// Nothing to clean up
	}

	// Renders the controls and settings for the plugin
	async updateView(settingsHaveChanged = false) {
		// If settings have changed, re-render the controls and tabs
		if (settingsHaveChanged) {
			this.renderTabs(); // Render the top toggle buttons
			await this.renderControls();
		}

		// Render the chapter table
		// Check if a novel project is selected
		if (
			!this.selectedNovelProjectId ||
			!this.plugin.settings.novelProjects.find(
				(p) => p.id === this.selectedNovelProjectId,
			)
		) {
			// Check if the last selected novel ID is set and valid
			if (
				this.plugin.settings.lastSelectedNovelId &&
				this.plugin.settings.novelProjects.find(
					(p) => p.id === this.plugin.settings.lastSelectedNovelId,
				)
			) {
				// If valid, set it as the selected project ID
				this.selectedNovelProjectId =
					this.plugin.settings.lastSelectedNovelId;

				// If no valid last selected novel ID, default to the first project if available
			} else if (this.plugin.settings.novelProjects.length > 0) {
				this.selectedNovelProjectId =
					this.plugin.settings.novelProjects[0].id;
			} else {
				// If no projects are available, reset the selected project ID to null
				this.selectedNovelProjectId = null;
			}

			// Update the select element to reflect the current selection
			const selectEl =
				this.controlsContainer.querySelector<HTMLSelectElement>(
					"select.novel-project-selector",
				);

			// If the select element exists, set its value to the selected project ID
			if (selectEl && this.selectedNovelProjectId) {
				selectEl.value = this.selectedNovelProjectId;
			} else if (
				// If no project is selected and the select element exists, set it to the first project
				selectEl &&
				!this.selectedNovelProjectId &&
				this.plugin.settings.novelProjects.length > 0
			) {
				selectEl.value = this.plugin.settings.novelProjects[0].id;
			}
		}

		this.updateLeafDisplayText(); // Update the leaf display text based on the selected project
		await this.renderChapterTable(); // Render the chapter table based on the selected project
		await this.renderFragmentsTab(); // Build the fragments tab
		this.switchTab(this.activeTab); // Ensure the correct CSS display state is active
	}

	private renderTabs() {
		this.tabsContainer.empty(); // Clear the tabs container

		// Check the global setting: hide tabs if fragments are disabled
		if (!this.plugin.settings.enableFragments) {
            this.activeTab = "chapters";
            this.tabsContainer.hide(); // <-- The clean Obsidian API method
            return;
        }

		const btnChapters = this.tabsContainer.createEl("button", {
			text: "Chapters",
		});
		const btnFragments = this.tabsContainer.createEl("button", {
			text: "Fragments",
		});

		btnChapters.onclick = () => this.switchTab("chapters");
		btnFragments.onclick = () => this.switchTab("fragments");

		// Visually highlight the active tab using Obsidian's native CTA class
		btnChapters.className = this.activeTab === "chapters" ? "mod-cta" : "";
		btnFragments.className =
			this.activeTab === "fragments" ? "mod-cta" : "";
	}

	private switchTab(tab: "chapters" | "fragments") {
		this.activeTab = tab;
		this.chaptersTabContainer.style.display =
			tab === "chapters" ? "" : "none";
		this.fragmentsTabContainer.style.display =
			tab === "fragments" ? "flex" : "none";

		this.renderTabs(); // Update button active states
	}

	private async renderFragmentsTab() {
		this.fragmentsTabContainer.empty();
		if (!this.plugin.settings.enableFragments) return;

		// Top: Project Selector
		const topControlsContainer = this.fragmentsTabContainer.createDiv({
			cls: "fragments-top-controls",
		});

		const selectorWrapper = topControlsContainer.createDiv({
			cls: "fragments-selector-container",
		});
		this.buildProjectSelector(selectorWrapper);

		const searchWrapper = topControlsContainer.createDiv({
			cls: "fragments-search-container",
		});
		const searchInput = searchWrapper.createEl("input", {
			type: "text",
			placeholder: "Search fragments...",
			value: this.fragmentSearchTerm,
			cls: "novel-chapter-search-input",
		});

		// Middle: The Notes Feed (Skeleton)
		const feedContainer = this.fragmentsTabContainer.createDiv({
			cls: "fragments-feed-container",
		});

		// Search event listener (updates feed instantly as you type)
		const debouncedFragSearch = debounce(async (value: string) => {
			this.fragmentSearchTerm = value;
			await this.buildNotesFeed(feedContainer);
		}, 250);

		searchInput.addEventListener("input", (e) => {
			debouncedFragSearch((e.target as HTMLInputElement).value);
		});

		// Initial load of the feed
		await this.buildNotesFeed(feedContainer);

		// Bottom: Creation Box
		const createContainer = this.fragmentsTabContainer.createDiv({
			cls: "fragments-create-container",
		});

		// Wrapper to place Title and Save Button on the same line
		const createHeader = createContainer.createDiv({
			cls: "fragments-create-header",
		});

		const titleInput = createHeader.createEl("input", {
			type: "text",
			placeholder: "Fragment Title (Optional)",
		});

		// Using the same ButtonComponent configuration as your New Chapter button
		const createBtn = new ButtonComponent(createHeader)
			.setIcon("plus")
			.setTooltip("Save Idea (Ctrl+Enter or Cmd+Enter)")
			.setClass("novel-chapter-new-button");

		const contentArea = createContainer.createEl("textarea", {
			attr: {
				placeholder:
					"Write your fragment here... (Ctrl+Enter or Cmd+Enter to save)",
			},
		});

		// Note Creation Logic
		const saveIdea = async () => {
			const content = contentArea.value.trim();
			if (!content) {
				new Notice("Cannot save an empty fragment.");
				return;
			}

			const currentProject = this.plugin.settings.novelProjects.find(
				(p) => p.id === this.selectedNovelProjectId,
			);
			if (!currentProject || !currentProject.fragmentsPath) {
				new Notice("No fragments path configured for this project.");
				return;
			}

			let rawTitle = titleInput.value.trim();
			if (!rawTitle) {
				const words = content.split(/\s+/).slice(0, 4).join(" ");
				rawTitle =
					words.replace(/[\\/:*?"<>|]/g, "") ||
					`Fragment-${Date.now()}`;
			} else {
				rawTitle = rawTitle.replace(/[\\/:*?"<>|]/g, "");
			}

			const folderPath = normalizePath(currentProject.fragmentsPath);
			const newPath = normalizePath(`${folderPath}/${rawTitle}.md`);

			if (!(await this.app.vault.adapter.exists(folderPath))) {
				try {
					await this.app.vault.createFolder(folderPath);
				} catch (e) {
					console.error("Failed to create Fragments folder.", e);
					new Notice("Failed to create the fragments folder path.");
					return;
				}
			}

			if (await this.app.vault.adapter.exists(newPath)) {
				new Notice(
					"A fragment with this exact name already exists. Please tweak the title.",
				);
				return;
			}

			try {
				await this.app.vault.create(newPath, content);
				new Notice("Fragment saved!");

				titleInput.value = "";
				contentArea.value = "";

				// Re-render feed instead of whole tab to preserve focus
				await this.buildNotesFeed(feedContainer);
			} catch (err) {
				console.error("Error creating fragment:", err);
				new Notice("Failed to save fragment. See console.");
			}
		};

		// Bind click to the save function
		createBtn.onClick(saveIdea);

		// Bind Ctrl+Enter (or Cmd+Enter) to the save function
		contentArea.addEventListener(
			"keydown",
			(e) => {
				if (
					(e.key === "Enter" || e.code === "Enter") &&
					(e.ctrlKey || e.metaKey)
				) {
					e.preventDefault(); // Prevent standard line break
					e.stopPropagation(); // Stop Obsidian from stealing the event
					saveIdea().catch(console.error);
				}
			},
			{ capture: true },
		);
	}

	private async buildNotesFeed(feedContainer: HTMLElement) {
		feedContainer.empty();

		const currentProject = this.plugin.settings.novelProjects.find(
			(p) => p.id === this.selectedNovelProjectId,
		);
		if (!currentProject || !currentProject.fragmentsPath) {
			feedContainer.createEl("p", {
				text: "No fragments path configured for this project.",
				cls: "nav-empty-state-title",
			});
			return;
		}

		const fragments = this.plugin.getProjectFragments(
			currentProject.fragmentsPath,
		);

		if (fragments.length === 0) {
			feedContainer.createEl("p", {
				text: "No fragments found. Write your first idea below!",
				cls: "nav-empty-state-title",
			});
			return;
		}

		const searchTermLower = this.fragmentSearchTerm.toLowerCase();
		let visibleCount = 0;

		for (const file of fragments) {
			// Read content immediately so we can search inside it
			const content = await this.app.vault.cachedRead(file);

			// Apply Search Filter
			if (searchTermLower) {
				const titleMatch = file.basename
					.toLowerCase()
					.includes(searchTermLower);
				const contentMatch = content
					.toLowerCase()
					.includes(searchTermLower);
				// If neither matches, skip rendering this block
				if (!titleMatch && !contentMatch) continue;
			}

			visibleCount++;

			const blockContainer = feedContainer.createDiv({
				cls: "fragment-block",
			});

			// Header Area
			const headerEl = blockContainer.createDiv({
				cls: "fragment-header",
			});
			headerEl.createEl("h4", {
				text: file.basename,
				cls: "fragment-title",
			});

			const actionsEl = headerEl.createDiv({ cls: "fragment-actions" });

			const openBtn = actionsEl.createEl("button", {
				cls: "clickable-icon",
			});
			setIcon(openBtn, "file-symlink");
			openBtn.onclick = async () => {
				const leaf = this.app.workspace.getLeaf("tab");
				await leaf.openFile(file);
			};

			const copyBtn = actionsEl.createEl("button", {
				cls: "clickable-icon",
			});
			setIcon(copyBtn, "copy");
			copyBtn.onclick = async () => {
				const contentToCopy = await this.app.vault.cachedRead(file);
				await navigator.clipboard.writeText(contentToCopy);
				new Notice("Fragment copied to clipboard!");
			};

			const editBtn = actionsEl.createEl("button", {
				cls: "clickable-icon",
			});
			setIcon(editBtn, "pencil");
			editBtn.onclick = () => {
				new ChapterNameModal(
					this.app,
					"Rename Fragment",
					"Rename",
					file.basename,
					(newName) => {
						if (newName && newName !== file.basename) {
							const sanitized = newName
								.replace(/[\\/:*?"<>|]/g, "")
								.trim();
							if (sanitized) {
								const newPath = `${file.parent?.path}/${sanitized}.md`;

								const processRename = async () => {
									await this.app.fileManager.renameFile(
										file,
										newPath,
									);
									await this.renderFragmentsTab();
								};

								void processRename();
							}
						}
					},
				).open();
			};

			const deleteBtn = actionsEl.createEl("button", {
				cls: "clickable-icon",
			});
			setIcon(deleteBtn, "trash");
			deleteBtn.onclick = () => {
				new ConfirmationModal(
					this.app,
					`Delete fragment "${file.basename}"?`,
					() => {
						void (async () => {
							await this.app.fileManager.trashFile(file);
							await this.renderFragmentsTab();
						})();
					},
				).open();
			};

			// Text Content Area
			const textContainer = blockContainer.createDiv({
				cls: "fragment-content",
			});
			textContainer.createEl("pre", { text: content });
		}

		// If everything was filtered out
		if (visibleCount === 0 && searchTermLower) {
			feedContainer.createEl("p", {
				text: `No fragments found matching "${this.fragmentSearchTerm}".`,
				cls: "nav-empty-state-title",
			});
		}
	}

	// Updates the leaf display text to reflect the current project
	private updateLeafDisplayText() {
		if (this.leaf) {
			this.leaf
				.setViewState(this.leaf.getViewState())
				.catch(console.error);
		}
	}

	private buildProjectSelector(parentEl: HTMLElement) {
		// Create the select element directly on the provided parent
		const selectEl = parentEl.createEl("select");
        selectEl.addClass("novel-project-selector");

		const projects = this.plugin.settings.novelProjects;

		// If no projects are available, show a message
		if (projects.length === 0) {
			parentEl.setText(
				"No novel projects configured. Please add one in plugin settings.",
			);
			return;
		}

		// Create an option for each project
		projects.forEach((project) => {
			selectEl.createEl("option", {
				text: project.name || "Unnamed Novel",
				value: project.id,
			});
		});

		// Maintain the selected state
		if (
			this.selectedNovelProjectId &&
			projects.find((p) => p.id === this.selectedNovelProjectId)
		) {
			selectEl.value = this.selectedNovelProjectId;
		} else if (projects.length > 0) {
			this.selectedNovelProjectId = projects[0].id;
			selectEl.value = this.selectedNovelProjectId;
		}

		// Event listener for when the selected project changes
		selectEl.addEventListener("change", (event) => {
			this.selectedNovelProjectId = (
				event.target as HTMLSelectElement
			).value;
			this.plugin.settings.lastSelectedNovelId =
				this.selectedNovelProjectId;

			const saveAndUpdate = async () => {
				await this.plugin.saveSettings();
				await this.updateView();
			};

			void saveAndUpdate();
		});
	}

	// Renders the controls for managing novel projects
	async renderControls(): Promise<void> {
		this.controlsContainer.empty();

		const projects = this.plugin.settings.novelProjects;
		if (projects.length === 0) {
			this.controlsContainer.setText(
				"No novel projects configured. Please add one in plugin settings.",
			);
			return;
		}

		const controlsLine1 = this.controlsContainer.createDiv({
			cls: "novel-chapter-controls-line",
		});
		const controlsLine2 = this.controlsContainer.createDiv({
			cls: "novel-chapter-controls-line",
		});

		this.buildProjectSelector(controlsLine1);

		// Open Template Folder Button
		new ButtonComponent(controlsLine1)
			.setIcon("file-symlink")
			.setTooltip("Open template folder")
			.onClick(() => {
				// Get the template path
				const templatePath = this.plugin.settings.chapterTemplatePath;

				// Check if template path exist
				if (!templatePath || templatePath.trim() === "") {
					new Notice(
						"Chapter template path is not configured in settings.",
					);
					return;
				}

				// Get current open file
				const currentFile = this.app.workspace.getActiveFile();

				this.app.workspace
					.openLinkText(templatePath, "", !currentFile)
					.catch(console.error);
			});

		// Collapse/Expand All Button
		new ButtonComponent(controlsLine1)
			.setIcon("chevrons-down")
			.setTooltip("Toggle folder groups")
			.onClick(() => {
				this.allCollapsed = !this.allCollapsed;

				// Grab all header rows and data rows currently in the DOM
				const headers =
					this.tableContainer.querySelectorAll<HTMLElement>(
						"tr.chapter-group-header",
					);
				const chapterRows =
					this.tableContainer.querySelectorAll<HTMLElement>(
						"tr.chapter-data-row",
					);

				headers.forEach((header) => {
					const iconEl = header.querySelector(".group-toggle-icon");
					if (this.allCollapsed) {
						header.classList.add("collapsed");
						if (iconEl)
							setIcon(iconEl as HTMLElement, "chevron-right");
					} else {
						header.classList.remove("collapsed");
						if (iconEl)
							setIcon(iconEl as HTMLElement, "chevron-down");
					}
				});

				chapterRows.forEach((row) => {
					row.style.display = this.allCollapsed ? "none" : "";
				});
			});

		// Previous Chapter Button
		new ButtonComponent(controlsLine1)
			.setIcon("chevron-left")
			.setTooltip("Previous chapter")
			.onClick(() => {
				// Get the currently active file in the workspace
				const currentFile = this.app.workspace.getActiveFile();
				// If no file is open, show a notice
				if (!currentFile) {
					new Notice("Open a chapter file to use navigation.");
					return;
				}
				// Find the project for the current file
				const project = this.plugin.findProjectForFile(currentFile);
				// If the project is not found or doesn't match the selected project, show a notice
				if (!project || project.id !== this.selectedNovelProjectId) {
					new Notice(
						"The active chapter doesn't belong to the selected project.",
					);
					return;
				}
				// Get the chapters for the current project
				const chapters = this.plugin.getProjectChapters(project.path);
				// Find the index of the current chapter
				const currentIndex = chapters.findIndex(
					(chap) => chap.path === currentFile.path,
				);
				// If the current chapter is found and is not the first one, open the previous chapter
				if (currentIndex > 0) {
					this.app.workspace
						.openLinkText(
							chapters[currentIndex - 1].path,
							"",
							false,
						)
						.catch(console.error);
				} else {
					new Notice("This is the first chapter.");
				}
			});

		// Next Chapter Button
		new ButtonComponent(controlsLine1)
			.setIcon("chevron-right")
			.setTooltip("Next chapter")
			.onClick(() => {
				// Get the currently active file in the workspace
				const currentFile = this.app.workspace.getActiveFile();
				// If no file is open, show a notice
				if (!currentFile) {
					new Notice("Open a chapter file to use navigation.");
					return;
				}
				// Find the project for the current file
				const project = this.plugin.findProjectForFile(currentFile);
				if (!project || project.id !== this.selectedNovelProjectId) {
					new Notice(
						"The active chapter doesn't belong to the selected project.",
					);
					return;
				}
				// Get the chapters for the current project
				const chapters = this.plugin.getProjectChapters(project.path);
				// Find the index of the current chapter
				const currentIndex = chapters.findIndex(
					(chap) => chap.path === currentFile.path,
				);
				// If the current chapter is found and is not the last one, open the next chapter
				if (currentIndex !== -1 && currentIndex < chapters.length - 1) {
					this.app.workspace
						.openLinkText(
							chapters[currentIndex + 1].path,
							"",
							false,
						)
						.catch(console.error);
				} else {
					new Notice("This is the last chapter.");
				}
			});

		// New Chapter Button
		new ButtonComponent(controlsLine1)
			.setIcon("plus")
			.setTooltip("New chapter")
			.setClass("novel-chapter-new-button")
			.onClick(async () => {
				// Prompt the user to create a new chapter in the selected project
				await this.plugin.promptAndCreateNewChapter(
					this.selectedNovelProjectId,
				);
			});

		// Search Input
		const debouncedSearch = debounce((value: string) => {
			this.searchTerm = value;
			this.renderChapterTable().catch(console.error);
		}, 250); // 250ms delay

		new TextComponent(controlsLine2)
			.setPlaceholder("Search chapters...")
			.setValue(this.searchTerm)
			.onChange(debouncedSearch)
			.inputEl.addClass("novel-chapter-search-input");

		// Property Filter Dropdown
		const { propertyOptions } = this.plugin.settings;
		// If there are property options defined, create a filter dropdown
		const optionsArray = propertyOptions
			.split(",")
			.map((opt) => opt.trim())
			.filter((opt) => opt.length > 0);
		// If there are options to filter by, create a select element
		if (optionsArray.length > 0) {
			const filterSelect = controlsLine2.createEl("select");
			filterSelect.addClass("novel-chapter-filter-select");
			filterSelect.createEl("option", {
				text: "Filter by property...",
				value: "all",
			});
			// Create an option for each property in the options array
			optionsArray.forEach((option) => {
				filterSelect.createEl("option", {
					text: option,
					value: option,
				});
			});
			// Set the current filter value
			filterSelect.value = this.filterValue;
			// Event listener for when the filter value changes
			filterSelect.addEventListener("change", (event) => {
				this.filterValue = (event.target as HTMLSelectElement).value;
				this.renderChapterTable().catch(console.error); // Re-render the chapter table with the new filter value
			});
		}
	}

	// Renders the chapter table based on the selected novel project
	async renderChapterTable(): Promise<void> {
		this.tableContainer.empty(); // Clear existing table content

		if (!this.selectedNovelProjectId) return; // If no project is selected, do nothing

		// Find the current novel project based on the selected ID
		const currentNovelProject = this.plugin.settings.novelProjects.find(
			(p) => p.id === this.selectedNovelProjectId,
		);
		// If the project is not found, show an error message
		if (!currentNovelProject) {
			this.tableContainer.setText("Selected novel project not found.");
			return;
		}

		// Get the chapters folder path for the current project
		const { path: chaptersFolderPath } = currentNovelProject;
		// Get the property settings for filtering
		const {
			showProperty,
			propertyNameToChange,
			propertyColumnHeader,
			propertyOptions,
		} = this.plugin.settings;
		// Split the property options into an array
		const optionsArray = propertyOptions
			.split(",")
			.map((opt) => opt.trim())
			.filter((opt) => opt.length > 0);

		// If no chapters folder path is configured, show a message
		if (!chaptersFolderPath || chaptersFolderPath.trim() === "") {
			this.tableContainer.setText(
				`Project "${currentNovelProject.name}" has no folder path configured.`,
			);
			return;
		}

		// Normalize the chapters folder path and get all markdown files in it
		const normalizedChaptersFolderPath = normalizePath(chaptersFolderPath);
		const files = this.app.vault.getMarkdownFiles();
		let chapterFiles = files.filter((file) =>
			isFileInFolder(file, normalizedChaptersFolderPath),
		);

		// Apply Property Filter
		// Apply Property Filter
        if (this.filterValue !== "all") {
            chapterFiles = chapterFiles.filter((file) => {
                const fileCache = this.app.metadataCache.getFileCache(file);
                
                // 1. Safely absorb the 'any' into an 'unknown' variable
                const propValue: unknown = fileCache?.frontmatter?.[propertyNameToChange];
                
                // 2. Perform the strict equality check safely
                return propValue === this.filterValue;
            });
        }
		// Apply Search Term Filter
		if (this.searchTerm) {
			chapterFiles = chapterFiles.filter((file) =>
				file.basename
					.toLowerCase()
					.includes(this.searchTerm.toLowerCase()),
			);
		}

		// If no chapters are found, show a message
		if (chapterFiles.length === 0) {
			this.tableContainer.setText(
				`No chapters found in "${normalizedChaptersFolderPath}" matching your criteria.`,
			);
			return;
		}

		const OTHER_GROUP_NAME = this.plugin.settings.otherGroupName || "Other"; // Default name for the "Other" group
		const groupedChapters = new Map<string, TFile[]>(); // Map to group chapters by their folder name

		// Group chapters by their folder name
		for (const file of chapterFiles) {
			// Normalize the file path and extract the relative path
			const folderPathWithSlash = normalizedChaptersFolderPath.endsWith(
				"/",
			)
				? normalizedChaptersFolderPath
				: `${normalizedChaptersFolderPath}/`;
			const relativePath = normalizePath(file.path).substring(
				folderPathWithSlash.length,
			);
			const pathParts = relativePath.split("/");

			// Use the first part of the path as the group name, or "Other" if no group is specified
			let groupName = OTHER_GROUP_NAME;
			// If the path has more than one part, use the first part as the group name
			if (pathParts.length > 1) {
				groupName = pathParts[0];
			}

			// If the group name is empty (that means, it has one part), use "Other"
			if (!groupedChapters.has(groupName)) {
				groupedChapters.set(groupName, []);
			}
			// Add the file to the corresponding group
			groupedChapters.get(groupName)?.push(file);
		}

		// Sort the groups and their files
		for (const filesInGroup of groupedChapters.values()) {
			filesInGroup.sort((a, b) => a.path.localeCompare(b.path));
		}

		// Sort the group names, ensuring "Other" is always at the end
		const sortedGroupNames = Array.from(groupedChapters.keys()).sort(
			(a, b) => {
				if (a === OTHER_GROUP_NAME) return 1;
				if (b === OTHER_GROUP_NAME) return -1;
				return a.localeCompare(b);
			},
		);

		// Calculate the total count of chapters, excluding "Other" group if configured
		let totalCount = chapterFiles.length;
		if (this.plugin.settings.excludeOtherFromCount) {
			const otherGroupFiles = groupedChapters.get(OTHER_GROUP_NAME);
			if (otherGroupFiles) {
				totalCount -= otherGroupFiles.length;
			}
		}

		const table = this.tableContainer.createEl("table", {
			cls: "novel-chapter-table",
		});

		// Calculate the number of columns based on whether a property is being changed
		const numColumns =
			1 +
			(showProperty && propertyNameToChange && optionsArray.length > 0
				? 1
				: 0);

		// Render Table Header with new total count
		const thead = table.createEl("thead");
		const headerRow = thead.createEl("tr");
		headerRow.createEl("th", { text: `Chapter (${totalCount})` });
		if (showProperty && propertyNameToChange && optionsArray.length > 0) {
			const propertyHeader =
				propertyColumnHeader.trim() || propertyNameToChange;
			headerRow.createEl("th", { text: propertyHeader });
		}

		// Render Table Body with grouped chapters
		const tbody = table.createEl("tbody");
		for (const groupName of sortedGroupNames) {
			// Create a header row for each group
			const groupFiles = groupedChapters.get(groupName);
			if (!groupFiles) continue;

			// Generate a unique ID for the group based on its name
			const groupId = `group-${groupName.replace(/[^a-zA-Z0-9]/g, "-")}`;

			const groupHeaderRow = tbody.createEl("tr", {
				cls: "chapter-group-header",
			});

			// Create a header cell that spans all columns
			const groupHeaderCell = groupHeaderRow.createEl("td");
			groupHeaderCell.colSpan = numColumns;

			// Create a toggle icon for expanding/collapsing the group
			const iconEl = groupHeaderCell.createSpan({
				cls: "group-toggle-icon",
			});
			setIcon(iconEl, "chevron-down");

			// Create a span for the group name and count
			groupHeaderCell.createSpan({
				text: ` ${groupName} (${groupFiles.length})`,
			});

			// Add an event listener to toggle the visibility of the group rows
			groupHeaderRow.addEventListener("click", () => {
				const isCollapsed =
					groupHeaderRow.classList.toggle("collapsed");
				setIcon(iconEl, isCollapsed ? "chevron-right" : "chevron-down");

				const chapterRows = tbody.querySelectorAll<HTMLElement>(
					`tr.chapter-data-row[data-group-id="${groupId}"]`,
				);
				chapterRows.forEach((row) => {
					row.style.display = isCollapsed ? "none" : "";
				});
			});

			// For each file in the group, create a row in the table
			for (const file of groupFiles) {
				const row = tbody.createEl("tr", { cls: "chapter-data-row" });
				row.dataset.groupId = groupId;

				const chapterCell = row.createEl("td");
				const chapterLink = chapterCell.createEl("a", {
					text: file.basename,
					href: "#",
					cls: "internal-link",
				});

				// Set the icon for the chapter link
				chapterLink.addEventListener("click", (ev) => {
					ev.preventDefault();
					this.app.workspace
						.openLinkText(file.path, "", false)
						.catch(console.error);
				});

				// Add a context menu for the chapter link
				// This allows for actions like renaming, deleting, and moving chapters
				chapterLink.addEventListener(
					"contextmenu",
					(ev: MouseEvent) => {
						ev.preventDefault();
						const menu = new Menu();

						// Rename Action
						menu.addItem((item: MenuItem) =>
							item
								.setTitle("Rename")
								.setIcon("pencil")
								.onClick(() => {
									this.plugin
										.promptAndRenameChapter(file)
										.catch(console.error); // Prompt the user to rename the chapter
								}),
						);

						// Delete Action
						menu.addItem((item: MenuItem) =>
							item
								.setTitle("Delete")
								.setIcon("trash")
								.onClick(() => {
									this.plugin
										.promptAndDeleteChapter(file)
										.catch(console.error); // Prompt the user to confirm deletion of the chapter
								}),
						);

						menu.addSeparator();

						// Move Action - Opens a new menu onClick
						menu.addItem((item: MenuItem) => {
							item.setTitle("Move to...")
								.setIcon("folder-move")
								.onClick(() => {
									// Create a new menu that acts as the submenu
									const folderMenu = new Menu();

									// Get all subfolders in the chapters folder
									const projectSubfolders: string[] = [];
									const projectFolder =
										this.app.vault.getAbstractFileByPath(
											normalizedChaptersFolderPath,
										);
									// If the project folder exists and is a TFolder, iterate through its children
									// and collect subfolders
									if (projectFolder instanceof TFolder) {
										for (const child of projectFolder.children) {
											if (child instanceof TFolder) {
												projectSubfolders.push(
													child.path,
												);
											}
										}
									}
									// Sort the subfolders alphabetically
									projectSubfolders.sort();

									// Get the name for the "Other" group from settings or use default
									const OTHER_GROUP_NAME =
										this.plugin.settings.otherGroupName ||
										"Other";
									// Get the current file's parent path to determine if it is already in the chapters folder
									const currentFileParentPath =
										file.parent?.path || "";

									// Add "Other" folder option to the new menu
									folderMenu.addItem((subitem: MenuItem) => {
										subitem
											.setTitle(OTHER_GROUP_NAME)
											.setIcon("folder-up")
											.onClick(() => {
												this.plugin
													.moveChapter(
														file,
														normalizedChaptersFolderPath,
													)
													.catch(console.error);
											});

										// Disable the "Other" option if the current file is already in the chapters folder
										if (
											currentFileParentPath ===
											normalizedChaptersFolderPath
										) {
											subitem.setDisabled(true);
										}
									});

									// Add a separator if there are subfolders to avoid clutter
									if (projectSubfolders.length > 0) {
										folderMenu.addSeparator();
									}

									// Add actual subfolders to the new menu
									projectSubfolders.forEach((folderPath) => {
										const folderName =
											folderPath.split("/").pop() ||
											folderPath;
										folderMenu.addItem(
											(subitem: MenuItem) => {
												subitem
													.setTitle(folderName)
													.setIcon("folder")
													.onClick(() => {
														this.plugin
															.moveChapter(
																file,
																folderPath,
															)
															.catch(
																console.error,
															);
													});

												// Disable the option if the current file is already in that folder
												if (
													currentFileParentPath ===
													normalizePath(folderPath)
												) {
													subitem.setDisabled(true);
												}
											},
										);
									});

									// Show the new menu at the location of the original click
									folderMenu.showAtMouseEvent(ev);
								});
						});

						// Show the context menu at the mouse event location
						menu.showAtMouseEvent(ev);
					},
				);

				// If a property is defined to change, create a select element for it
                if (
                    showProperty &&
                    propertyNameToChange &&
                    optionsArray.length > 0
                ) {
                    const propertyCell = row.createEl("td");
                    const selectEl = propertyCell.createEl("select");
                    const fileCache = this.app.metadataCache.getFileCache(file);
                    
                    const rawValue: unknown = fileCache?.frontmatter?.[propertyNameToChange];
                    const currentPropertyValue = typeof rawValue === "string" ? rawValue : "";

					// Create a default option for the select element
					const defaultOption = selectEl.createEl("option", {
						text: "--- select ---",
						value: "",
					});
					// If the current property value is empty, set the default option as selected
					if (!currentPropertyValue) defaultOption.selected = true;

					// Create an option for each property in the options array
					optionsArray.forEach((option) => {
						const optionEl = selectEl.createEl("option", {
							text: option,
							value: option,
						});
						if (option === currentPropertyValue)
							optionEl.selected = true;
					});

					// Add an event listener to handle changes in the select element
					selectEl.addEventListener("change", (event) => {
						const newValue = (event.target as HTMLSelectElement)
							.value;
						// Update the chapter property with the new value
						void this.plugin.updateChapterProperty(
							file,
							propertyNameToChange,
							newValue,
						);
					});
				}
			}
		}
	}
}

// Main plugin class
export default class NovelChapterPlugin extends Plugin {
	settings!: InternalNovelChapterPluginSettings; // Plugin settings

	// Helper function for getting files
	public getMarkdownFilesInFolder(folderPath: string): TFile[] {
		const folder = this.app.vault.getAbstractFileByPath(
			normalizePath(folderPath),
		);
		const files: TFile[] = [];

		if (folder instanceof TFolder) {
			const recurse = (currentFolder: TFolder) => {
				for (const child of currentFolder.children) {
					if (child instanceof TFile && child.extension === "md") {
						files.push(child);
					} else if (child instanceof TFolder) {
						recurse(child);
					}
				}
			};
			recurse(folder);
		}
		return files;
	}

	// Helper to get sorted chapters for a given project path
	public getProjectChapters(projectPath: string): TFile[] {
		if (!projectPath || projectPath.trim() === "") return [];

		const chapterFiles = this.getMarkdownFilesInFolder(projectPath);
		chapterFiles.sort((a, b) => a.path.localeCompare(b.path));
		return chapterFiles;
	}

	// Helper to get sorted fragments for a given project path
	public getProjectFragments(fragmentsPath: string): TFile[] {
		if (!fragmentsPath || fragmentsPath.trim() === "") return [];

		const fragmentFiles = this.getMarkdownFilesInFolder(fragmentsPath);
		fragmentFiles.sort((a, b) => b.stat.mtime - a.stat.mtime);
		return fragmentFiles;
	}

	// Method to move a chapter file to a new folder
	public async moveChapter(
		fileToMove: TFile,
		destinationFolderPath: string,
	): Promise<void> {
		// Create the new path for the file in the destination folder
		const newPath = normalizePath(
			`${destinationFolderPath}/${fileToMove.name}`,
		);

		// Check if the file is already in the destination folder
		if (fileToMove.path === newPath) {
			new Notice("Chapter is already in that folder.");
			return;
		}

		// Check if the destination folder exists
		if (await this.app.vault.adapter.exists(newPath)) {
			new Notice(
				`A file named "${fileToMove.name}" already exists in the destination.`,
			);
			return;
		}

		// Attempt to rename (move) the file to the new path
		try {
			await this.app.fileManager.renameFile(fileToMove, newPath);
			new Notice(`Moved "${fileToMove.basename}" successfully.`);
		} catch (error) {
			console.error("Error moving chapter:", error);
			new Notice("Failed to move chapter. See console for details.");
		}
	}

	// Helper to find which project a file belongs to
	public findProjectForFile(file: TFile): NovelProject | null {
		if (!file) return null; // If no file is provided, return null
		return (
			this.settings.novelProjects.find(
				(p) => p.path && isFileInFolder(file, p.path),
			) || null
		);
	}

	// Method to update a chapter's frontmatter property
	public async updateChapterProperty(
		file: TFile,
		propertyName: string,
		newValue: string,
	): Promise<void> {
		try {
			// Process the frontmatter of the file to update the specified property
			// If the new value is empty, delete the property from frontmatter
			await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				if (newValue === "") {
					delete fm[propertyName];
				} else {
					fm[propertyName] = newValue;
				}
			});
			new Notice(`Chapter '${file.basename}' ${propertyName} updated.`);
		} catch (error) {
			console.error(
				`Error updating frontmatter for ${file.path}:`,
				error,
			);
			new Notice(
				`Failed to update ${propertyName} for ${file.basename}.`,
			);
		}
	}

	// Method to prompt for renaming a chapter
	public async promptAndRenameChapter(file: TFile): Promise<void> {
		const currentName = file.basename; // Get the current chapter name

		// Create and open a modal to prompt the user for a new chapter name
		new ChapterNameModal(
			this.app,
			"Rename Chapter",
			"Rename",
			currentName,
			(newName) => {
				if (newName && newName !== currentName) {
					this.renameChapter(file, newName).catch((error) => {
						console.error("Error renaming chapter:", error);
					});
				}
			},
		).open();
	}

	// Logic to rename a chapter file
	private async renameChapter(file: TFile, newName: string): Promise<void> {
		// Sanitize the new chapter name to remove invalid characters
		const sanitizedFileName = newName.replace(/[\\/:*?"<>|]/g, "").trim();

		// Check if the sanitized name is empty
		if (sanitizedFileName === "") {
			new Notice("Invalid chapter name provided.");
			return;
		}

		// Check if the file has a parent folder
		// If not, show an error message and return
		if (!file.parent) {
			new Notice("Cannot rename file: No parent folder found.");
			console.error("Could not find parent for file:", file.path);
			return;
		}

		// Create the new path for the renamed file
		const newPath = `${file.parent.path}/${sanitizedFileName}.md`;

		// Check if a file with the new name already exists
		// If it does, show a notice and return
		if (await this.app.vault.adapter.exists(normalizePath(newPath))) {
			new Notice(
				`A chapter named "${sanitizedFileName}.md" already exists.`,
			);
			return;
		}

		// Attempt to rename the file using the file manager
		try {
			await this.app.fileManager.renameFile(file, newPath);
			new Notice(`Chapter renamed to "${sanitizedFileName}".`);
		} catch (error) {
			console.error("Error renaming file:", error);
			new Notice("Failed to rename chapter. See console for details.");
		}
	}

	// Method to prompt for chapter deletion
	public async promptAndDeleteChapter(file: TFile): Promise<void> {
		// Create and open a confirmation modal to ask the user if they want to delete the chapter
		new ConfirmationModal(
			this.app,
			`Are you sure you want to delete "${file.basename}"? This will move the file to the trash.`,
			() => {
				void this.deleteChapter(file);
			},
		).open();
	}

	// Logic to delete the chapter file
	private async deleteChapter(file: TFile): Promise<void> {
		// Try to move the file to the trash
		try {
			await this.app.fileManager.trashFile(file);
			new Notice(`Chapter "${file.basename}" moved to trash.`);
		} catch (error) {
			console.error("Error deleting file:", error);
			new Notice("Failed to delete chapter. See console for details.");
		}
	}

	// Method to prompt for creating a new chapter
	public async promptAndCreateNewChapter(
		projectId: string | null,
	): Promise<void> {
		// Check if a project ID is provided
		if (!projectId) {
			new Notice("Please select a novel project first.");
			return;
		}

		// Find the current novel project based on the provided ID
		const currentNovelProject = this.settings.novelProjects.find(
			(p) => p.id === projectId,
		);

		// If the project is not found or does not have a valid path, show an error message
		if (!currentNovelProject || !currentNovelProject.path?.trim()) {
			new Notice(
				"The selected project does not have a valid folder path configured.",
			);
			return;
		}

		const projectRootPath = normalizePath(currentNovelProject.path);
		const projectFolder =
			this.app.vault.getAbstractFileByPath(projectRootPath);

		// Create a list to hold the folder choices for the dropdown.
		const folderOptions: { name: string; path: string }[] = [];

		// The first option is always the project's root folder (other group)
		folderOptions.push({
			name: this.settings.otherGroupName || "Other",
			path: projectRootPath,
		});

		// If the project folder exists, look for subfolders inside it.
		if (projectFolder instanceof TFolder) {
			for (const child of projectFolder.children) {
				if (child instanceof TFolder) {
					// Add each subfolder to our list of options.
					folderOptions.push({
						name: child.name,
						path: child.path,
					});
				}
			}
		}

		// Create and open a modal to prompt the user for a new chapter name
		new NewChapterModal(
			this.app,
			"Enter New Chapter Name",
			"Create Chapter",
			folderOptions,
			// 1. Removed 'async' from the main callback
			(selectedFolderPath, chapterName) => {
				// 2. Wrap all the complex file creation logic inside an async function
				const createChapterFile = async () => {
					// Sanitize the chapter name to remove invalid characters
					const sanitizedFileName = chapterName
						.replace(/[\\/:*?"<>|]/g, "")
						.trim();
					if (sanitizedFileName === "") {
						new Notice("Invalid chapter name.");
						return;
					}

					// Check if the selected folder exists
					if (
						!(await this.app.vault.adapter.exists(
							selectedFolderPath,
						))
					) {
						new Notice(
							`Project folder "${selectedFolderPath}" does not exist.`,
						);
						return;
					}

					// Create the full file path for the new chapter
					const filePath = normalizePath(
						`${selectedFolderPath}/${sanitizedFileName}.md`,
					);

					// Check if a file with the same name already exists
					if (await this.app.vault.adapter.exists(filePath)) {
						new Notice(
							`A chapter named "${sanitizedFileName}.md" already exists.`,
						);
						return;
					}

					// Prepare the content for the new chapter file
					let fileContent = "";

					// If a chapter template path is configured, read the template file
					const templatePath =
						this.settings.chapterTemplatePath?.trim();
					if (templatePath) {
						// Normalize the template path to ensure it is valid
						const normalizedTemplatePath =
							normalizePath(templatePath);

						// Get the template file from the vault
						const templateFile =
							this.app.vault.getAbstractFileByPath(
								normalizedTemplatePath,
							);

						// Check if the template file exists and is a TFile
						if (templateFile instanceof TFile) {
							// Read the content of the template file
							fileContent =
								await this.app.vault.read(templateFile);

							// Replace placeholders in the template with the chapter name and current date
							const today = new Date();
							const formattedDate = `${today.getFullYear()}-${String(
								today.getMonth() + 1,
							).padStart(2, "0")}-${String(
								today.getDate(),
							).padStart(2, "0")}`;
							fileContent = fileContent.replace(
								/\{\{title\}\}/gi,
								chapterName,
							);
							fileContent = fileContent.replace(
								/\{\{date\}\}/gi,
								formattedDate,
							);
						} else {
							new Notice(
								`Template file not found at "${templatePath}". Creating a default chapter.`,
							);
						}
					}

					// If no template is provided or the template is empty, create a default chapter structure
					if (fileContent === "") {
						const { propertyNameToChange } = this.settings;
						fileContent = `---\ntitle: ${chapterName}\n`;
						if (propertyNameToChange)
							fileContent += `${propertyNameToChange}: ""\n`;
						fileContent += `---\n\n# ${chapterName}\n\n`;
					}

					// Attempt to create the new chapter file in the vault
					try {
						await this.app.vault.create(filePath, fileContent);
						new Notice(
							`Chapter "${chapterName}" created successfully.`,
						);
					} catch (error) {
						console.error("Error creating new chapter:", error);
						new Notice(
							"Failed to create new chapter. Check console for details.",
						);
					}
				};

				// 3. Fire off the async function safely
				void createChapterFile();
			},
		).open();
	}

	// Method to activate the Novel Chapter view
	async onload() {
		await this.loadSettings(); // Load plugin settings
		this.addSettingTab(new NovelChapterPluginSettingsTab(this.app, this)); // Add settings tab to the plugin

		// Register the Novel Chapter view type
		this.registerView(
			NOVEL_CHAPTER_VIEW_TYPE,
			(leaf) => new NovelChapterView(leaf, this),
		);

		// Add a command to open the Novel Chapter view
		this.addCommand({
			id: "open-novel-chapter-view",
			name: "Open manager view",
			callback: () => this.activateView().catch(console.error),
		});

		// Add a command to create a new chapter in the last selected project
		this.addCommand({
			id: "add-new-chapter-to-project",
			name: "Create new chapter in project",
			callback: () => {
				let targetProjectId = this.settings.lastSelectedNovelId;
				if (
					!targetProjectId &&
					this.settings.novelProjects.length === 1
				) {
					targetProjectId = this.settings.novelProjects[0].id;
				}
				if (!targetProjectId) {
					new Notice(
						"Cannot determine project. Please select a project in the novel chapters view.",
					);
					return;
				}
				this.promptAndCreateNewChapter(targetProjectId).catch(
					console.error,
				);
			},
		});

		// Add commands for navigating between chapters
		this.addCommand({
			id: "open-next-chapter-in-project",
			name: "Open next chapter",
			checkCallback: (checking: boolean) => {
				const currentFile = this.app.workspace.getActiveFile(); // Get the currently active file in the workspace
				if (!currentFile) return false; // If no file is open, return false
				const project = this.findProjectForFile(currentFile); // Find the project for the current file
				if (!project) return false; // If no project is found, return false
				if (checking) return true; // If checking, return true to indicate the command can be executed
				const chapters = this.getProjectChapters(project.path); // Get the chapters for the current project

				// Find the index of the current chapter in the chapters array
				const currentIndex = chapters.findIndex(
					(chap) => chap.path === currentFile.path,
				);

				// If the current chapter is found and is not the last one, open the next chapter
				if (currentIndex !== -1 && currentIndex < chapters.length - 1) {
					this.app.workspace
						.openLinkText(
							chapters[currentIndex + 1].path,
							"",
							false,
						)
						.catch(console.error);
				} else {
					new Notice("This is the last chapter.");
				}
			},
		});

		this.addCommand({
			id: "open-previous-chapter-in-project",
			name: "Open previous chapter",
			checkCallback: (checking: boolean) => {
				const currentFile = this.app.workspace.getActiveFile(); // Get the currently active file in the workspace
				if (!currentFile) return false; // If no file is open, return false
				const project = this.findProjectForFile(currentFile); // Find the project for the current file
				if (!project) return false; // If no project is found, return false
				if (checking) return true; // If checking, return true to indicate the command can be executed
				const chapters = this.getProjectChapters(project.path); // Get the chapters for the current project

				// Find the index of the current chapter in the chapters array
				const currentIndex = chapters.findIndex(
					(chap) => chap.path === currentFile.path,
				);

				// If the current chapter is found and is not the first one, open the previous chapter
				if (currentIndex > 0) {
					this.app.workspace
						.openLinkText(
							chapters[currentIndex - 1].path,
							"",
							false,
						)
						.catch(console.error);
				} else {
					new Notice("This is the first chapter.");
				}
			},
		});

		// Add a ribbon icon to open the Novel Chapter view
		this.addRibbonIcon("list-ordered", "Open novel chapter view", () =>
			this.activateView().catch(console.error),
		);

		// Register event listeners for file changes
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile) {
					this.handleFileChange(file).catch(console.error);
				}
			}),
		);

		// Register event listeners for file modifications, deletions, and renames
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile) {
					this.handleFileChange(file).catch(console.error);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile) {
					this.handleFileChange(file).catch(console.error);
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file) => {
				if (file instanceof TFile) {
					this.handleFileChange(file).catch(console.error);
				}
			}),
		);
	}

	// Method to unload the plugin
	onunload() {
		// Nothing
	}

	// Loads the plugin settings from storage
	async loadSettings() {
		const loadedSettings =
			(await this.loadData()) as Partial<InternalNovelChapterPluginSettings>;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedSettings);

		// Data integrity checks
		if (
			!Array.isArray(this.settings.novelProjects) ||
			this.settings.novelProjects.length === 0
		) {
			this.settings.novelProjects = [
				{
					id: `default-load-${Date.now()}`,
					name: "Default Novel",
					path: "",
				},
			];
		}
		this.settings.novelProjects = this.settings.novelProjects.map(
			(p: Partial<NovelProject>): NovelProject => ({
				id: p.id || `generated-${Date.now()}`,
				name: p.name || "Unnamed Novel",
				path: p.path || "",
				fragmentsPath: p.fragmentsPath || "",
			}),
		);

		if (
			this.settings.lastSelectedNovelId &&
			!this.settings.novelProjects.find(
				(p) => p.id === this.settings.lastSelectedNovelId,
			)
		) {
			this.settings.lastSelectedNovelId =
				this.settings.novelProjects.length > 0
					? this.settings.novelProjects[0].id
					: null;
		}
	}

	// Saves the plugin settings to storage
	async saveSettings() {
		await this.saveData(this.settings);
		this.refreshNovelChapterView(true);
	}

	// Refreshes all Novel Chapter views in the workspace
	refreshNovelChapterView(settingsChanged = false) {
		this.app.workspace
			.getLeavesOfType(NOVEL_CHAPTER_VIEW_TYPE) // Get all leaves of the Novel Chapter view type
			// Iterate through each leaf to update its view
			.forEach((leaf) => {
				if (leaf.view instanceof NovelChapterView) {
					leaf.view.updateView(settingsChanged).catch(console.error);
				}
			});
	}

	// Handles file changes (creation, modification, deletion, renaming)
	private async handleFileChange(file: TFile, oldPath?: string) {
		if (!(file instanceof TFile) || file.extension !== "md") return; // Ignore non-markdown files

		// Check if the file change is relevant to any novel project (Chapters OR Fragments)
		const isRelevantChange = this.settings.novelProjects.some((project) => {
			let isRelevant = false;

			// 1. Check Chapters Path
			if (project.path) {
				const projectPath = normalizePath(project.path);
				const inCurrentPath = normalizePath(file.path).startsWith(
					projectPath + "/",
				);
				const inOldPath = oldPath
					? normalizePath(oldPath).startsWith(projectPath + "/")
					: false;
				isRelevant = isRelevant || inCurrentPath || inOldPath;
			}

			// 2. Check Fragments Path
			if (project.fragmentsPath) {
				const fragPath = normalizePath(project.fragmentsPath);
				const inCurrentPath = normalizePath(file.path).startsWith(
					fragPath + "/",
				);
				const inOldPath = oldPath
					? normalizePath(oldPath).startsWith(fragPath + "/")
					: false;
				isRelevant = isRelevant || inCurrentPath || inOldPath;
			}

			return isRelevant;
		});

		// If the change is relevant, refresh the Novel Chapter view
		if (isRelevantChange) {
			await sleep(150); // Small delay to allow cache to update
			this.refreshNovelChapterView(false); // Refresh the view to reflect changes
		}
	}

	// Activates the Novel Chapter view
	async activateView() {
		const { workspace } = this.app; // Get the workspace instance

		// If the Novel Chapter view is already open, reveal it
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(
			NOVEL_CHAPTER_VIEW_TYPE,
		)[0];

		// If the view is not open, create a new leaf for it
		if (!leaf) {
			// Priority is given to the right leaf, otherwise a new vertical split leaf is created
			leaf =
				workspace.getRightLeaf(false) ??
				workspace.getLeaf("split", "vertical");
			await leaf.setViewState({
				type: NOVEL_CHAPTER_VIEW_TYPE,
				active: true,
			});
		}
		workspace.revealLeaf(leaf).catch(console.error); // Reveal the leaf in the workspace
	}
}
