import { App, ItemView, Scope, TFile, WorkspaceLeaf } from "obsidian";
import type NovelChapterPlugin from "../main";
import {
	findProjectForFile,
	getFragmentsPath,
	getProjectChapters,
	getProjectFragments,
} from "../core/chapters";
import { getChapterGroupKey, OTHER_GROUP_KEY } from "../core/utils";
import { ChaptersTab } from "./ChaptersTab";
import { FragmentsTab } from "./FragmentsTab";

// The view's type ID, used to register and find it
export const VIEW_TYPE = "novel-chapter-view";

// What the tabs need from the view
export interface TabContext {
	app: App;
	plugin: NovelChapterPlugin;
	scope: Scope; // The view's hotkey scope, checked before global hotkeys
	getSelectedProjectId(): string | null;
}

type TabName = "chapters" | "fragments";

// The sidebar view: project selector, tab bar, and deciding what to redraw
export class NovelChapterView extends ItemView {
	plugin: NovelChapterPlugin; // Reference to the plugin instance

	// Layout Containers
	projectSelectorContainer!: HTMLDivElement;
	tabsContainer!: HTMLDivElement;
	chaptersTabContainer!: HTMLDivElement;
	fragmentsTabContainer!: HTMLDivElement;
	controlsContainer!: HTMLDivElement;
	tableContainer!: HTMLDivElement;

	activeTab: TabName = "chapters"; // Track current tab
	selectedNovelProjectId: string | null = null; // ID of the currently selected novel project
	private displayedProjectId: string | null | undefined = undefined; // Project the tab title was last set for

	// The project dropdown and the tab bar items, kept to update without rebuilding
	private projectSelectEl: HTMLSelectElement | null = null;
	private tabEls: Partial<Record<TabName, { tabEl: HTMLElement; countEl: HTMLElement }>> = {};

	// The two tabs, created in onOpen
	private chaptersTab!: ChaptersTab;
	private fragmentsTab!: FragmentsTab;

	constructor(leaf: WorkspaceLeaf, plugin: NovelChapterPlugin) {
		super(leaf);
		this.plugin = plugin;
		// Own hotkey scope, so view shortcuts win over global ones (e.g. Mod+Enter)
		this.scope = new Scope(this.app.scope);
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

		// Project selector, shared by both tabs
		this.projectSelectorContainer = contentEl.createDiv({
			cls: "novel-project-selector-container",
		});

		// Tab bar (hidden while fragments are off)
		this.tabsContainer = contentEl.createDiv({
			cls: "novel-view-tabs",
			attr: { role: "tablist" },
		});

		// Create the Wrappers for each Tab
		this.chaptersTabContainer = contentEl.createDiv({
			cls: "novel-tab-content chapters-tab",
		});
		this.fragmentsTabContainer = contentEl.createDiv({
			cls: "novel-tab-content fragments-tab",
		});
		this.fragmentsTabContainer.hide();

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
			scope: this.scope as Scope, // Set in the constructor
			getSelectedProjectId: () => this.selectedNovelProjectId,
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
		this.chaptersTab.dispose();
	}

	// Switches to a project: redraws only this view, once
	async selectProject(projectId: string): Promise<void> {
		if (projectId === this.selectedNovelProjectId) return;
		this.selectedNovelProjectId = projectId;
		this.plugin.settings.lastSelectedNovelId = projectId;
		this.chaptersTab.onProjectChanged(); // Collapse state belongs to the previous project
		// No refresh: this view redraws itself right after
		await this.plugin.saveSettings(false);
		await this.updateView(); // Also syncs the dropdown
	}

	// Called by the plugin when a file is opened anywhere in the workspace
	async onFileOpen(file: TFile | null): Promise<void> {
		// Follow the open chapter's (or fragment's) project, if enabled
		if (file && this.plugin.settings.followActiveChapter) {
			const project = findProjectForFile(this.plugin.settings, file, true);
			if (project) await this.selectProject(project.id);
		}
		this.chaptersTab.highlightActiveChapter(true);
	}

	// Shows a tab (used by commands)
	showTab(tab: TabName): void {
		if (tab === "fragments" && !this.plugin.settings.enableFragments) return;
		this.switchTab(tab);
	}

	// Focuses the fragment creation box
	focusFragmentBox(): void {
		this.showTab("fragments");
		this.fragmentsTab.focusCreationBox();
	}

	// Switches to a chapter's project and tab, then scrolls to and flashes its row
	async revealChapter(file: TFile): Promise<void> {
		const project = findProjectForFile(this.plugin.settings, file);
		if (!project) return;
		await this.selectProject(project.id);
		this.showTab("chapters");
		await this.chaptersTab.revealChapter(file);
	}

	// Redraws the view; settingsHaveChanged also rebuilds the selector, tabs and controls
	async updateView(settingsHaveChanged = false) {
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

		// If settings have changed, re-render the selector, tabs and controls
		if (settingsHaveChanged) {
			this.renderProjectSelector();
			this.renderTabs();
			await this.chaptersTab.renderControls();
		}
		// Keep the dropdown on the selected project
		if (this.projectSelectEl && this.selectedNovelProjectId) {
			this.projectSelectEl.value = this.selectedNovelProjectId;
		}

		// Update the tab title only when it can change (too heavy for every file change)
		if (
			settingsHaveChanged ||
			this.displayedProjectId !== this.selectedNovelProjectId
		) {
			this.displayedProjectId = this.selectedNovelProjectId;
			this.updateLeafDisplayText();
		}
		this.updateTabCounts();
		await this.chaptersTab.renderChapterTable(); // Render the chapter table based on the selected project

		// Rebuild the fragments tab only on settings changes, so the draft and focus survive
		if (settingsHaveChanged || !this.fragmentsTab.hasFeed) {
			await this.fragmentsTab.render();
		} else {
			await this.fragmentsTab.refreshFeed();
		}
		this.switchTab(this.activeTab); // Ensure the correct CSS display state is active
	}

	// Builds the project dropdown above the tabs
	private renderProjectSelector() {
		this.projectSelectorContainer.empty();
		this.projectSelectEl = null;

		const projects = this.plugin.settings.novelProjects;
		if (projects.length === 0) {
			this.projectSelectorContainer.setText(
				"No novel projects configured. Please add one in plugin settings.",
			);
			return;
		}

		const selectEl = this.projectSelectorContainer.createEl("select", {
			cls: "dropdown novel-project-selector",
		});
		this.projectSelectEl = selectEl;
		for (const project of projects) {
			selectEl.createEl("option", {
				text: project.name || "Unnamed Novel",
				value: project.id,
			});
		}
		if (this.selectedNovelProjectId) selectEl.value = this.selectedNovelProjectId;

		selectEl.addEventListener("change", () => {
			this.selectProject(selectEl.value).catch(console.error);
		});
	}

	// Builds the tab bar (a segmented control with counts)
	private renderTabs() {
		this.tabsContainer.empty();
		this.tabEls = {};

		// Check the global setting: hide tabs if fragments are disabled
		if (!this.plugin.settings.enableFragments) {
			this.activeTab = "chapters";
			this.tabsContainer.hide();
			return;
		}
		this.tabsContainer.show();

		const labels: Record<TabName, string> = {
			chapters: "Chapters",
			fragments: "Fragments",
		};
		for (const tab of ["chapters", "fragments"] as TabName[]) {
			const tabEl = this.tabsContainer.createDiv({
				cls: "novel-view-tab",
				attr: { role: "tab", tabindex: "0" },
			});
			tabEl.createSpan({ text: labels[tab] });
			const countEl = tabEl.createSpan({ cls: "novel-view-tab-count" });
			tabEl.addEventListener("click", () => this.switchTab(tab));
			// Keyboard access, since these are divs
			tabEl.addEventListener("keydown", (e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					this.switchTab(tab);
				}
			});
			this.tabEls[tab] = { tabEl, countEl };
		}
	}

	// Updates the counts in the tab labels (unfiltered totals)
	private updateTabCounts() {
		const { chapters, fragments } = this.tabEls;
		if (!chapters || !fragments) return; // Tab bar hidden

		const project = this.plugin.settings.novelProjects.find(
			(p) => p.id === this.selectedNovelProjectId,
		);
		let chapterFiles = project
			? getProjectChapters(this.app, this.plugin.settings, project)
			: [];
		if (project && this.plugin.settings.excludeOtherFromCount) {
			chapterFiles = chapterFiles.filter(
				(file) => getChapterGroupKey(file, project.path) !== OTHER_GROUP_KEY,
			);
		}
		const fragmentsPath = project
			? getFragmentsPath(this.plugin.settings, project)
			: null;
		const fragmentCount = fragmentsPath
			? getProjectFragments(this.app, fragmentsPath).length // Order doesn't matter for a count
			: 0;

		chapters.countEl.setText(String(chapterFiles.length));
		fragments.countEl.setText(String(fragmentCount));
	}

	// Shows a tab and marks it active in the tab bar
	private switchTab(tab: TabName) {
		this.activeTab = tab;
		this.chaptersTabContainer.toggle(tab === "chapters");
		this.fragmentsTabContainer.toggle(tab === "fragments");
		for (const [name, els] of Object.entries(this.tabEls)) {
			const isActive = name === tab;
			els.tabEl.toggleClass("is-active", isActive);
			els.tabEl.setAttr("aria-selected", String(isActive));
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
}
