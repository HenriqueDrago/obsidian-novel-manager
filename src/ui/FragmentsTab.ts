// The Fragments tab: feed, search and creation box
import { App, ButtonComponent, debounce, normalizePath, Notice, setIcon, TFile } from "obsidian";
import type NovelChapterPlugin from "../main";
import { getFragmentsPath, getProjectFragments } from "../core/chapters";
import { sanitizeFileName } from "../core/utils";
import { ChapterNameModal } from "./ChapterNameModal";
import { ConfirmationModal } from "./ConfirmationModal";
import type { TabContext } from "./NovelChapterView";

export class FragmentsTab {
	private fragmentSearchTerm = "";

	// Fragments tab state, kept so file-change refreshes don't wipe the UI
	private fragmentsFeedContainer: HTMLElement | null = null;
	private fragmentDraftTitle = "";
	private fragmentDraftContent = "";
	private feedRenderToken = 0; // Incremented per feed render; stale renders bail out

	constructor(
		private context: TabContext,
		private fragmentsTabContainer: HTMLDivElement,
	) {}

	private get app(): App {
		return this.context.app;
	}

	private get plugin(): NovelChapterPlugin {
		return this.context.plugin;
	}

	private get selectedNovelProjectId(): string | null {
		return this.context.getSelectedProjectId();
	}

	private buildProjectSelector(parentEl: HTMLElement): void {
		this.context.buildProjectSelector(parentEl);
	}

	// Whether the tab has been built, so a refresh can update just the feed
	get hasFeed(): boolean {
		return this.fragmentsFeedContainer !== null;
	}

	// Rebuilds only the feed, keeping the search input, draft and focus
	async refreshFeed() {
		if (this.fragmentsFeedContainer) {
			await this.buildNotesFeed(this.fragmentsFeedContainer);
		}
	}

	// Rebuilds the whole tab
	async render() {
		this.fragmentsTabContainer.empty();
		this.fragmentsFeedContainer = null;
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
		this.fragmentsFeedContainer = feedContainer;

		// Search event listener (updates feed instantly as you type)
		const debouncedFragSearch = debounce(async (value: string) => {
			this.fragmentSearchTerm = value;
			await this.buildNotesFeed(feedContainer);
		}, 250);

		searchInput.addEventListener("input", (e) => {
			debouncedFragSearch((e.target as HTMLInputElement).value);
		});

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

		// Restore and track the unsaved draft so a tab rebuild doesn't lose it
		titleInput.value = this.fragmentDraftTitle;
		contentArea.value = this.fragmentDraftContent;
		titleInput.addEventListener("input", () => {
			this.fragmentDraftTitle = titleInput.value;
		});
		contentArea.addEventListener("input", () => {
			this.fragmentDraftContent = contentArea.value;
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
			const fragmentsPath = currentProject
				? getFragmentsPath(this.plugin.settings, currentProject)
				: null;
			if (!fragmentsPath) {
				new Notice("No fragments path configured for this project.");
				return;
			}

			let rawTitle = titleInput.value.trim();
			if (!rawTitle) {
				const words = content.split(/\s+/).slice(0, 4).join(" ");
				rawTitle =
					sanitizeFileName(words) ||
					`Fragment-${Date.now()}`;
			} else {
				rawTitle = sanitizeFileName(rawTitle);
			}

			const folderPath = fragmentsPath;
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
				this.fragmentDraftTitle = "";
				this.fragmentDraftContent = "";

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

		// Initial load of the feed
		await this.buildNotesFeed(feedContainer);
	}

	private async buildNotesFeed(feedContainer: HTMLElement) {
		const token = ++this.feedRenderToken;

		const currentProject = this.plugin.settings.novelProjects.find(
			(p) => p.id === this.selectedNovelProjectId,
		);
		const fragmentsPath = currentProject
			? getFragmentsPath(this.plugin.settings, currentProject)
			: null;
		if (!fragmentsPath) {
			feedContainer.empty();
			feedContainer.createEl("p", {
				text: "No fragments path configured for this project.",
				cls: "nav-empty-state-title",
			});
			return;
		}

		const fragments = getProjectFragments(this.app, fragmentsPath);
		const searchTermLower = this.fragmentSearchTerm.toLowerCase();

		// Read everything first, so overlapping renders can't duplicate fragments
		const entries: { file: TFile; content: string }[] = [];
		for (const file of fragments) {
			const content = await this.app.vault.cachedRead(file);
			if (
				searchTermLower &&
				!file.basename.toLowerCase().includes(searchTermLower) &&
				!content.toLowerCase().includes(searchTermLower)
			) {
				continue;
			}
			entries.push({ file, content });
		}

		if (token !== this.feedRenderToken) return; // A newer render has started

		feedContainer.empty();

		if (fragments.length === 0) {
			feedContainer.createEl("p", {
				text: "No fragments found. Write your first idea below!",
				cls: "nav-empty-state-title",
			});
			return;
		}

		if (entries.length === 0) {
			feedContainer.createEl("p", {
				text: `No fragments found matching "${this.fragmentSearchTerm}".`,
				cls: "nav-empty-state-title",
			});
			return;
		}

		for (const { file, content } of entries) {

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
						const sanitized = sanitizeFileName(newName)
							.trim();
						if (!sanitized) {
							new Notice("Invalid fragment name provided.");
							return;
						}
						if (sanitized === file.basename) return;

						// Files at the vault root have parent path "/", which must not be prefixed
						const parentPath = file.parent?.path ?? "/";
						const newPath = normalizePath(
							parentPath === "/"
								? `${sanitized}.md`
								: `${parentPath}/${sanitized}.md`,
						);

						void (async () => {
							// Case-only renames "exist" on case-insensitive file systems
							const isCaseOnlyRename =
								newPath.toLowerCase() === file.path.toLowerCase();
							if (
								!isCaseOnlyRename &&
								(await this.app.vault.adapter.exists(newPath))
							) {
								new Notice(
									`A fragment named "${sanitized}" already exists.`,
								);
								return;
							}
							try {
								await this.app.fileManager.renameFile(
									file,
									newPath,
								);
								await this.refreshFeed();
							} catch (error) {
								console.error("Error renaming fragment:", error);
								new Notice(
									"Failed to rename fragment. See console for details.",
								);
							}
						})();
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
							await this.refreshFeed();
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
	}
}
