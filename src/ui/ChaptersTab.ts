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
	setIcon,
	TextComponent,
	TFile,
} from "obsidian";
import type NovelChapterPlugin from "../main";
import {
	getChapterFolderOptions,
	getProjectChapters,
	moveChapter,
	openAdjacentChapter,
} from "../core/chapters";
import {
	promptAndCreateNewChapter,
	promptAndDeleteChapter,
	promptAndRenameChapter,
} from "./chapterPrompts";
import { buildOptions, checkboxState, filterMatches } from "../core/property";
import { getChapterGroupKey, OTHER_GROUP_KEY } from "../core/utils";
import type { TabContext } from "./NovelChapterView";
import { renderPropertyCheckbox, renderPropertyDropdown } from "./PropertyCell";

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

	private buildProjectSelector(parentEl: HTMLElement): void {
		this.context.buildProjectSelector(parentEl);
	}

	// Called by the view when the selected project changes
	onProjectChanged(): void {
		this.collapsedGroups.clear(); // Collapse state belongs to the previous project
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

		// Collapse/Expand All Button
		new ButtonComponent(controlsLine1)
			.setIcon("chevrons-down")
			.setTooltip("Toggle folder groups")
			.onClick(() => {
				// If any group is expanded, collapse all; otherwise expand all
				const anyExpanded = this.currentGroupKeys.some(
					(key) => !this.collapsedGroups.has(key),
				);
				this.collapsedGroups = anyExpanded
					? new Set(this.currentGroupKeys)
					: new Set();
				this.renderChapterTable().catch(console.error);
			});

		// Previous Chapter Button
		new ButtonComponent(controlsLine1)
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
		new ButtonComponent(controlsLine1)
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
		new ButtonComponent(controlsLine1)
			.setIcon("plus")
			.setTooltip("New chapter")
			.setClass("novel-chapter-new-button")
			.onClick(async () => {
				// Prompt the user to create a new chapter in the selected project
				await promptAndCreateNewChapter(this.app, this.plugin.settings,
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
		const isCheckbox = this.plugin.settings.propertyType === "checkbox";
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
			const filterSelect = controlsLine2.createEl("select");
			filterSelect.addClass("novel-chapter-filter-select");
			filterSelect.createEl("option", {
				text: "Filter by property...",
				value: "all",
			});
			filterEntries.forEach((entry) => {
				filterSelect.createEl("option", entry);
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
			this.tableContainer.setText(
				`Project "${currentNovelProject.name}" has no folder path configured.`,
			);
			return;
		}

		// Get the project's chapters (already in display order, fragments folder excluded)
		const normalizedChaptersFolderPath = normalizePath(chaptersFolderPath);
		let chapterFiles = getProjectChapters(this.app, this.plugin.settings, currentNovelProject);

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

		// If no chapters are found, show a message
		if (chapterFiles.length === 0) {
			this.tableContainer.setText(
				`No chapters found in "${normalizedChaptersFolderPath}" matching your criteria.`,
			);
			return;
		}

		const OTHER_GROUP_NAME = this.plugin.settings.otherGroupName || "Other"; // Display name for the "Other" group

		// Split into groups by first-level subfolder (chapterFiles is already sorted)
		const groups: { key: string; name: string; files: TFile[] }[] = [];
		for (const file of chapterFiles) {
			const key = getChapterGroupKey(file, normalizedChaptersFolderPath);
			let group = groups[groups.length - 1];
			if (!group || group.key !== key) {
				group = {
					key,
					name: key === OTHER_GROUP_KEY ? OTHER_GROUP_NAME : key,
					files: [],
				};
				groups.push(group);
			}
			group.files.push(file);
		}
		this.currentGroupKeys = groups.map((g) => g.key);

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

		// Render Table Body with grouped chapters
		const tbody = table.createEl("tbody");
		for (const group of groups) {
			// Restore the collapsed state from before the re-render
			const startCollapsed = this.collapsedGroups.has(group.key);
			const groupRows: HTMLElement[] = []; // Rows of this group, toggled directly (no DOM IDs needed)

			// Create a header row for each group
			const groupHeaderRow = tbody.createEl("tr", {
				cls: "chapter-group-header",
			});
			groupHeaderRow.toggleClass("collapsed", startCollapsed);

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
			});

			// For each file in the group, create a row in the table
			for (const file of group.files) {
				const row = tbody.createEl("tr", { cls: "chapter-data-row" });
				groupRows.push(row);
				if (startCollapsed) row.hide();

				const chapterCell = row.createEl("td");
				const chapterLink = chapterCell.createEl("a", {
					text: file.basename,
					href: "#",
					cls: "internal-link",
				});

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

				// Context menu: rename, delete, move
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
	}
}
