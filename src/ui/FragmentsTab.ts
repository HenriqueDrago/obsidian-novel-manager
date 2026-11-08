// The Fragments tab: feed, search and creation box
import {
	App,
	ButtonComponent,
	debounce,
	DropdownComponent,
	ExtraButtonComponent,
	Keymap,
	normalizePath,
	Notice,
	SearchComponent,
	TFile,
} from "obsidian";
import type NovelChapterPlugin from "../main";
import { FragmentSort, getFragmentsPath, getProjectFragments } from "../core/chapters";
import { sanitizeFileName } from "../core/utils";
import { ChapterNameModal } from "./ChapterNameModal";
import { ConfirmationModal } from "./ConfirmationModal";
import { renderEmptyState } from "./emptyState";
import type { TabContext } from "./NovelChapterView";

// A fragment longer than this gets a "Show more" toggle
const LONG_FRAGMENT_LINES = 8;
const LONG_FRAGMENT_CHARS = 600;

// Formats a timestamp relative to now (e.g. "3 hours ago")
function relativeTime(timestamp: number): string {
	const seconds = Math.round((timestamp - Date.now()) / 1000);
	const units: [Intl.RelativeTimeFormatUnit, number][] = [
		["year", 31536000],
		["month", 2592000],
		["week", 604800],
		["day", 86400],
		["hour", 3600],
		["minute", 60],
	];
	const format = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
	// Largest unit that fits; under a minute counts as "now"
	for (const [unit, size] of units) {
		if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
	}
	return format.format(0, "second");
}

export class FragmentsTab {
	private fragmentSearchTerm = "";

	// Fragments tab state, kept so file-change refreshes don't wipe the UI
	private fragmentsFeedContainer: HTMLElement | null = null;
	private fragmentDraftTitle = "";
	private fragmentDraftContent = "";
	private feedRenderToken = 0; // Incremented per feed render; stale renders bail out
	private expandedFragments = new Set<string>(); // Paths of long fragments opened with "Show more"

	// The creation box and its save action, for the Mod+Enter hotkey
	private contentAreaEl: HTMLTextAreaElement | null = null;
	private saveFragment: (() => Promise<void>) | null = null;
	private isSaving = false; // Blocks a second save while one is running

	constructor(
		private context: TabContext,
		private fragmentsTabContainer: HTMLDivElement,
	) {
		// Registered on the view's scope: a plain keydown listener loses to global
		// hotkeys bound to Mod+Enter (e.g. the editor's "open link in new tab")
		context.scope.register(["Mod"], "Enter", (evt) => {
			if (!this.saveFragment || activeDocument.activeElement !== this.contentAreaEl) {
				return true; // Not ours; let other hotkeys handle it
			}
			if (evt.isComposing) return true;
			this.saveFragment().catch(console.error);
			return false; // Handled: prevents the line break and other hotkeys
		});
	}

	private get app(): App {
		return this.context.app;
	}

	private get plugin(): NovelChapterPlugin {
		return this.context.plugin;
	}

	private get selectedNovelProjectId(): string | null {
		return this.context.getSelectedProjectId();
	}

	// Whether the tab has been built, so a refresh can update just the feed
	get hasFeed(): boolean {
		return this.fragmentsFeedContainer !== null;
	}

	// Focuses the creation box (used by the "Open fragments" command)
	focusCreationBox(): void {
		this.contentAreaEl?.focus();
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
		this.contentAreaEl = null;
		this.saveFragment = null;
		if (!this.plugin.settings.enableFragments) return;

		// Top: Search (the project selector sits above the tabs)
		const topControlsContainer = this.fragmentsTabContainer.createDiv({
			cls: "fragments-top-controls",
		});
		const search = new SearchComponent(topControlsContainer)
			.setPlaceholder("Search fragments...")
			.setValue(this.fragmentSearchTerm);

		// Sort order, remembered across restarts
		new DropdownComponent(topControlsContainer)
			.addOptions({ newest: "Newest first", oldest: "Oldest first", name: "Name" })
			.setValue(this.plugin.settings.fragmentSort)
			.onChange((value) => {
				this.plugin.settings.fragmentSort = value as FragmentSort;
				// Only the feed re-sorts, so the draft and search keep focus
				void this.plugin.saveSettings(false).then(() => this.refreshFeed());
			})
			.selectEl.addClass("fragments-sort-select");

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

		search.onChange(debouncedFragSearch); // Also fires when the clear button is used

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
			placeholder: "Fragment title (optional)",
		});

		// Using the same ButtonComponent configuration as your New Chapter button
		const createBtn = new ButtonComponent(createHeader)
			.setIcon("plus")
			.setTooltip("Save fragment (Ctrl+Enter or Cmd+Enter)")
			.setClass("novel-chapter-new-button");

		const contentArea = createContainer.createEl("textarea", {
			attr: {
				placeholder:
					"Write your fragment here... (Ctrl+Enter or Cmd+Enter to save)",
				rows: "2",
			},
		});

		// Grows with the content (capped by max-height in CSS), shrinks when emptied
		const autoGrow = () => {
			contentArea.setCssProps({ height: "auto" }); // Reset first, so it can shrink
			// scrollHeight is 0 while the tab is hidden; keep the default size then
			if (contentArea.value && contentArea.scrollHeight > 0) {
				contentArea.setCssProps({ height: `${contentArea.scrollHeight + 2}px` }); // +2 for the border
			}
		};
		contentArea.addEventListener("input", autoGrow);
		contentArea.addEventListener("focus", autoGrow); // Catches drafts restored while the tab was hidden

		// Restore and track the unsaved draft so a tab rebuild doesn't lose it
		titleInput.value = this.fragmentDraftTitle;
		contentArea.value = this.fragmentDraftContent;
		// Size the restored draft once the textarea is laid out
		window.requestAnimationFrame(autoGrow);
		titleInput.addEventListener("input", () => {
			this.fragmentDraftTitle = titleInput.value;
		});
		contentArea.addEventListener("input", () => {
			this.fragmentDraftContent = contentArea.value;
		});

		// Note Creation Logic
		const saveIdea = async () => {
			if (this.isSaving) return;
			const content = contentArea.value.trim();
			if (!content) {
				new Notice("Cannot save an empty fragment.");
				return;
			}
			this.isSaving = true;
			try {
				await createFragment(content);
			} finally {
				this.isSaving = false;
			}
		};

		// Writes the fragment file and clears the creation box
		const createFragment = async (content: string) => {

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
				autoGrow();

				// Re-render feed instead of whole tab to preserve focus
				await this.buildNotesFeed(feedContainer);
			} catch (err) {
				console.error("Error creating fragment:", err);
				new Notice("Failed to save fragment. See console.");
			}
		};

		// Bind click to the save function
		createBtn.onClick(saveIdea);

		// Ctrl/Cmd+Enter saves (see the scope hotkey in the constructor)
		this.contentAreaEl = contentArea;
		this.saveFragment = saveIdea;

		// Fallback for when the view's scope isn't active
		contentArea.addEventListener("keydown", (e) => {
			// Already handled by a hotkey (ours or another)
			if (e.defaultPrevented || e.isComposing) return;
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault(); // No line break
				saveIdea().catch(console.error);
			}
		});

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
			renderEmptyState(feedContainer, "No fragments path configured for this project.");
			return;
		}

		const fragments = getProjectFragments(
			this.app,
			fragmentsPath,
			this.plugin.settings.fragmentSort,
		);
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
			renderEmptyState(feedContainer, "No fragments yet. Write your first idea below!");
			return;
		}

		if (entries.length === 0) {
			renderEmptyState(
				feedContainer,
				`No fragments match "${this.fragmentSearchTerm}".`,
			);
			return;
		}

		for (const { file, content } of entries) {
			this.renderFragment(feedContainer, file, content);
		}
	}

	// Renders one fragment block: header (title, date, actions) and content
	private renderFragment(feedContainer: HTMLElement, file: TFile, content: string) {
		const blockContainer = feedContainer.createDiv({
			cls: "fragment-block",
		});

		// Header Area
		const headerEl = blockContainer.createDiv({
			cls: "fragment-header",
		});
		const titleWrapper = headerEl.createDiv({ cls: "fragment-title-wrapper" });

		// Title opens the fragment; Ctrl/Cmd-click opens it in a new tab
		const titleEl = titleWrapper.createEl("a", {
			text: file.basename,
			href: "#",
			cls: "fragment-title",
		});
		titleEl.addEventListener("click", (ev) => {
			ev.preventDefault();
			this.app.workspace
				.openLinkText(file.path, "", Keymap.isModEvent(ev))
				.catch(console.error);
		});
		// Middle-click also opens a new tab
		titleEl.addEventListener("auxclick", (ev) => {
			if (ev.button !== 1) return;
			ev.preventDefault();
			this.app.workspace.openLinkText(file.path, "", "tab").catch(console.error);
		});

		// Modified date, relative, with the full date as tooltip
		titleWrapper.createDiv({
			text: relativeTime(file.stat.mtime),
			cls: "fragment-date",
			attr: { "aria-label": new Date(file.stat.mtime).toLocaleString() },
		});

		const actionsEl = headerEl.createDiv({ cls: "fragment-actions" });

		new ExtraButtonComponent(actionsEl)
			.setIcon("copy")
			.setTooltip("Copy")
			.onClick(() => {
				void (async () => {
					const contentToCopy = await this.app.vault.cachedRead(file);
					await navigator.clipboard.writeText(contentToCopy);
					new Notice("Fragment copied to clipboard!");
				})();
			});

		new ExtraButtonComponent(actionsEl)
			.setIcon("pencil")
			.setTooltip("Rename")
			.onClick(() => this.promptAndRenameFragment(file));

		new ExtraButtonComponent(actionsEl)
			.setIcon("trash")
			.setTooltip("Delete")
			.onClick(() => {
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
			});

		// Text Content Area
		const textContainer = blockContainer.createDiv({
			cls: "fragment-content",
		});
		textContainer.createEl("pre", { text: content });

		// Long fragments are cut off with a "Show more" toggle
		// Judged by content, not height: the tab may be hidden (height 0) while rendering
		const isLong =
			content.length > LONG_FRAGMENT_CHARS ||
			content.split("\n").length > LONG_FRAGMENT_LINES;
		if (!isLong) return;

		const toggleEl = blockContainer.createEl("a", {
			href: "#",
			cls: "fragment-show-more",
		});
		const applyExpanded = (expanded: boolean) => {
			textContainer.toggleClass("is-collapsed", !expanded);
			toggleEl.setText(expanded ? "Show less" : "Show more");
		};
		applyExpanded(this.expandedFragments.has(file.path));
		toggleEl.addEventListener("click", (ev) => {
			ev.preventDefault();
			// Remembered by path, so it stays open across feed refreshes
			const expanded = !this.expandedFragments.has(file.path);
			if (expanded) this.expandedFragments.add(file.path);
			else this.expandedFragments.delete(file.path);
			applyExpanded(expanded);
		});
	}

	// Asks for a new name, then renames the fragment
	private promptAndRenameFragment(file: TFile) {
		new ChapterNameModal(
			this.app,
			"Rename fragment",
			"Rename",
			file.basename,
			(newName) => {
				const sanitized = sanitizeFileName(newName).trim();
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
						await this.app.fileManager.renameFile(file, newPath);
						await this.refreshFeed();
					} catch (error) {
						console.error("Error renaming fragment:", error);
						new Notice(
							"Failed to rename fragment. See console for details.",
						);
					}
				})();
			},
			"Fragment name",
		).open();
	}
}
