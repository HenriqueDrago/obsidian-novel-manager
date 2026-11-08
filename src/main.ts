// Plugin entry point: commands, events and settings storage
import { debounce, normalizePath, Notice, Plugin, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";
import { InternalNovelChapterPluginSettings, normalizeSettings } from "./settings";
import {
	findProjectForFile,
	getFragmentsPath,
	openAdjacentChapter,
} from "./core/chapters";
import { promptAndCreateNewChapter } from "./ui/chapterPrompts";
import { NovelChapterPluginSettingsTab } from "./ui/SettingsTab";
import { NovelChapterView, VIEW_TYPE } from "./ui/NovelChapterView";

// Main plugin class
export default class NovelChapterPlugin extends Plugin {
	settings!: InternalNovelChapterPluginSettings; // Plugin settings

	// Method to activate the Novel Chapter view
	async onload() {
		await this.loadSettings(); // Load plugin settings
		this.addSettingTab(new NovelChapterPluginSettingsTab(this.app, this)); // Add settings tab to the plugin

		// Register the Novel Chapter view type
		this.registerView(
			VIEW_TYPE,
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
				promptAndCreateNewChapter(this.app, this.settings, targetProjectId).catch(
					console.error,
				);
			},
		});

		// Add commands for navigating between chapters
		const isInProject = () => { // Commands are only available inside a project's chapter
			const currentFile = this.app.workspace.getActiveFile();
			return !!currentFile && !!findProjectForFile(this.settings, currentFile);
		};
		this.addCommand({
			id: "open-next-chapter-in-project",
			name: "Open next chapter",
			checkCallback: (checking: boolean) => {
				if (!isInProject()) return false;
				if (!checking) openAdjacentChapter(this.app, this.settings, "next");
				return true;
			},
		});

		this.addCommand({
			id: "open-previous-chapter-in-project",
			name: "Open previous chapter",
			checkCallback: (checking: boolean) => {
				if (!isInProject()) return false;
				if (!checking) openAdjacentChapter(this.app, this.settings, "previous");
				return true;
			},
		});

		// Commands to open a specific tab of the view
		this.addCommand({
			id: "open-chapters-tab",
			name: "Open chapters",
			callback: () => {
				void this.activateView().then((view) => view?.showTab("chapters"));
			},
		});
		this.addCommand({
			id: "open-fragments-tab",
			name: "Open fragments",
			checkCallback: (checking: boolean) => {
				if (!this.settings.enableFragments) return false;
				if (!checking) {
					// Focuses the text box, ready to type
					void this.activateView().then((view) => view?.focusFragmentBox());
				}
				return true;
			},
		});

		// Command to scroll the view to the open chapter
		this.addCommand({
			id: "reveal-current-chapter",
			name: "Reveal current chapter in view",
			checkCallback: (checking: boolean) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || !findProjectForFile(this.settings, file)) return false;
				if (!checking) {
					void this.activateView().then((view) => view?.revealChapter(file));
				}
				return true;
			},
		});

		// Page previews from the view (listed under Settings > Page preview)
		this.registerHoverLinkSource(VIEW_TYPE, {
			display: "Novel Manager",
			defaultMod: true,
		});

		// "Reveal in Novel Manager" in the file explorer and tab header menus
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu, file) => {
				if (!this.settings.revealInFileMenu) return;
				if (!(file instanceof TFile) || !findProjectForFile(this.settings, file)) return;
				menu.addItem((item) =>
					item
						.setTitle("Reveal in Novel Manager")
						.setIcon("list-ordered")
						.onClick(() => {
							void this.activateView().then((view) => view?.revealChapter(file));
						}),
				);
			}),
		);

		// Follow and highlight the open chapter in every open view
		this.registerEvent(
			this.app.workspace.on("file-open", (file) => {
				this.getViews().forEach((view) => {
					view.onFileOpen(file).catch(console.error);
				});
			}),
		);

		// Add a ribbon icon to open the Novel Chapter view
		this.addRibbonIcon("list-ordered", "Open novel chapter view", () =>
			this.activateView().catch(console.error),
		);

		// Content changes, once the frontmatter is re-read (also fires for new files)
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				this.handleFileChange(file);
			}),
		);

		// Structural changes: creation, deletion and renames/moves
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				this.handleFileChange(file); // Folders too, so empty folders show as groups
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				this.handleFileChange(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				// Pass oldPath so moving a chapter *out* of a project still refreshes
				this.handleFileChange(file, oldPath);
			}),
		);
	}

	// Coalesces bursts of file events (e.g. typing in a chapter) into a single refresh
	private requestViewRefresh = debounce(
		() => this.refreshNovelChapterView(false),
		200,
		true,
	);

	// Debounced save for settings text inputs
	public saveSettingsDebounced = debounce(
		() => {
			this.saveSettings().catch(console.error);
		},
		400,
		true,
	);

	// Method to unload the plugin
	onunload() {
		// Nothing
	}

	// Loads the plugin settings from storage
	async loadSettings() {
		const loadedSettings =
			(await this.loadData()) as Partial<InternalNovelChapterPluginSettings> | null;
		this.settings = normalizeSettings(loadedSettings); // Defaults + repairs
	}

	// Saves the plugin settings to storage
	async saveSettings(refresh = true) {
		await this.saveData(this.settings);
		// Skipped when the caller redraws on its own (e.g. switching projects)
		if (refresh) this.refreshNovelChapterView(true);
	}

	// Refreshes all Novel Chapter views in the workspace
	refreshNovelChapterView(settingsChanged = false) {
		this.getViews().forEach((view) => {
			view.updateView(settingsChanged).catch(console.error);
		});
	}

	// Handles file changes (creation, modification, deletion, renaming)
	private handleFileChange(file: TAbstractFile, oldPath?: string) {
		if (file instanceof TFile && file.extension !== "md") return; // Ignore non-markdown files (folders pass)

		const paths = [normalizePath(file.path)];
		if (oldPath) paths.push(normalizePath(oldPath));
		const isUnder = (folder: string) =>
			paths.some((p) => p.startsWith(normalizePath(folder) + "/"));

		// Check if the file change is relevant to any novel project (chapters OR fragments)
		const isRelevantChange = this.settings.novelProjects.some((project) => {
			if (project.path && isUnder(project.path)) return true;
			const fragmentsPath = getFragmentsPath(this.settings, project);
			return !!fragmentsPath && isUnder(fragmentsPath);
		});

		if (isRelevantChange) this.requestViewRefresh();
	}

	// Open Novel Manager views (deferred, not-yet-loaded leaves are skipped)
	private getViews(): NovelChapterView[] {
		return this.app.workspace
			.getLeavesOfType(VIEW_TYPE)
			.map((leaf) => leaf.view)
			.filter((view): view is NovelChapterView => view instanceof NovelChapterView);
	}

	// Activates the Novel Chapter view and returns it
	async activateView(): Promise<NovelChapterView | null> {
		const { workspace } = this.app; // Get the workspace instance

		// If the Novel Chapter view is already open, reveal it
		let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(
			VIEW_TYPE,
		)[0];

		// If the view is not open, create a new leaf for it
		if (!leaf) {
			// Priority is given to the right leaf, otherwise a new vertical split leaf is created
			leaf =
				workspace.getRightLeaf(false) ??
				workspace.getLeaf("split", "vertical");
			await leaf.setViewState({
				type: VIEW_TYPE,
				active: true,
			});
		}
		// Revealing also loads a deferred view, so leaf.view is the real view afterwards
		await workspace.revealLeaf(leaf);
		return leaf.view instanceof NovelChapterView ? leaf.view : null;
	}
}
