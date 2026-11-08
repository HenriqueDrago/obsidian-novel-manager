// Plugin entry point: commands, events and settings storage
import { debounce, normalizePath, Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
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
				if (file instanceof TFile) this.handleFileChange(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile) this.handleFileChange(file);
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				// Pass oldPath so moving a chapter *out* of a project still refreshes
				if (file instanceof TFile) this.handleFileChange(file, oldPath);
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
	async saveSettings() {
		await this.saveData(this.settings);
		this.refreshNovelChapterView(true);
	}

	// Refreshes all Novel Chapter views in the workspace
	refreshNovelChapterView(settingsChanged = false) {
		this.app.workspace
			.getLeavesOfType(VIEW_TYPE) // Get all leaves of the Novel Chapter view type
			// Iterate through each leaf to update its view
			.forEach((leaf) => {
				if (leaf.view instanceof NovelChapterView) {
					leaf.view.updateView(settingsChanged).catch(console.error);
				}
			});
	}

	// Handles file changes (creation, modification, deletion, renaming)
	private handleFileChange(file: TFile, oldPath?: string) {
		if (file.extension !== "md") return; // Ignore non-markdown files

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

	// Activates the Novel Chapter view
	async activateView() {
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
		workspace.revealLeaf(leaf).catch(console.error); // Reveal the leaf in the workspace
	}
}
