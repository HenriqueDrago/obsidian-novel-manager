// The Chapters tab: toolbar and grouped chapter table
import {
	App,
	ButtonComponent,
	debounce,
	Keymap,
	Menu,
	MenuItem,
	normalizePath,
	Notice,
	Platform,
	setIcon,
	SearchComponent,
	TFile,
	TFolder,
} from "obsidian";
import type NovelChapterPlugin from "../main";
import type { NovelProject } from "../settings";
import {
	getChapterFolderOptions,
	getGroupFolderPath,
	getProjectChapters,
	getGroupDisplayName,
	moveChapter,
	openAdjacentChapter,
} from "../core/chapters";
import {
	promptAndCreateNewChapter,
	promptAndDeleteChapter,
	promptAndMoveChapterToNewFolder,
	promptAndRenameChapter,
	promptAndRenameChapterFolder,
} from "./chapterPrompts";
import { buildOptions, checkboxState, filterMatches } from "../core/property";
import { getChapterGroupKey, OTHER_GROUP_KEY } from "../core/utils";
import type { TabContext } from "./NovelChapterView";
import { renderPropertyCheckbox, renderPropertyDropdown } from "./PropertyCell";
import { renderEmptyState } from "./emptyState";

// Filter values for the checkbox property type
const FILTER_CHECKED = "__novel-manager-checked__";
const FILTER_UNCHECKED = "__novel-manager-unchecked__";

export class ChaptersTab {
	// State for filtering and searching
	private searchTerm = "";
	private filterValue = "all";

	// Collapsed chapter groups (by group key), kept across re-renders
	private collapsedGroups = new Set<string>();
	private currentGroupKeys: string[] = [];
	private toggleGroupsButton: ButtonComponent | null = null; // Collapse/expand all, updated after each render

	// Lookups filled on each render, for highlighting and revealing chapters
	private rowsByPath = new Map<string, HTMLTableRowElement>();
	private groupHeaderByKey = new Map<string, HTMLTableRowElement>();
	private groupKeyByPath = new Map<string, string>();
	private rowsByGroupKey = new Map<string, HTMLTableRowElement[]>();
	private scrolledToPath: string | null = null; // Last file scrolled to, so each file scrolls once
	private theadObserver: ResizeObserver | null = null; // Keeps --novel-thead-height in sync

	// Drag to move: the chapter being dragged and the group highlighted as the drop target
	private draggedFile: TFile | null = null;
	private dropTargetKey: string | null = null;

	constructor(
		private context: TabContext,
		private controlsContainer: HTMLDivElement,
		private tableContainer: HTMLDivElement,
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

	// Called by the view when it closes
	dispose(): void {
		this.theadObserver?.disconnect();
	}

	// Called by the view when the selected project changes
	onProjectChanged(): void {
		this.collapsedGroups.clear(); // Collapse state belongs to the previous project
	}

	// Renders the toolbar: search, filter and buttons on one wrapping line
	async renderControls(): Promise<void> {
		this.controlsContainer.empty();
		this.toggleGroupsButton = null;

		// The view's project selector already explains a missing project
		if (this.plugin.settings.novelProjects.length === 0) return;

		const controlsLine = this.controlsContainer.createDiv({
			cls: "novel-chapter-controls-line",
		});

		// Search Input
		const debouncedSearch = debounce((value: string) => {
			this.searchTerm = value;
			this.renderChapterTable().catch(console.error);
		}, 250); // 250ms delay

		const search = new SearchComponent(controlsLine)
			.setPlaceholder("Search chapters...")
			.setValue(this.searchTerm)
			.onChange(debouncedSearch);
		search.inputEl.parentElement?.addClass("novel-chapter-search"); // The search box wrapper

		// Filter and buttons stay together, so they wrap below the search as one block
		const actionsEl = controlsLine.createDiv({ cls: "novel-chapter-actions" });

		// Property Filter Dropdown
		const { propertyType, propertyColumnHeader, propertyNameToChange } =
			this.plugin.settings;
		const isCheckbox = propertyType === "checkbox";
		const { options } = buildOptions(this.plugin.settings);
		// Checked/Unchecked for checkboxes, otherwise one entry per option label
		const filterEntries = isCheckbox
			? [
					{ text: "Checked", value: FILTER_CHECKED },
					{ text: "Unchecked", value: FILTER_UNCHECKED },
				]
			: options.map((option) => ({ text: option.label, value: option.label }));

		// Reset a filter whose option no longer exists
		if (
			this.filterValue !== "all" &&
			!filterEntries.some((entry) => entry.value === this.filterValue)
		) {
			this.filterValue = "all";
		}

		// If there are entries to filter by, create a select element
		if (filterEntries.length > 0) {
			const filterSelect = actionsEl.createEl("select", {
				cls: "dropdown novel-chapter-filter-select",
			});
			const header = propertyColumnHeader.trim() || propertyNameToChange;
			filterSelect.createEl("option", {
				text: `${header}: all`,
				value: "all",
			});
			filterEntries.forEach((entry) => {
				filterSelect.createEl("option", entry);
			});
			// Set the current filter value
			filterSelect.value = this.filterValue;
			// Event listener for when the filter value changes
			filterSelect.addEventListener("change", () => {
				this.filterValue = filterSelect.value;
				this.renderChapterTable().catch(console.error); // Re-render the chapter table with the new filter value
			});
		}

		const buttonsEl = actionsEl.createDiv({ cls: "novel-chapter-buttons" });

		// Open Template Button
		new ButtonComponent(buttonsEl)
			.setIcon("file-symlink")
			.setTooltip("Open chapter template")
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

		// Collapse/Expand All Button (icon and tooltip set by updateToggleGroupsButton)
		this.toggleGroupsButton = new ButtonComponent(buttonsEl).onClick(() => {
			// If any group is expanded, collapse all; otherwise expand all
			this.collapsedGroups = this.anyGroupExpanded()
				? new Set(this.currentGroupKeys)
				: new Set();
			this.renderChapterTable().catch(console.error);
		});
		this.updateToggleGroupsButton();

		// Previous Chapter Button
		new ButtonComponent(buttonsEl)
			.setIcon("chevron-left")
			.setTooltip("Previous chapter")
			.onClick(() => {
				openAdjacentChapter(
					this.app,
					this.plugin.settings,
					"previous",
					this.selectedNovelProjectId,
				);
			});

		// Next Chapter Button
		new ButtonComponent(buttonsEl)
			.setIcon("chevron-right")
			.setTooltip("Next chapter")
			.onClick(() => {
				openAdjacentChapter(
					this.app,
					this.plugin.settings,
					"next",
					this.selectedNovelProjectId,
				);
			});

		// New Chapter Button
		new ButtonComponent(buttonsEl)
			.setIcon("plus")
			.setTooltip("New chapter")
			.setClass("novel-chapter-new-button")
			.onClick(() => this.newChapter());
	}

	// Opens the new-chapter dialog for the selected project
	private newChapter(): void {
		promptAndCreateNewChapter(
			this.app,
			this.plugin.settings,
			this.selectedNovelProjectId,
		).catch(console.error);
	}

	// Whether any group in the table is expanded
	private anyGroupExpanded(): boolean {
		return this.currentGroupKeys.some((key) => !this.collapsedGroups.has(key));
	}

	// Shows the action the collapse/expand button will do next
	private updateToggleGroupsButton(): void {
		const button = this.toggleGroupsButton;
		if (!button) return;
		const expanded = this.anyGroupExpanded();
		button
			.setIcon(expanded ? "chevrons-down-up" : "chevrons-up-down")
			.setTooltip(expanded ? "Collapse all" : "Expand all")
			.setDisabled(this.currentGroupKeys.length === 0); // Nothing to toggle
	}

	// Renders the chapter table based on the selected novel project
	async renderChapterTable(): Promise<void> {
		this.tableContainer.empty(); // Clear existing table content
		this.currentGroupKeys = []; // Early returns below leave no groups
		this.updateToggleGroupsButton();
		this.rowsByPath.clear();
		this.groupHeaderByKey.clear();
		this.groupKeyByPath.clear();
		this.rowsByGroupKey.clear();
		this.draggedFile = null; // A redraw mid-drag drops the old rows
		this.dropTargetKey = null;
		this.theadObserver?.disconnect();
		this.theadObserver = null;

		if (!this.selectedNovelProjectId) return; // If no project is selected, do nothing

		// Find the current novel project based on the selected ID
		const currentNovelProject = this.plugin.settings.novelProjects.find(
			(p) => p.id === this.selectedNovelProjectId,
		);
		// If the project is not found, show an error message
		if (!currentNovelProject) {
			renderEmptyState(this.tableContainer, "Selected novel project not found.");
			return;
		}

		// Get the chapters folder path for the current project
		const { path: chaptersFolderPath } = currentNovelProject;
		// Get the property settings for filtering
		const {
			showProperty,
			propertyNameToChange,
			propertyColumnHeader,
			propertyType,
			looseMatching,
		} = this.plugin.settings;
		const isCheckbox = propertyType === "checkbox";
		const { options } = buildOptions(this.plugin.settings);
		// Show the column when enabled and editable (checkboxes need no options)
		const showPropertyColumn =
			showProperty &&
			!!propertyNameToChange &&
			(isCheckbox || options.length > 0);

		// If no chapters folder path is configured, show a message
		if (!chaptersFolderPath || chaptersFolderPath.trim() === "") {
			renderEmptyState(
				this.tableContainer,
				`Project "${currentNovelProject.name}" has no folder path configured.`,
			);
			return;
		}

		// Get the project's chapters (already in display order, fragments folder excluded)
		const normalizedChaptersFolderPath = normalizePath(chaptersFolderPath);

		// A missing folder isn't an error: creating the first chapter creates it
		if (!(this.app.vault.getAbstractFileByPath(normalizedChaptersFolderPath) instanceof TFolder)) {
			renderEmptyState(
				this.tableContainer,
				`Folder "${normalizedChaptersFolderPath}" doesn't exist yet. It will be created with your first chapter.`,
				{ label: "New chapter", onClick: () => this.newChapter() },
			);
			return;
		}
		let chapterFiles = getProjectChapters(this.app, this.plugin.settings, currentNovelProject);

		// No chapters at all (before filtering)
		if (chapterFiles.length === 0) {
			renderEmptyState(this.tableContainer, "No chapters yet.", {
				label: "New chapter",
				onClick: () => this.newChapter(),
			});
			return;
		}

		// Apply Property Filter
		if (this.filterValue !== "all") {
			const filterOption = options.find(
				(option) => option.label === this.filterValue,
			);
			chapterFiles = chapterFiles.filter((file) => {
				const value: unknown =
					this.app.metadataCache.getFileCache(file)?.frontmatter?.[
						propertyNameToChange
					];
				if (isCheckbox) {
					const isChecked = checkboxState(value, looseMatching) === true;
					if (this.filterValue === FILTER_CHECKED) return isChecked;
					if (this.filterValue === FILTER_UNCHECKED) return !isChecked;
					return true;
				}
				return filterOption
					? filterMatches(value, filterOption, looseMatching)
					: true;
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

		// Chapters exist, but the search or filter hides them all
		if (chapterFiles.length === 0) {
			renderEmptyState(
				this.tableContainer,
				"No chapters match your search or filter.",
				{
					label: "Clear search and filter",
					onClick: () => {
						this.searchTerm = "";
						this.filterValue = "all";
						// Controls too, so the search box and dropdown show the reset
						void this.renderControls().then(() => this.renderChapterTable());
					},
				},
			);
			return;
		}

		// Split into groups by first-level subfolder (chapterFiles is already sorted)
		const groups: { key: string; name: string; files: TFile[] }[] = [];
		for (const file of chapterFiles) {
			const key = getChapterGroupKey(file, normalizedChaptersFolderPath);
			let group = groups[groups.length - 1];
			if (!group || group.key !== key) {
				group = {
					key,
					name: getGroupDisplayName(this.plugin.settings, key),
					files: [],
				};
				groups.push(group);
			}
			group.files.push(file);
		}
		this.currentGroupKeys = groups.map((g) => g.key);
		this.updateToggleGroupsButton();

		// Calculate the total count of chapters, excluding "Other" group if configured
		let totalCount = chapterFiles.length;
		if (this.plugin.settings.excludeOtherFromCount) {
			const otherGroup = groups.find((g) => g.key === OTHER_GROUP_KEY);
			if (otherGroup) {
				totalCount -= otherGroup.files.length;
			}
		}

		const table = this.tableContainer.createEl("table", {
			cls: "novel-chapter-table",
		});

		// Calculate the number of columns based on whether a property is being changed
		const numColumns = 1 + (showPropertyColumn ? 1 : 0);

		// Render Table Header with new total count
		const thead = table.createEl("thead");
		const headerRow = thead.createEl("tr");
		headerRow.createEl("th", { text: `Chapter (${totalCount})` });
		if (showPropertyColumn) {
			const propertyHeader =
				propertyColumnHeader.trim() || propertyNameToChange;
			headerRow.createEl("th", { text: propertyHeader });
		}

		// Group headers stick right below the column header, so track its height
		// (an observer, since it's 0 while the tab is hidden and changes with zoom)
		this.theadObserver = new ResizeObserver(() => {
			this.tableContainer.setCssProps({
				"--novel-thead-height": `${thead.offsetHeight}px`,
			});
		});
		this.theadObserver.observe(thead);

		// Drag to move (HTML drag-and-drop doesn't work in the mobile app)
		const canDrag = this.plugin.settings.dragToMove && !Platform.isMobile;
		if (canDrag) {
			// Leaving the table clears the highlight (relatedTarget is where the pointer went)
			table.addEventListener("dragleave", (ev) => {
				const to = ev.relatedTarget;
				if (!(to instanceof Node) || !table.contains(to)) this.setDropTarget(null);
			});
		}

		// Render Table Body with grouped chapters
		const tbody = table.createEl("tbody");
		for (const group of groups) {
			// Restore the collapsed state from before the re-render
			const startCollapsed = this.collapsedGroups.has(group.key);
			const groupRows: HTMLTableRowElement[] = []; // Rows of this group, toggled directly (no DOM IDs needed)
			this.rowsByGroupKey.set(group.key, groupRows);

			// Create a header row for each group
			const groupHeaderRow = tbody.createEl("tr", {
				cls: "chapter-group-header",
			});
			groupHeaderRow.toggleClass("collapsed", startCollapsed);
			this.groupHeaderByKey.set(group.key, groupHeaderRow);

			// Create a header cell that spans all columns
			const groupHeaderCell = groupHeaderRow.createEl("td");
			groupHeaderCell.colSpan = numColumns;

			// Create a toggle icon for expanding/collapsing the group
			const iconEl = groupHeaderCell.createSpan({
				cls: "group-toggle-icon",
			});
			setIcon(iconEl, startCollapsed ? "chevron-right" : "chevron-down");

			// Create a span for the group name and count
			groupHeaderCell.createSpan({
				text: ` ${group.name} (${group.files.length})`,
			});

			// Add an event listener to toggle the visibility of the group rows
			groupHeaderRow.addEventListener("click", () => {
				const isCollapsed = !this.collapsedGroups.has(group.key);
				if (isCollapsed) {
					this.collapsedGroups.add(group.key);
				} else {
					this.collapsedGroups.delete(group.key);
				}
				groupHeaderRow.toggleClass("collapsed", isCollapsed);
				setIcon(iconEl, isCollapsed ? "chevron-right" : "chevron-down");
				groupRows.forEach((row) => row.toggle(!isCollapsed));
				this.updateToggleGroupsButton();
				this.highlightActiveChapter(false); // Moves between the row and its group header
			});

			// Right-click menu for the group
			groupHeaderRow.addEventListener("contextmenu", (ev) => {
				ev.preventDefault();
				this.showGroupMenu(ev, group.key, currentNovelProject);
			});
			if (canDrag) this.attachDropTarget(groupHeaderRow, group.key, currentNovelProject);

			// For each file in the group, create a row in the table
			for (const file of group.files) {
				const row = tbody.createEl("tr", { cls: "chapter-data-row" });
				groupRows.push(row);
				this.rowsByPath.set(file.path, row);
				this.groupKeyByPath.set(file.path, group.key);
				if (startCollapsed) row.hide();

				const chapterCell = row.createEl("td");
				const chapterLink = chapterCell.createEl("a", {
					text: file.basename,
					href: "#",
					cls: "internal-link",
				});

				if (canDrag) {
					row.draggable = true;
					chapterLink.draggable = false; // Drag the row, not the link
					row.addEventListener("dragstart", (ev) => {
						this.draggedFile = file;
						if (ev.dataTransfer) {
							ev.dataTransfer.effectAllowed = "move";
							ev.dataTransfer.setData("application/x-novel-chapter", file.path);
						}
						row.addClass("is-dragging");
					});
					// Fires after a drop, Escape, or dropping outside
					row.addEventListener("dragend", () => {
						row.removeClass("is-dragging");
						this.draggedFile = null;
						this.setDropTarget(null);
					});
					this.attachDropTarget(row, group.key, currentNovelProject);
				}

				// Open the chapter; Ctrl/Cmd-click opens it in a new tab
				chapterLink.addEventListener("click", (ev) => {
					ev.preventDefault();
					this.app.workspace
						.openLinkText(file.path, "", Keymap.isModEvent(ev))
						.catch(console.error);
				});

				// Middle-click also opens a new tab
				chapterLink.addEventListener("auxclick", (ev) => {
					if (ev.button !== 1) return;
					ev.preventDefault();
					this.app.workspace
						.openLinkText(file.path, "", "tab")
						.catch(console.error);
				});

				// Context menu on the whole row: open, rename, delete, move
				row.addEventListener(
					"contextmenu",
					(ev: MouseEvent) => {
						ev.preventDefault();
						const menu = new Menu();

						// Open Actions
						menu.addItem((item: MenuItem) =>
							item
								.setTitle("Open in new tab")
								.setIcon("file-plus")
								.onClick(() => {
									this.app.workspace
										.openLinkText(file.path, "", "tab")
										.catch(console.error);
								}),
						);
						menu.addItem((item: MenuItem) =>
							item
								.setTitle("Open to the right")
								.setIcon("separator-vertical")
								.onClick(() => {
									this.app.workspace
										.openLinkText(file.path, "", "split")
										.catch(console.error);
								}),
						);

						menu.addSeparator();

						// Rename Action
						menu.addItem((item: MenuItem) =>
							item
								.setTitle("Rename")
								.setIcon("pencil")
								.onClick(() => {
									promptAndRenameChapter(this.app, file)
										.catch(console.error); // Prompt the user to rename the chapter
								}),
						);

						// Delete Action
						menu.addItem((item: MenuItem) =>
							item
								.setTitle("Delete")
								.setIcon("trash")
								.onClick(() => {
									promptAndDeleteChapter(this.app, file)
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

									// Same folders as the new-chapter dialog, project folder ("Other") first
									const [rootOption, ...subfolderOptions] =
										getChapterFolderOptions(
											this.app,
											this.plugin.settings,
											currentNovelProject,
										);
									// Parent folder, to disable moving to where the file already is
									const currentFileParentPath =
										file.parent?.path || "";

									const addFolderItem = (
										option: { name: string; path: string },
										icon: string,
									) => {
										folderMenu.addItem((subitem: MenuItem) => {
											subitem
												.setTitle(option.name)
												.setIcon(icon)
												.onClick(() => {
													moveChapter(this.app, file, option.path).catch(
														console.error,
													);
												});
											// Disable the folder the chapter is already in
											if (currentFileParentPath === option.path) {
												subitem.setDisabled(true);
											}
										});
									};

									addFolderItem(rootOption, "folder-up");
									// Separator between "Other" and the subfolders
									if (subfolderOptions.length > 0) {
										folderMenu.addSeparator();
									}
									subfolderOptions.forEach((option) =>
										addFolderItem(option, "folder"),
									);

									// Ask for a name, create the subfolder and move there
									folderMenu.addSeparator();
									folderMenu.addItem((subitem: MenuItem) => {
										subitem
											.setTitle("New folder...")
											.setIcon("folder-plus")
											.onClick(() => {
												promptAndMoveChapterToNewFolder(
													this.app,
													this.plugin.settings,
													currentNovelProject,
													file,
												);
											});
									});

									// Show the new menu at the location of the original click
									folderMenu.showAtMouseEvent(ev);
								});
						});

						// Show the context menu at the mouse event location
						menu.showAtMouseEvent(ev);
					},
				);

				// Property cell: a checkbox (checkbox type) or a dropdown of the options
				if (showPropertyColumn) {
					const propertyCell = row.createEl("td");
					const rawValue: unknown =
						this.app.metadataCache.getFileCache(file)?.frontmatter?.[
							propertyNameToChange
						];
					if (isCheckbox) {
						renderPropertyCheckbox(this.app, this.plugin.settings,
							propertyCell,
							file,
							currentNovelProject,
							propertyNameToChange,
							rawValue,
						);
					} else {
						renderPropertyDropdown(this.app, this.plugin.settings,
							propertyCell,
							file,
							currentNovelProject,
							propertyNameToChange,
							rawValue,
							options,
						);
					}
				}
			}
		}

		this.highlightActiveChapter(false); // No scrolling on plain refreshes
	}

	// Makes a group header or row accept dropped chapters, moving them into that group's folder
	private attachDropTarget(el: HTMLElement, groupKey: string, project: NovelProject): void {
		// Only another group accepts the drop (not accepting = the "not allowed" cursor)
		const canDrop = () =>
			this.draggedFile !== null &&
			this.groupKeyByPath.get(this.draggedFile.path) !== groupKey;

		el.addEventListener("dragover", (ev) => {
			if (!canDrop()) {
				this.setDropTarget(null);
				return;
			}
			ev.preventDefault(); // Accept the drop
			if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
			this.setDropTarget(groupKey);
		});
		el.addEventListener("drop", (ev) => {
			const file = this.draggedFile;
			if (!file || !canDrop()) return;
			ev.preventDefault();
			this.setDropTarget(null);
			moveChapter(this.app, file, getGroupFolderPath(project, groupKey)).catch(
				console.error,
			);
		});
	}

	// Highlights a group (header and rows) as the drop target; null clears it
	private setDropTarget(key: string | null): void {
		if (key === this.dropTargetKey) return; // dragover fires constantly
		if (this.dropTargetKey !== null) {
			this.groupHeaderByKey.get(this.dropTargetKey)?.removeClass("is-drop-target");
			this.rowsByGroupKey
				.get(this.dropTargetKey)
				?.forEach((row) => row.removeClass("is-drop-target-row"));
		}
		this.dropTargetKey = key;
		if (key !== null) {
			this.groupHeaderByKey.get(key)?.addClass("is-drop-target");
			this.rowsByGroupKey.get(key)?.forEach((row) => row.addClass("is-drop-target-row"));
		}
	}

	// Right-click menu on a group header: new chapter here, rename folder, collapse others
	private showGroupMenu(ev: MouseEvent, groupKey: string, project: NovelProject): void {
		const folderPath = getGroupFolderPath(project, groupKey);
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle("New chapter here")
				.setIcon("file-plus")
				.onClick(() => {
					promptAndCreateNewChapter(
						this.app,
						this.plugin.settings,
						project.id,
						folderPath,
					).catch(console.error);
				}),
		);

		menu.addItem((item) => {
			item.setTitle("Rename folder").setIcon("pencil");
			// The "Other" group is the project folder itself (renamed in settings)
			const folder = this.app.vault.getAbstractFileByPath(folderPath);
			if (groupKey === OTHER_GROUP_KEY || !(folder instanceof TFolder)) {
				item.setDisabled(true);
				return;
			}
			item.onClick(() => {
				promptAndRenameChapterFolder(this.app, folder, (oldName, newName) => {
					// Keep a collapsed group collapsed under its new name
					if (this.collapsedGroups.delete(oldName)) this.collapsedGroups.add(newName);
				});
			});
		});

		menu.addSeparator();

		menu.addItem((item) =>
			item
				.setTitle("Collapse other groups")
				.setIcon("chevrons-down-up")
				.onClick(() => {
					this.collapsedGroups = new Set(
						this.currentGroupKeys.filter((key) => key !== groupKey),
					);
					this.renderChapterTable().catch(console.error);
				}),
		);

		menu.showAtMouseEvent(ev);
	}

	// Marks the open chapter's row (or its collapsed group's header); scroll only when it changed
	highlightActiveChapter(scroll: boolean): void {
		this.tableContainer
			.querySelectorAll(".is-active-chapter, .has-active-chapter")
			.forEach((el) => el.removeClass("is-active-chapter", "has-active-chapter"));

		const path = this.app.workspace.getActiveFile()?.path ?? null;
		// Only scroll calls update this, so a redraw in between doesn't swallow the scroll
		const changed = path !== this.scrolledToPath;
		if (scroll) this.scrolledToPath = path;
		if (!path) return;

		const row = this.rowsByPath.get(path);
		if (!row) return; // Not a chapter in this table

		// A collapsed group hides the row, so mark its header instead
		const groupKey = this.groupKeyByPath.get(path) ?? "";
		const target = this.collapsedGroups.has(groupKey)
			? this.groupHeaderByKey.get(groupKey)
			: row;
		if (!target) return;
		target.addClass(target === row ? "is-active-chapter" : "has-active-chapter");
		if (scroll && changed) target.scrollIntoView({ block: "nearest" });
	}

	// Expands the group holding a chapter, if it's collapsed
	async expandGroupOf(file: TFile): Promise<void> {
		const groupKey = this.groupKeyByPath.get(file.path);
		if (groupKey !== undefined && this.collapsedGroups.delete(groupKey)) {
			await this.renderChapterTable(); // Re-render with the group expanded
		}
	}

	// Shows a chapter: expands its group, scrolls it to the center and flashes it
	async revealChapter(file: TFile): Promise<void> {
		await this.expandGroupOf(file);
		const row = this.rowsByPath.get(file.path);
		if (!row) return;
		row.scrollIntoView({ block: "center" });
		// Restart the animation if it's already running
		row.removeClass("novel-flash");
		void row.offsetWidth;
		row.addClass("novel-flash");
		row.addEventListener("animationend", () => row.removeClass("novel-flash"), { once: true });
	}
}
