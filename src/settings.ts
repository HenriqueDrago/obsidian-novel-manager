// Settings data: types, defaults and the repair logic used when loading.
import { PROPERTY_TYPE_SETTINGS, PropertyTypeSetting } from "./core/property";
import { generateId } from "./core/utils";
import { FRAGMENT_SORTS, FragmentSort } from "./core/chapters";

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
	chapterTemplatePath: string; // Path to the chapter template file
	otherGroupName: string; // Name for the "Other" group
	excludeOtherFromCount: boolean; // Whether to exclude "Other" from total count
	followActiveChapter: boolean; // Switch the view to the project of the file you open
	dragToMove: boolean; // Drag chapter rows onto another group to move them (desktop)
	revealInFileMenu: boolean; // "Reveal in Novel Manager" in Obsidian's file menus
	keyboardNavigation: boolean; // Arrow keys, Enter, F2, Delete in the chapter table
}

// Define the default settings
export const DEFAULT_SETTINGS: NovelChapterPluginSettings = {
	novelProjects: [
		{
			id: `default-${Date.now()}`,
			name: "My First Novel",
			path: "Novel/Chapters",
		},
	], // Default to one example novel project
	enableFragments: false,
	showProperty: true,
	propertyNameToChange: "status", // Default property to change
	propertyColumnHeader: "", // Default to empty, will use propertyNameToChange if empty
	propertyOptions: "To Do, Done, In Progress", // Default options for the dropdown
	propertyType: "auto", // Each option's syntax decides its type
	looseMatching: true, // 3 matches "3" by default
	chapterTemplatePath: "", // Default to no template
	otherGroupName: "Other", // Default name for the "Other" group
	excludeOtherFromCount: false, // Default to including "Other" in counts
	followActiveChapter: false,
	dragToMove: true,
	revealInFileMenu: true,
	keyboardNavigation: false,
};

// Settings plus internal state that isn't shown in the settings tab
export interface InternalNovelChapterPluginSettings extends NovelChapterPluginSettings {
	lastSelectedNovelId: string | null;
	fragmentSort: FragmentSort; // Order of the fragments feed (chosen in the view)
}

// Default settings with internal properties
export const DEFAULT_INTERNAL_SETTINGS: InternalNovelChapterPluginSettings = {
	...DEFAULT_SETTINGS, // Spread the external default settings (includes the example project)
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
	if (typeof settings.followActiveChapter !== "boolean") {
		settings.followActiveChapter = false;
	}
	if (typeof settings.dragToMove !== "boolean") {
		settings.dragToMove = true;
	}
	if (typeof settings.revealInFileMenu !== "boolean") {
		settings.revealInFileMenu = true;
	}
	if (typeof settings.keyboardNavigation !== "boolean") {
		settings.keyboardNavigation = false;
	}
	if (!FRAGMENT_SORTS.includes(settings.fragmentSort)) {
		settings.fragmentSort = "newest";
	}
	if (
		!Array.isArray(settings.novelProjects) ||
		settings.novelProjects.length === 0
	) {
		settings.novelProjects = [
			{
				id: generateId(),
				name: "Default Novel",
				path: "",
			},
		];
	}
	settings.novelProjects = settings.novelProjects.map(
		(p: Partial<NovelProject>): NovelProject => ({
			id: p.id || generateId(), // Unique even when several projects are repaired at once
			name: p.name || "Unnamed Novel",
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
