// Settings data: types, defaults and the repair logic used when loading.
import {
	OPTION_PROGRESS_TEXTS,
	OptionProgressText,
	PROPERTY_TYPE_SETTINGS,
	PropertyTypeSetting,
} from "./core/property";
import { generateId } from "./core/utils";
import {
	DEFAULT_WORDS_PER_PAGE,
	WORD_COUNT_FORMATS,
	WORD_COUNT_GRANULARITIES,
	WORD_COUNT_UNITS,
	WordCountFormat,
	WordCountGranularity,
	WordCountUnit,
} from "./core/wordCount";
import { FRAGMENT_SORTS, FragmentSort } from "./core/chapters";
import { DEFAULT_NUMBER_FORMAT, NumberingOptions } from "./core/numbering";

// Interface for a single novel project configuration
export interface NovelProject {
	id: string;
	name: string;
	path: string;
	fragmentsPath?: string; // Optional path for fragments
}

// Define the plugin settings interface
export interface NovelChapterPluginSettings {
	novelProjects: NovelProject[]; // Array of novel projects
	enableFragments: boolean; // Toggle for the fragments portion of the plugin
	showProperty: boolean; // Wheter to show the property column or not
	propertyNameToChange: string; // The frontmatter property to change
	propertyColumnHeader: string; // Display name for the property column
	propertyOptions: string; // Comma-separated options for the dropdown
	propertyType: PropertyTypeSetting; // Type the chosen option is saved as ("auto" = from the option's syntax)
	looseMatching: boolean; // Whether 3 matches "3" and "true" matches true
	checkboxProgress: boolean; // Checked count on group headers (checkbox type)
	optionProgress: boolean; // Bar of option counts on group headers (other types)
	optionProgressText: OptionProgressText; // Text next to the option bar
	chapterTemplatePath: string; // Path to the chapter template file
	otherGroupName: string; // Name for the "Other" group
	excludeOtherFromCount: boolean; // Whether to exclude "Other" from total count
	followActiveChapter: boolean; // Switch the view to the project of the file you open
	dragToMove: boolean; // Drag chapter rows onto another group to move them (desktop)
	revealInFileMenu: boolean; // "Reveal in Novel Manager" in Obsidian's file menus
	showRibbonIcon: boolean; // The ribbon icon that opens the view
	keyboardNavigation: boolean; // Arrow keys, Enter, F2, Delete in the chapter table
	showChapterCount: boolean; // "24 chapters" on the project and group stats lines
	showWordCounts: boolean; // Word counts in the table (reads chapter files)
	wordCountGranularity: WordCountGranularity; // Chapters and headers, headers only, or chapters only
	wordCountFormat: WordCountFormat; // "3.9K" or "3,912"
	wordCountStartMarker: string; // Count only after the first occurrence of this text ("" = all)
	wordCountUnits: WordCountUnit[]; // Any of words, characters, pages (words / wordsPerPage), in that order
	wordsPerPage: number; // Words in a page, for the pages unit
	autoNumbering: boolean; // Keep chapter names numbered (the values below are the applied ones)
	numberFormat: string; // E.g. "Chapter {number} - {title}"
	numberDigits: number; // Minimum digits (2: 1 -> 01), at least 1
	numberPerFolder: boolean; // Restart at 1 in each folder, else count through the project
	numberSkipOther: boolean; // Leave chapters directly in the project folder unnumbered
}

// Define the default settings
export const DEFAULT_SETTINGS: NovelChapterPluginSettings = {
	novelProjects: [], // None until the user adds one (the view offers "New project")
	enableFragments: false,
	showProperty: true,
	propertyNameToChange: "status", // Default property to change
	propertyColumnHeader: "", // Default to empty, will use propertyNameToChange if empty
	propertyOptions: "To Do, Done, In Progress", // Default options for the dropdown
	propertyType: "auto", // Each option's syntax decides its type
	looseMatching: true, // 3 matches "3" by default
	checkboxProgress: true,
	optionProgress: true,
	optionProgressText: "last",
	chapterTemplatePath: "", // Default to no template
	otherGroupName: "Other", // Default name for the "Other" group
	excludeOtherFromCount: false, // Default to including "Other" in counts
	followActiveChapter: false,
	dragToMove: true,
	revealInFileMenu: true,
	showRibbonIcon: true,
	keyboardNavigation: false,
	showChapterCount: true,
	showWordCounts: false,
	wordCountGranularity: "chapters",
	wordCountFormat: "short",
	wordCountStartMarker: "",
	wordCountUnits: ["words"],
	wordsPerPage: DEFAULT_WORDS_PER_PAGE,
	autoNumbering: false,
	numberFormat: DEFAULT_NUMBER_FORMAT,
	numberDigits: 1,
	numberPerFolder: false,
	numberSkipOther: true,
};

// Settings plus internal state that isn't shown in the settings tab
export interface InternalNovelChapterPluginSettings extends NovelChapterPluginSettings {
	lastSelectedNovelId: string | null;
	fragmentSort: FragmentSort; // Order of the fragments feed (chosen in the view)
}

// Default settings with internal properties
export const DEFAULT_INTERNAL_SETTINGS: InternalNovelChapterPluginSettings = {
	...DEFAULT_SETTINGS, // Spread the external default settings
	lastSelectedNovelId: null, // Initialize last selected novel ID to null
	fragmentSort: "newest",
};

// Fills in defaults for loaded settings and repairs invalid values
export function normalizeSettings(
	loadedSettings: Partial<InternalNovelChapterPluginSettings> | null,
): InternalNovelChapterPluginSettings {
	const settings: InternalNovelChapterPluginSettings = Object.assign(
		{},
		DEFAULT_INTERNAL_SETTINGS,
		loadedSettings,
	);

	// Unknown property types (e.g. the removed "list") fall back to auto
	if (
		!(PROPERTY_TYPE_SETTINGS as readonly string[]).includes(
			settings.propertyType,
		)
	) {
		settings.propertyType = "auto";
	}
	if (typeof settings.looseMatching !== "boolean") {
		settings.looseMatching = true;
	}
	if (typeof settings.checkboxProgress !== "boolean") {
		settings.checkboxProgress = true;
	}
	if (typeof settings.optionProgress !== "boolean") {
		settings.optionProgress = true;
	}
	if (!OPTION_PROGRESS_TEXTS.includes(settings.optionProgressText)) {
		settings.optionProgressText = "last";
	}
	if (typeof settings.followActiveChapter !== "boolean") {
		settings.followActiveChapter = false;
	}
	if (typeof settings.dragToMove !== "boolean") {
		settings.dragToMove = true;
	}
	if (typeof settings.revealInFileMenu !== "boolean") {
		settings.revealInFileMenu = true;
	}
	if (typeof settings.showRibbonIcon !== "boolean") {
		settings.showRibbonIcon = true;
	}
	if (typeof settings.keyboardNavigation !== "boolean") {
		settings.keyboardNavigation = false;
	}
	if (typeof settings.showWordCounts !== "boolean") {
		settings.showWordCounts = false;
	}
	if (!WORD_COUNT_GRANULARITIES.includes(settings.wordCountGranularity)) {
		settings.wordCountGranularity = "chapters";
	}
	if (!WORD_COUNT_FORMATS.includes(settings.wordCountFormat)) {
		settings.wordCountFormat = "short";
	}
	if (typeof settings.wordCountStartMarker !== "string") {
		settings.wordCountStartMarker = "";
	}
	// From the old single unit (wordCountUnit) to a list; keeps only valid units, in display order
	const legacy = settings as { wordCountUnit?: unknown };
	if (!Array.isArray(settings.wordCountUnits)) {
		settings.wordCountUnits = WORD_COUNT_UNITS.includes(legacy.wordCountUnit as WordCountUnit)
			? [legacy.wordCountUnit as WordCountUnit]
			: ["words"];
	}
	delete legacy.wordCountUnit;
	settings.wordCountUnits = WORD_COUNT_UNITS.filter((unit) => settings.wordCountUnits.includes(unit));
	if (typeof settings.showChapterCount !== "boolean") {
		settings.showChapterCount = true;
	}
	if (
		typeof settings.wordsPerPage !== "number" ||
		!Number.isFinite(settings.wordsPerPage) ||
		settings.wordsPerPage <= 0
	) {
		settings.wordsPerPage = DEFAULT_WORDS_PER_PAGE;
	}
	if (typeof settings.autoNumbering !== "boolean") {
		settings.autoNumbering = false;
	}
	if (typeof settings.numberFormat !== "string" || !settings.numberFormat.includes("{number}")) {
		settings.numberFormat = DEFAULT_NUMBER_FORMAT;
	}
	if (!Number.isInteger(settings.numberDigits) || settings.numberDigits < 1) {
		settings.numberDigits = 1;
	}
	if (typeof settings.numberPerFolder !== "boolean") {
		settings.numberPerFolder = false;
	}
	if (typeof settings.numberSkipOther !== "boolean") {
		settings.numberSkipOther = true;
	}
	if (!FRAGMENT_SORTS.includes(settings.fragmentSort)) {
		settings.fragmentSort = "newest";
	}
	// An empty list stays empty (the view shows "No novel projects yet")
	if (!Array.isArray(settings.novelProjects)) settings.novelProjects = [];
	settings.novelProjects = settings.novelProjects.map(
		(p: Partial<NovelProject>): NovelProject => ({
			id: p.id || generateId(), // Unique even when several projects are repaired at once
			name: p.name || "Unnamed novel",
			path: p.path || "",
			fragmentsPath: p.fragmentsPath || "",
		}),
	);

	if (
		settings.lastSelectedNovelId &&
		!settings.novelProjects.find(
			(p) => p.id === settings.lastSelectedNovelId,
		)
	) {
		settings.lastSelectedNovelId =
			settings.novelProjects.length > 0
				? settings.novelProjects[0].id
				: null;
	}
	return settings;
}

// The applied numbering settings, as plan options
export function getNumberingOptions(settings: NovelChapterPluginSettings): NumberingOptions {
	return {
		format: settings.numberFormat,
		digits: settings.numberDigits,
		perFolder: settings.numberPerFolder,
		skipOther: settings.numberSkipOther,
	};
}
