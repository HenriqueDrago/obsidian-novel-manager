import { App, ItemView, WorkspaceLeaf } from "obsidian";
import type NovelChapterPlugin from "../main";
import { ChaptersTab } from "./ChaptersTab";
import { FragmentsTab } from "./FragmentsTab";

// The view's type ID, used to register and find it
export const VIEW_TYPE = "novel-chapter-view";

// What the tabs need from the view
export interface TabContext {
	app: App;
	plugin: NovelChapterPlugin;
	getSelectedProjectId(): string | null;
	buildProjectSelector(parentEl: HTMLElement): void;
}

// The sidebar view: tab bar, project selection, and deciding what to redraw
export class NovelChapterView extends ItemView {
	plugin: NovelChapterPlugin; // Reference to the plugin instance

	// Layout Containers
	tabsContainer!: HTMLDivElement;
	chaptersTabContainer!: HTMLDivElement;
	fragmentsTabContainer!: HTMLDivElement;
	controlsContainer!: HTMLDivElement;
	tableContainer!: HTMLDivElement;

	activeTab: "chapters" | "fragments" = "chapters"; // Track current tab
	selectedNovelProjectId: string | null = null; // ID of the currently selected novel project
	private displayedProjectId: string | null | undefined = undefined; // Project the tab title was last set for

	// The two tabs, created in onOpen
	private chaptersTab!: ChaptersTab;
	private fragmentsTab!: FragmentsTab;

	constructor(leaf: WorkspaceLeaf, plugin: NovelChapterPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	// Returns the view type for this custom view
	getViewType(): string {
		return VIEW_TYPE;
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
		const { contentEl } = this;
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

		// Both tabs share this context to reach the app, plugin and selected project
		const context: TabContext = {
			app: this.app,
			plugin: this.plugin,
			getSelectedProjectId: () => this.selectedNovelProjectId,
			buildProjectSelector: (parentEl) => this.buildProjectSelector(parentEl),
		};
		this.chaptersTab = new ChaptersTab(
			context,
			this.controlsContainer,
			this.tableContainer,
		);
		this.fragmentsTab = new FragmentsTab(context, this.fragmentsTabContainer);

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
			await this.chaptersTab.renderControls();
		}

		// Pick a project if none (or a removed one) is selected
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
		}

		// Keep every project selector in this view (chapters and fragments tabs) in sync
		if (this.selectedNovelProjectId) {
			this.containerEl
				.querySelectorAll<HTMLSelectElement>("select.novel-project-selector")
				.forEach((selectEl) => {
					selectEl.value = this.selectedNovelProjectId as string;
				});
		}

		// Update the tab title only when it can change (too heavy for every file change)
		if (
			settingsHaveChanged ||
			this.displayedProjectId !== this.selectedNovelProjectId
		) {
			this.displayedProjectId = this.selectedNovelProjectId;
			this.updateLeafDisplayText();
		}
		await this.chaptersTab.renderChapterTable(); // Render the chapter table based on the selected project

		// Rebuild the fragments tab only on settings changes, so the draft and focus survive
		if (settingsHaveChanged || !this.fragmentsTab.hasFeed) {
			await this.fragmentsTab.render();
		} else {
			await this.fragmentsTab.refreshFeed();
		}
		this.switchTab(this.activeTab); // Ensure the correct CSS display state is active
	}

	private renderTabs() {
		this.tabsContainer.empty(); // Clear the tabs container

		// Check the global setting: hide tabs if fragments are disabled
		if (!this.plugin.settings.enableFragments) {
            this.activeTab = "chapters";
            this.tabsContainer.hide();
            return;
        } else {
			this.tabsContainer.show();
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
			this.chaptersTab.onProjectChanged(); // Collapse state belongs to the previous project

			const saveAndUpdate = async () => {
				await this.plugin.saveSettings();
				await this.updateView();
			};

			void saveAndUpdate();
		});
	}
}
