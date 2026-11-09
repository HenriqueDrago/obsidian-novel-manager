// The Chapters tab: toolbar and grouped chapter table
import {
	App,
	ButtonComponent,
	debounce,
	Keymap,
	Menu,
	MenuItem,
	MenuPositionDef,
	Modifier,
	normalizePath,
	Notice,
	Platform,
	setIcon,
	SearchComponent,
	TFile,
	TFolder,
} from "obsidian";
import type NovelChapterPlugin from "../main";
import { getNumberingOptions, NovelProject } from "../settings";
import {
	getChapterFolderOptions,
	getGroupFolderPath,
	getProjectChapters,
	getGroupDisplayName,
	openAdjacentChapter,
	readNumberingMarker,
} from "../core/chapters";
import {
	isGroupNumbered,
	isNumberingBusy,
	moveChapterBy,
	moveChapterToFolder,
	planCurrentNumbering,
} from "../core/renumber";
import { NumberingModal } from "./NumberingModal";
import {
	promptAndCreateNewChapter,
	promptAndDeleteChapter,
	promptAndMoveChapterToNewFolder,
	promptAndRenameChapter,
	promptAndRenameChapterFolder,
	promptAndSetChapterExcluded,
} from "./chapterPrompts";
import {
	buildOptions,
	checkboxState,
	filterMatches,
	summarizeCheckbox,
	summarizeOptions,
} from "../core/property";
import { getChapterGroupKey, naturalCompare, OTHER_GROUP_KEY } from "../core/utils";
import type { TabContext } from "./NovelChapterView";
import { renderPropertyCheckbox, renderPropertyDropdown } from "./PropertyCell";
import { renderEmptyState } from "./emptyState";
import { renderCheckboxProgress, renderOptionProgress } from "./ProgressSummary";
import {
	countInUnit,
	formatWordCount,
	TextCounts,
	unitLabel,
	WordCountUnit,
} from "../core/wordCount";

// Filter values for the checkbox property type
const FILTER_CHECKED = "__novel-manager-checked__";
const FILTER_UNCHECKED = "__novel-manager-unchecked__";

// The property cell's control (dropdown or checkbox), reachable from the keyboard
const PROPERTY_CONTROL = "td select, td input[type=checkbox]";

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

	// Word counts: the spans of this render, filled in place once the counts are ready
	private wordCountRows: { el: HTMLElement; file: TFile }[] = [];
	private wordCountTotals: { el: HTMLElement; files: TFile[]; prefix: string }[] = [];
	private renderToken = 0; // Counts finishing after a newer render are ignored

	// Keyboard navigation: the selected item, "row:<path>" or "group:<key>"
	private selectedId: string | null = null;

	constructor(
		private context: TabContext,
		private controlsContainer: HTMLDivElement,
		private tableContainer: HTMLDivElement,
	) {
		this.registerNavigationKeys();

		// Focusing an item (click or keys) selects it; Tab onto the table picks one
		tableContainer.addEventListener("focusin", (ev) => {
			if (!this.plugin.settings.keyboardNavigation) return;
			const target = ev.target;
			if (target === tableContainer) {
				this.focusTable();
			} else if (target instanceof HTMLElement) {
				const item = target.closest<HTMLElement>("[data-nav-id]");
				if (item) this.selectItem(item, false);
			}
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

	// The project shown in the table
	private getSelectedProject(): NovelProject | null {
		return this.plugin.settings.novelProjects.find((p) => p.id === this.selectedNovelProjectId) ?? null;
	}

	private isFiltering(): boolean {
		return this.filterValue !== "all" || this.searchTerm !== "";
	}

	// Moves a chapter up or down; the keyboard selection follows it to its new name
	private async moveChapter(file: TFile, project: NovelProject, offset: -1 | 1): Promise<void> {
		const wasSelected = this.selectedId === `row:${file.path}`;
		const moved = await moveChapterBy(this.app, this.plugin.settings, project, file, offset);
		if (moved && wasSelected) this.selectedId = `row:${file.path}`; // The path after the rename
	}

	// Up and down buttons of a row; faded at the group's borders and while filtering
	private renderMoveButtons(
		parentEl: HTMLElement,
		file: TFile,
		project: NovelProject,
		index: number,
		count: number,
		isFiltering: boolean,
	): void {
		const wrapEl = parentEl.createSpan({ cls: "novel-move-buttons" });
		const add = (icon: string, label: string, offset: -1 | 1, atBorder: boolean, borderReason: string) => {
			const disabled = isFiltering || atBorder;
			const button = wrapEl.createSpan({
				cls: "clickable-icon novel-move-button",
				attr: {
					role: "button",
					"aria-label": isFiltering
						? "Clear the search and filter to reorder"
						: atBorder
							? borderReason
							: label,
					"aria-disabled": String(disabled),
				},
			});
			setIcon(button, icon);
			button.toggleClass("is-disabled", disabled);
			button.addEventListener("click", (ev) => {
				ev.preventDefault();
				ev.stopPropagation();
				if (!disabled && !isNumberingBusy()) void this.moveChapter(file, project, offset);
			});
		};
		add("chevron-up", "Move up", -1, index === 0, "Already first in this group");
		add("chevron-down", "Move down", 1, index === count - 1, "Already last in this group");
	}

	// Bar above the table when chapter names don't follow the numbering (e.g. renamed elsewhere)
	private renderNumberingStaleBar(project: NovelProject, changes: number): void {
		const barEl = this.tableContainer.createDiv({ cls: "novel-numbering-stale" });
		setIcon(barEl.createSpan({ cls: "novel-numbering-stale-icon" }), "alert-circle");
		barEl.createSpan({
			cls: "novel-numbering-stale-text",
			text: `${changes} ${changes === 1 ? "chapter doesn't" : "chapters don't"} match the numbering.`,
		});
		new ButtonComponent(barEl).setButtonText("Renumber…").onClick(() => {
			new NumberingModal(this.plugin, {
				title: "Renumber chapters",
				options: getNumberingOptions(this.plugin.settings),
				projects: [project],
				editableOptions: false, // Settings are global; this only fixes one project
			}).open();
		});
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

	// Renders the chapter table, keeping the keyboard selection (and focus) across the redraw
	async renderChapterTable(): Promise<void> {
		const hadFocus = this.tableContainer.contains(activeDocument.activeElement);
		const selected = this.getSelectedItem();
		const selectedIndex = selected ? this.getNavItems().indexOf(selected) : -1;

		await this.renderTableContent();
		this.restoreSelection(hadFocus, selectedIndex);
	}

	// Renders the chapter table based on the selected novel project
	private async renderTableContent(): Promise<void> {
		this.tableContainer.empty(); // Clear existing table content
		// Focusable for the "Focus chapter list" command; a Tab stop with keyboard navigation
		const keyboardNav = this.plugin.settings.keyboardNavigation;
		this.tableContainer.tabIndex = keyboardNav ? 0 : -1;
		this.currentGroupKeys = []; // Early returns below leave no groups
		this.updateToggleGroupsButton();
		this.rowsByPath.clear();
		this.groupHeaderByKey.clear();
		this.groupKeyByPath.clear();
		this.rowsByGroupKey.clear();
		this.draggedFile = null; // A redraw mid-drag drops the old rows
		this.dropTargetKey = null;
		this.wordCountRows = [];
		this.wordCountTotals = [];
		const renderToken = ++this.renderToken;
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
		// Unfiltered chapters per group, for "(1 of 4)" while filtering
		const unfilteredByGroup = new Map<string, number>();
		for (const file of chapterFiles) {
			const key = getChapterGroupKey(file, normalizedChaptersFolderPath);
			unfilteredByGroup.set(key, (unfilteredByGroup.get(key) ?? 0) + 1);
		}
		// Unfiltered total for the header (same rule as the tab count)
		const unfilteredCount = this.plugin.settings.excludeOtherFromCount
			? chapterFiles.filter(
					(file) => getChapterGroupKey(file, normalizedChaptersFolderPath) !== OTHER_GROUP_KEY,
				).length
			: chapterFiles.length;

		// First-level subfolders (fragments folder excluded), so empty ones still show as groups
		const subfolderKeys = getChapterFolderOptions(
			this.app,
			this.plugin.settings,
			currentNovelProject,
		)
			.slice(1) // The first option is the project folder ("Other")
			.map((option) => option.path.substring(normalizedChaptersFolderPath.length + 1));
		const isFiltering = this.filterValue !== "all" || this.searchTerm !== "";

		// No chapters and no folders to show
		if (chapterFiles.length === 0 && subfolderKeys.length === 0) {
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

		// The search or filter hides every chapter
		if (chapterFiles.length === 0 && isFiltering) {
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
		// Empty subfolders as "(0)" groups, so they can be dropped on and right-clicked
		// (not while filtering, where they'd only be clutter)
		if (!isFiltering) {
			const existingKeys = new Set(groups.map((g) => g.key));
			for (const key of subfolderKeys) {
				if (existingKeys.has(key)) continue;
				groups.push({
					key,
					name: getGroupDisplayName(this.plugin.settings, key),
					files: [],
				});
			}
			// Same order as sortChapters: subfolders naturally, "Other" last
			groups.sort((a, b) => {
				if (a.key === OTHER_GROUP_KEY) return 1;
				if (b.key === OTHER_GROUP_KEY) return -1;
				return naturalCompare(a.key, b.key);
			});
		}
		this.currentGroupKeys = groups.map((g) => g.key);
		this.updateToggleGroupsButton();

		// Progress summary of some chapters' property values (read-only), if enabled for this type
		const { checkboxProgress, optionProgress, optionProgressText } =
			this.plugin.settings;
		const showProgress =
			showPropertyColumn && (isCheckbox ? checkboxProgress : optionProgress);
		const renderProgress = (parentEl: HTMLElement, files: TFile[]) => {
			if (!showProgress || files.length === 0) return;
			const values: unknown[] = files.map(
				(file) =>
					this.app.metadataCache.getFileCache(file)?.frontmatter?.[propertyNameToChange] as unknown,
			);
			if (isCheckbox) {
				renderCheckboxProgress(parentEl, summarizeCheckbox(values, looseMatching));
			} else {
				renderOptionProgress(
					parentEl,
					summarizeOptions(values, options, looseMatching),
					options,
					optionProgressText,
				);
			}
		};

		// Names out of step with the numbering (changed outside the view): offer to fix them
		if (this.plugin.settings.autoNumbering && !isNumberingBusy()) {
			const { changes } = planCurrentNumbering(this.app, this.plugin.settings, currentNovelProject);
			if (changes.length > 0) this.renderNumberingStaleBar(currentNovelProject, changes.length);
		}

		const table = this.tableContainer.createEl("table", {
			cls: "novel-chapter-table",
		});

		// Calculate the number of columns based on whether a property is being changed
		const numColumns = 1 + (showPropertyColumn ? 1 : 0);

		// Render Table Header with new total count
		const thead = table.createEl("thead");
		const headerRow = thead.createEl("tr");
		// Chapters counted in the totals (the progress summary uses the same ones)
		const totalFiles = this.plugin.settings.excludeOtherFromCount
			? groups.filter((g) => g.key !== OTHER_GROUP_KEY).flatMap((g) => g.files)
			: groups.flatMap((g) => g.files);
		const { wordCountGranularity, showChapterCount } = this.plugin.settings;
		// Counts need at least one unit selected
		const showWordCounts =
			this.plugin.settings.showWordCounts && this.plugin.settings.wordCountUnits.length > 0;
		// Plain column titles
		headerRow.createEl("th", { text: "Chapters" });
		if (showPropertyColumn) {
			headerRow.createEl("th", { text: propertyColumnHeader.trim() || propertyNameToChange });
		}

		// Stats line under a header: "24 chapters · 86.2K words", progress on the right.
		// "3 of 24 chapters" while a search or filter hides some.
		const renderStats = (parentEl: HTMLElement, files: TFile[], unfiltered: number) => {
			const showCounts = showWordCounts && wordCountGranularity !== "chapters-only" && files.length > 0;
			const showBar = showProgress && files.length > 0;
			if (!showChapterCount && !showCounts && !showBar) return; // Nothing to show: no empty line
			const lineEl = parentEl.createDiv({ cls: "novel-stats-line" });
			if (showChapterCount) {
				const word = (n: number) => (n === 1 ? "chapter" : "chapters");
				lineEl.createSpan({
					cls: "novel-stats-count",
					text: isFiltering
						? `${files.length} of ${unfiltered} ${word(unfiltered)}`
						: `${files.length} ${word(files.length)}`,
				});
			}
			if (showCounts) {
				this.wordCountTotals.push({
					el: lineEl.createSpan({ cls: "novel-word-count" }),
					files,
					prefix: showChapterCount ? "· " : "", // Separates the counts from the chapter count
				});
			}
			renderProgress(lineEl, files);
		};

		// Project stats: a second header row spanning both columns, sticky with the titles
		const statsRow = thead.createEl("tr", { cls: "novel-summary-row" });
		const statsCell = statsRow.createEl("th");
		statsCell.colSpan = numColumns;
		renderStats(statsCell, totalFiles, unfilteredCount); // Same chapters as the totals
		if (!statsCell.hasChildNodes()) statsRow.remove(); // Everything turned off: no empty row

		// The stats row sticks under the titles, and group headers under both, so track the heights
		// (an observer, since they're 0 while the tab is hidden and change with zoom)
		this.theadObserver = new ResizeObserver(() => {
			this.tableContainer.setCssProps({
				"--novel-thead-height": `${thead.offsetHeight}px`,
				"--novel-header-row-height": `${headerRow.offsetHeight}px`,
			});
		});
		this.theadObserver.observe(thead);

		// Drag to move (HTML drag-and-drop doesn't work in the mobile app)
		const canDrag = this.plugin.settings.dragToMove && !Platform.isMobile;
		let newFolderZone: HTMLElement | null = null; // Shown below the table while dragging
		if (canDrag) {
			// Leaving the table clears the highlight (relatedTarget is where the pointer went)
			table.addEventListener("dragleave", (ev) => {
				const to = ev.relatedTarget;
				if (!(to instanceof Node) || !table.contains(to)) this.setDropTarget(null);
			});
			newFolderZone = this.renderNewFolderDropZone(currentNovelProject);
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
			if (keyboardNav) {
				groupHeaderRow.tabIndex = -1; // Focusable, but not a Tab stop
				groupHeaderRow.dataset.navId = `group:${group.key}`;
			}

			// Create a header cell that spans all columns
			const groupHeaderCell = groupHeaderRow.createEl("td");
			groupHeaderCell.colSpan = numColumns;

			// Two lines (a td can't be flex): toggle icon and name, then the group's stats
			const groupHeaderContent = groupHeaderCell.createDiv({
				cls: "chapter-group-header-content",
			});
			const titleEl = groupHeaderContent.createDiv({ cls: "chapter-group-title" });
			const iconEl = titleEl.createSpan({
				cls: "group-toggle-icon",
			});
			setIcon(iconEl, startCollapsed ? "chevron-right" : "chevron-down");
			// The name gets cut with "…" when space runs out
			titleEl.createSpan({
				cls: "chapter-group-name",
				text: group.name,
				attr: { "aria-label": group.name },
			});
			renderStats(
				groupHeaderContent,
				group.files,
				unfilteredByGroup.get(group.key) ?? group.files.length,
			);

			// Clicking the header collapses or expands the group
			groupHeaderRow.addEventListener("click", () => this.toggleGroup(group.key));

			// Right-click menu for the group
			groupHeaderRow.addEventListener("contextmenu", (ev) => {
				ev.preventDefault();
				this.showGroupMenu(this.menuPosition(ev, groupHeaderRow), group.key, currentNovelProject);
			});
			if (canDrag) this.attachDropTarget(groupHeaderRow, group.key, currentNovelProject);

			// Reordering buttons for numbered groups
			const showMoveButtons = isGroupNumbered(this.plugin.settings, group.key);

			// For each file in the group, create a row in the table
			group.files.forEach((file, fileIndex) => {
				const row = tbody.createEl("tr", { cls: "chapter-data-row" });
				groupRows.push(row);
				if (keyboardNav) {
					row.tabIndex = -1;
					row.dataset.navId = `row:${file.path}`;
				}
				this.rowsByPath.set(file.path, row);
				this.groupKeyByPath.set(file.path, group.key);
				if (startCollapsed) row.hide();

				const chapterCell = row.createEl("td");
				const showRowCount = showWordCounts && wordCountGranularity !== "groups";
				// With a word count or move buttons, they share a flex row with the link (on the right)
				const linkParent = showRowCount || showMoveButtons
					? chapterCell.createDiv({ cls: "novel-chapter-cell-content" })
					: chapterCell;
				const chapterLink = linkParent.createEl("a", {
					text: file.basename,
					href: "#",
					cls: "internal-link",
				});
				if (showRowCount) {
					this.wordCountRows.push({
						el: linkParent.createSpan({ cls: "novel-word-count" }),
						file,
					});
				}
				if (showMoveButtons) {
					this.renderMoveButtons(
						linkParent,
						file,
						currentNovelProject,
						fileIndex,
						group.files.length,
						isFiltering,
					);
				}

				if (canDrag) {
					row.draggable = true;
					chapterLink.draggable = false; // Drag the row, not the link
					row.addEventListener("dragstart", (ev) => {
						this.draggedFile = file;
						if (ev.dataTransfer) {
							// "copy" too, so editors accept the drop and insert the link
							ev.dataTransfer.effectAllowed = "copyMove";
							ev.dataTransfer.setData("application/x-novel-chapter", file.path);
							// Dropped into a note: a link, following the user's link settings
							ev.dataTransfer.setData(
								"text/plain",
								this.app.fileManager.generateMarkdownLink(file, ""),
							);
						}
						row.addClass("is-dragging");
						// Next frame: changing the layout during dragstart can cancel the drag
						window.requestAnimationFrame(() => {
							if (this.draggedFile === file) {
								this.tableContainer.addClass("is-dragging-chapter");
							}
						});
					});
					// Fires after a drop, Escape, or dropping outside
					row.addEventListener("dragend", () => {
						row.removeClass("is-dragging");
						this.draggedFile = null;
						this.setDropTarget(null);
						this.tableContainer.removeClass("is-dragging-chapter");
						newFolderZone?.removeClass("is-drop-target");
					});
					this.attachDropTarget(row, group.key, currentNovelProject);
				}

				// Page preview on hover (Ctrl/Cmd by default)
				chapterLink.addEventListener("mouseover", (ev) => {
					this.context.showHoverPreview(ev, chapterLink, file);
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

				// Context menu on the whole row (also from the menu key or Shift+F10)
				row.addEventListener("contextmenu", (ev: MouseEvent) => {
					ev.preventDefault();
					this.showChapterMenu(file, currentNovelProject, this.menuPosition(ev, row));
				});

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
			});
		}

		this.highlightActiveChapter(false); // No scrolling on plain refreshes

		// Show what's counted, then count the rest in the background and fill in place
		if (showWordCounts) {
			this.fillWordCounts();
			const cache = this.plugin.wordCounts;
			const missing = groups.flatMap((g) => g.files).filter((file) => cache.get(file) === undefined);
			if (missing.length > 0) {
				cache
					.compute(missing)
					.then(() => {
						if (renderToken === this.renderToken) this.fillWordCounts();
					})
					.catch(console.error);
			}
		}
	}

	// Writes the word counts from the cache; "…" for anything never counted
	private fillWordCounts(): void {
		const { wordCountFormat, wordCountUnits: units, wordsPerPage } = this.plugin.settings;
		const cache = this.plugin.wordCounts;
		const valueIn = (counts: TextCounts, unit: WordCountUnit) => countInUnit(counts, unit, wordsPerPage);
		// Exact numbers on hover, every selected unit (pages also show the words they come from)
		const tooltipFor = (counts: TextCounts) => {
			const tooltipUnits: WordCountUnit[] =
				units.includes("pages") && !units.includes("words") ? ["words", ...units] : units;
			return tooltipUnits
				.map((unit) => {
					const value = valueIn(counts, unit);
					return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${unitLabel(value, unit)}`;
				})
				.join(" · ");
		};
		const setCounting = (el: HTMLElement, prefix: string) => {
			el.setText(`${prefix}…`);
			el.setAttr("aria-label", "Counting…");
		};

		// Rows: just the number of the first selected unit (rows are narrow); the last known count
		// stays up while a changed chapter is recounted
		for (const { el, file } of this.wordCountRows) {
			const counts = cache.getLatest(file);
			if (!counts) {
				setCounting(el, "");
				continue;
			}
			el.setText(formatWordCount(valueIn(counts, units[0]), wordCountFormat, units[0]));
			el.setAttr("aria-label", tooltipFor(counts));
		}

		// Headers: every selected unit, "86.2K words / 412K characters"
		for (const { el, files, prefix } of this.wordCountTotals) {
			// Sums words and characters, so pages are counted from the total (no rounding drift)
			const sum: TextCounts = { words: 0, characters: 0 };
			let complete = true;
			for (const file of files) {
				const counts = cache.getLatest(file);
				if (!counts) {
					complete = false;
					break;
				}
				sum.words += counts.words;
				sum.characters += counts.characters;
			}
			if (!complete) {
				setCounting(el, prefix);
				continue;
			}
			const parts = units.map((unit) => {
				const value = valueIn(sum, unit);
				return `${formatWordCount(value, wordCountFormat, unit)} ${unitLabel(value, unit)}`;
			});
			el.setText(`${prefix}${parts.join(" / ")}`);
			el.setAttr("aria-label", tooltipFor(sum));
		}
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
			moveChapterToFolder(
				this.app,
				this.plugin.settings,
				project,
				file,
				getGroupFolderPath(project, groupKey),
			).catch(console.error);
		});
	}

	// Drop zone below the table: asks for a folder name, creates it and moves the chapter there
	private renderNewFolderDropZone(project: NovelProject): HTMLElement {
		const zone = this.tableContainer.createDiv({ cls: "novel-new-folder-dropzone" });
		setIcon(zone.createSpan({ cls: "novel-new-folder-dropzone-icon" }), "folder-plus");
		zone.createSpan({ text: "Drop here to move to a new folder" });

		zone.addEventListener("dragover", (ev) => {
			if (!this.draggedFile) return;
			ev.preventDefault(); // Accept the drop
			if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
			this.setDropTarget(null); // No group stays lit
			zone.addClass("is-drop-target");
		});
		zone.addEventListener("dragleave", (ev) => {
			// Ignore moves between the zone's own children
			const to = ev.relatedTarget;
			if (!(to instanceof Node) || !zone.contains(to)) zone.removeClass("is-drop-target");
		});
		zone.addEventListener("drop", (ev) => {
			const file = this.draggedFile;
			if (!file) return;
			ev.preventDefault();
			zone.removeClass("is-drop-target");
			promptAndMoveChapterToNewFolder(this.app, this.plugin.settings, project, file);
		});
		return zone;
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

	// ====== Keyboard navigation ======

	// Keys go through the view's scope, since global hotkeys (e.g. F2 = rename file) win over keydown listeners
	private registerNavigationKeys(): void {
		// The handler gets the selected item, and the property control when focus is in it
		const register = (
			modifiers: Modifier[],
			key: string,
			handler: (item: HTMLElement | null, control: HTMLElement | null) => boolean,
		) => {
			this.context.scope.register(modifiers, key, (evt) => {
				const target = this.getKeyTarget(evt);
				if (!target) return true; // Not ours
				// Handled: no default action, no other hotkeys. Otherwise let it through.
				return !handler(target.item, target.control);
			});
		};
		// Parses an item into its chapter file or group key
		const parse = (item: HTMLElement | null) => {
			const id = item?.dataset.navId ?? "";
			if (id.startsWith("row:")) {
				const file = this.app.vault.getAbstractFileByPath(id.slice(4));
				return { file: file instanceof TFile ? file : null, groupKey: null };
			}
			if (id.startsWith("group:")) return { file: null, groupKey: id.slice(6) };
			return { file: null, groupKey: null };
		};

		// Each handler returns whether it acted; a key that does nothing goes on to Obsidian
		// Arrows always move between rows, even from the dropdown (which would change the value)
		register([], "ArrowDown", (item) => this.moveSelection(item, 1));
		register([], "ArrowUp", (item) => this.moveSelection(item, -1));
		register([], "Home", () => this.moveSelection(null, "first"));
		register([], "End", () => this.moveSelection(null, "last"));

		register([], "Enter", (item, control) => {
			if (control) {
				this.activatePropertyControl(control); // Open the dropdown, or toggle the checkbox
				return true;
			}
			const { file, groupKey } = parse(item);
			if (file) {
				this.app.workspace.openLinkText(file.path, "", false).catch(console.error);
				return true;
			}
			if (groupKey !== null) {
				this.toggleGroup(groupKey);
				return true;
			}
			return false;
		});
		register(["Mod"], "Enter", (item) => {
			const { file } = parse(item);
			if (!file) return false;
			this.app.workspace.openLinkText(file.path, "", "tab").catch(console.error);
			return true;
		});

		register([], "ArrowRight", (item, control) => {
			if (control) return true; // Already in the last cell; swallowed so the dropdown keeps its value
			const { file, groupKey } = parse(item);
			if (file) {
				// Into the property cell
				const propertyControl = item?.querySelector<HTMLElement>(PROPERTY_CONTROL);
				propertyControl?.focus();
				return !!propertyControl;
			}
			if (groupKey === null) return false;
			if (this.collapsedGroups.has(groupKey)) {
				this.toggleGroup(groupKey);
				return true;
			}
			const firstRow = this.rowsByGroupKey.get(groupKey)?.[0];
			if (firstRow) this.selectItem(firstRow, true);
			return !!firstRow;
		});
		register([], "ArrowLeft", (item, control) => {
			if (control) {
				if (item) this.selectItem(item, true); // Back to the row
				return !!item;
			}
			const { file, groupKey } = parse(item);
			if (file) {
				const header = this.groupHeaderByKey.get(this.groupKeyByPath.get(file.path) ?? "");
				if (header) this.selectItem(header, true);
				return !!header;
			}
			if (groupKey !== null && !this.collapsedGroups.has(groupKey)) {
				this.toggleGroup(groupKey);
				return true;
			}
			return false;
		});

		register([], "F2", (item) => {
			const { file, groupKey } = parse(item);
			if (file) {
				promptAndRenameChapter(this.app, this.plugin.settings, file).catch(console.error);
				return true;
			}
			if (groupKey === null) return false;
			const project = this.getSelectedProject();
			const folder = project ? this.getGroupFolder(groupKey, project) : null;
			if (project && folder) this.renameGroupFolder(folder, project);
			return !!folder; // "Other" can't be renamed here
		});
		register([], "Delete", (item) => {
			const { file } = parse(item);
			if (!file) return false;
			promptAndDeleteChapter(this.app, this.plugin.settings, file).catch(console.error);
			return true;
		});

		// Alt+Up/Down move the selected chapter within its group (with chapter numbering)
		const moveKey = (item: HTMLElement | null, offset: -1 | 1) => {
			const { file } = parse(item);
			const project = this.getSelectedProject();
			if (!file || !project) return false;
			const groupKey = this.groupKeyByPath.get(file.path);
			if (groupKey === undefined || !isGroupNumbered(this.plugin.settings, groupKey)) return false;
			if (this.isFiltering()) return true; // Neighbors may be hidden; the buttons say why
			void this.moveChapter(file, project, offset);
			return true;
		};
		register(["Alt"], "ArrowUp", (item) => moveKey(item, -1));
		register(["Alt"], "ArrowDown", (item) => moveKey(item, 1));
		register([], "Escape", (item, control) => {
			if (!control || !item) return false;
			this.selectItem(item, true); // Leave the property cell
			return true;
		});

		// Space acts on the row's property (no global hotkey uses it, so a listener is enough)
		this.tableContainer.addEventListener("keydown", (evt) => {
			if (evt.key !== " " || evt.ctrlKey || evt.metaKey || evt.altKey) return;
			const target = this.getKeyTarget(evt);
			if (!target?.item?.dataset.navId?.startsWith("row:")) return;
			const control =
				target.control ?? target.item.querySelector<HTMLElement>(PROPERTY_CONTROL);
			if (!control) return;
			evt.preventDefault(); // No scrolling, no native toggle on top of ours
			this.activatePropertyControl(control);
		});
	}

	// What a key acts on: the selected item, plus the property control if it has focus
	private getKeyTarget(
		evt: KeyboardEvent,
	): { item: HTMLElement | null; control: HTMLElement | null } | null {
		if (!this.plugin.settings.keyboardNavigation || evt.isComposing) return null;
		const active = activeDocument.activeElement;
		if (!(active instanceof HTMLElement) || !this.tableContainer.contains(active)) return null;
		const control = active.matches(PROPERTY_CONTROL) ? active : null;
		if (!control && active.matches("select, input, textarea")) return null; // Some other field
		return { item: active.closest<HTMLElement>("[data-nav-id]"), control };
	}

	// Opens the property dropdown's list, or toggles the checkbox
	private activatePropertyControl(control: HTMLElement): void {
		control.focus();
		if (control.instanceOf(HTMLSelectElement)) {
			try {
				control.showPicker(); // Pick with the arrows, confirm with Enter
			} catch {
				// Not supported: the focused dropdown still opens with Alt+Down
			}
		} else if (control.instanceOf(HTMLInputElement)) {
			control.click(); // Fires change, like a mouse click
		}
	}

	// Visible group headers and rows, in order (rows in collapsed groups are hidden)
	private getNavItems(): HTMLElement[] {
		return Array.from(
			this.tableContainer.querySelectorAll<HTMLElement>("[data-nav-id]"),
		).filter((el) => el.isShown());
	}

	private getSelectedItem(): HTMLElement | null {
		if (!this.selectedId) return null;
		return (
			this.getNavItems().find((el) => el.dataset.navId === this.selectedId) ?? null
		);
	}

	// Marks an item as selected; optionally focuses it and scrolls it into view
	private selectItem(item: HTMLElement, focus: boolean): void {
		this.tableContainer
			.querySelectorAll(".is-selected")
			.forEach((el) => el.removeClass("is-selected"));
		item.addClass("is-selected");
		this.selectedId = item.dataset.navId ?? null;
		if (focus) {
			item.focus({ preventScroll: true });
			item.scrollIntoView({ block: "nearest" }); // Rows keep clear of the sticky headers
		}
	}

	// Moves the selection by a step, or to the first or last item
	// Returns whether there was anything to select
	private moveSelection(from: HTMLElement | null, step: number | "first" | "last"): boolean {
		const items = this.getNavItems();
		if (items.length === 0) return false;
		let target: HTMLElement | undefined;
		if (step === "first") target = items[0];
		else if (step === "last") target = items[items.length - 1];
		else if (!from) target = items[0];
		else {
			const index = items.indexOf(from) + step;
			target = items[Math.max(0, Math.min(items.length - 1, index))];
		}
		if (target) this.selectItem(target, true);
		return !!target;
	}

	// After a redraw: the same item, or the one now at its position (after a delete or move)
	private restoreSelection(hadFocus: boolean, previousIndex: number): void {
		if (!this.plugin.settings.keyboardNavigation) {
			if (hadFocus) this.tableContainer.focus({ preventScroll: true });
			return;
		}
		const items = this.getNavItems();
		const item =
			this.getSelectedItem() ??
			(previousIndex >= 0 && items.length > 0
				? items[Math.min(previousIndex, items.length - 1)]
				: undefined);
		if (item) this.selectItem(item, hadFocus);
		else if (hadFocus) this.tableContainer.focus({ preventScroll: true });
	}

	// Focuses the table: the selected item, else the open chapter, else the first item
	focusTable(): void {
		if (!this.plugin.settings.keyboardNavigation) {
			this.tableContainer.focus();
			return;
		}
		const activePath = this.app.workspace.getActiveFile()?.path;
		const activeRow = activePath ? this.rowsByPath.get(activePath) : undefined;
		const activeKey = activePath ? this.groupKeyByPath.get(activePath) : undefined;
		// A collapsed group hides the open chapter's row, so its header stands in
		const activeItem = activeRow?.isShown()
			? activeRow
			: activeKey !== undefined
				? this.groupHeaderByKey.get(activeKey)
				: undefined;
		const item = this.getSelectedItem() ?? activeItem ?? this.getNavItems()[0];
		if (item) this.selectItem(item, true);
		else this.tableContainer.focus();
	}

	// Collapses or expands a group in place (no redraw)
	private toggleGroup(key: string): void {
		const header = this.groupHeaderByKey.get(key);
		if (!header) return;
		const isCollapsed = !this.collapsedGroups.has(key);
		if (isCollapsed) {
			this.collapsedGroups.add(key);
		} else {
			this.collapsedGroups.delete(key);
		}
		header.toggleClass("collapsed", isCollapsed);
		const iconEl = header.querySelector<HTMLElement>(".group-toggle-icon");
		if (iconEl) setIcon(iconEl, isCollapsed ? "chevron-right" : "chevron-down");
		const rows = this.rowsByGroupKey.get(key) ?? [];
		rows.forEach((row) => row.toggle(!isCollapsed));

		// A selected row that just got hidden hands the selection to its header
		const selected = this.getSelectedItem();
		if (isCollapsed && selected && (rows as HTMLElement[]).includes(selected)) {
			this.selectItem(header, this.tableContainer.contains(activeDocument.activeElement));
		}
		this.updateToggleGroupsButton();
		this.highlightActiveChapter(false); // Moves between the row and its group header
	}

	// A group's folder, or null for "Other" (the project folder) or a missing folder
	private getGroupFolder(groupKey: string, project: NovelProject): TFolder | null {
		if (groupKey === OTHER_GROUP_KEY) return null;
		const folder = this.app.vault.getAbstractFileByPath(getGroupFolderPath(project, groupKey));
		return folder instanceof TFolder ? folder : null;
	}

	// Asks for a new folder name; the group keeps its collapsed state and selection
	private renameGroupFolder(folder: TFolder, project: NovelProject): void {
		promptAndRenameChapterFolder(this.app, this.plugin.settings, project, folder, (oldName, newName) => {
			if (this.collapsedGroups.delete(oldName)) this.collapsedGroups.add(newName);
			if (this.selectedId === `group:${oldName}`) this.selectedId = `group:${newName}`;
		});
	}

	// Right-click menu on a chapter row: open, rename, delete, move
	private showChapterMenu(file: TFile, project: NovelProject, pos: MenuPositionDef): void {
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
					promptAndRenameChapter(this.app, this.plugin.settings, file)
						.catch(console.error); // Prompt the user to rename the chapter
				}),
		);

		// Delete Action
		menu.addItem((item: MenuItem) =>
			item
				.setTitle("Delete")
				.setIcon("trash")
				.onClick(() => {
					promptAndDeleteChapter(this.app, this.plugin.settings, file)
						.catch(console.error); // Prompt the user to confirm deletion of the chapter
				}),
		);

		// Numbering: leave the chapter out (it keeps its place) or number it again
		if (isGroupNumbered(this.plugin.settings, getChapterGroupKey(file, project.path))) {
			const { excluded } = readNumberingMarker(this.app, file);
			menu.addItem((item: MenuItem) =>
				item
					.setTitle(excluded ? "Number this chapter" : "Leave out of numbering")
					.setIcon(excluded ? "list-ordered" : "list")
					.onClick(() => {
						promptAndSetChapterExcluded(this.app, this.plugin.settings, project, file, !excluded);
					}),
			);
		}

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
							project,
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
									moveChapterToFolder(
										this.app,
										this.plugin.settings,
										project,
										file,
										option.path,
									).catch(console.error);
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
									project,
									file,
								);
							});
					});

					// Show the submenu where the menu was opened
					folderMenu.showAtPosition(pos);
				});
		});

		menu.showAtPosition(pos);
	}

	// Where to open a menu: at the pointer, or below the item when opened from the keyboard
	private menuPosition(ev: MouseEvent, el: HTMLElement): MenuPositionDef {
		if (ev.button === 2) return { x: ev.clientX, y: ev.clientY };
		const rect = el.getBoundingClientRect();
		return { x: rect.left + 16, y: rect.bottom };
	}

	// Right-click menu on a group header: new chapter here, rename folder, collapse others
	private showGroupMenu(pos: MenuPositionDef, groupKey: string, project: NovelProject): void {
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
			const folder = this.getGroupFolder(groupKey, project);
			if (!folder) {
				item.setDisabled(true);
				return;
			}
			item.onClick(() => this.renameGroupFolder(folder, project));
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

		menu.showAtPosition(pos);
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
