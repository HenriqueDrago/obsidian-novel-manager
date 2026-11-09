// The plugin's settings screen.
import {
	App,
	DropdownComponent,
	normalizePath,
	PluginSettingTab,
	Setting,
	TextComponent,
	TFile,
	TFolder,
} from "obsidian";
import type NovelChapterPlugin from "../main";
import { DEFAULT_SETTINGS } from "../settings";
import { generateId } from "../core/utils";
import { buildOptions, OptionProgressText, PropertyTypeSetting } from "../core/property";
import {
	DEFAULT_WORDS_PER_PAGE,
	WordCountFormat,
	WordCountGranularity,
	WordCountUnit,
} from "../core/wordCount";
import { ConfirmationModal } from "./ConfirmationModal";
import { FileSuggest, FolderSuggest } from "./suggest";

// Builds a setting description with one line per entry
function descriptionLines(lines: string[]): DocumentFragment {
	return createFragment((frag) => {
		for (const line of lines) frag.createDiv({ text: line });
	});
}

// Create a setting tab for the plugin
export class NovelChapterPluginSettingsTab extends PluginSettingTab {
	plugin: NovelChapterPlugin;

	// Initialize with the app and plugin instance
	constructor(app: App, plugin: NovelChapterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Flush any pending debounced save when the settings tab closes
	hide(): void {
		this.plugin.saveSettingsDebounced.run();
	}

	// Display the settings UI
	display(): void {
		const { containerEl } = this; // Get the container element
		containerEl.empty(); // Clear existing content

		// ====== Chapters ======
		new Setting(containerEl).setName("Chapters").setHeading();

		// Create setting for specifying the chapter template file path
		const templateSetting = new Setting(containerEl)
			.setName("Chapter template file path")
			.setDesc(
				'Path to a markdown file to use as a template for new chapters (e.g., "Templates/ChapterTemplate.md"). Leave empty to not use a template. Placeholders like {{title}} and {{date}} can be used in the template.'
			);
		const updateTemplateNote = this.addPathNote(templateSetting.descEl, "file", "File");
		templateSetting.addText((text) => {
			text
				.setPlaceholder(
					DEFAULT_SETTINGS.chapterTemplatePath ||
						"e.g., Templates/ChapterTemplate.md"
				)
				.setValue(this.plugin.settings.chapterTemplatePath)
				.onChange((value) => {
					this.plugin.settings.chapterTemplatePath = value.trim();
					updateTemplateNote(value);
					this.plugin.saveSettingsDebounced(); // Debounced: saves and refreshes views once typing pauses
				});
			new FileSuggest(this.app, text.inputEl);
		});
		updateTemplateNote(this.plugin.settings.chapterTemplatePath);

		// Create setting for naming the "Other" group
		new Setting(containerEl)
			.setName('Name for "other" group')
			.setDesc(
				"Set a custom name for the group containing chapters not in a subfolder."
			)
			.addText((text) =>
				text
					.setPlaceholder("Other")
					.setValue(this.plugin.settings.otherGroupName)
					.onChange((value) => {
						this.plugin.settings.otherGroupName = value || "Other";
						this.plugin.saveSettingsDebounced(); // Debounced: saves and refreshes views once typing pauses
					})
			);

		// Create setting for excluding the "Other" group from total chapter count
		new Setting(containerEl)
			.setName('Exclude "other" group from total count')
			.setDesc(
				"If enabled, chapters in this group will not be included in the total chapter count at the top of the view."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.excludeOtherFromCount)
					.onChange(async (value) => {
						this.plugin.settings.excludeOtherFromCount = value;
						await this.plugin.saveSettings();
					})
			);

		// ====== Chapter list ======
		new Setting(containerEl).setName("Chapter list").setHeading();

		// Create setting for following the open chapter's project
		new Setting(containerEl)
			.setName("Follow the open chapter")
			.setDesc("Switch the view to a chapter's project when you open it.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.followActiveChapter)
					.onChange(async (value) => {
						this.plugin.settings.followActiveChapter = value;
						await this.plugin.saveSettings();
					})
			);

		// Create setting for keyboard navigation in the chapter table
		new Setting(containerEl)
			.setName("Keyboard navigation")
			.setDesc(
				"Move through the chapter list with the arrow keys. Enter opens a chapter, space changes its property, F2 renames, the delete key deletes, and left and right collapse or expand groups or step into the property cell."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.keyboardNavigation)
					.onChange(async (value) => {
						this.plugin.settings.keyboardNavigation = value;
						await this.plugin.saveSettings(); // Redraws the table with or without focus support
					})
			);

		// Create setting for moving chapters by dragging them onto a group
		new Setting(containerEl)
			.setName("Drag chapters between folders")
			.setDesc(
				"Drag a chapter onto another group to move it there. Desktop only; the row menu's move option always works."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.dragToMove)
					.onChange(async (value) => {
						this.plugin.settings.dragToMove = value;
						await this.plugin.saveSettings();
					})
			);

		// Create setting for the reveal option in Obsidian's file menus
		new Setting(containerEl)
			.setName("Reveal option in file menus")
			.setDesc(
				"Add a reveal option to a chapter's menu in the file explorer and tab header."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.revealInFileMenu)
					.onChange(async (value) => {
						this.plugin.settings.revealInFileMenu = value;
						await this.plugin.saveSettings(false); // Read when a menu opens; nothing to redraw
					})
			);

		// ====== Word counts ======
		new Setting(containerEl).setName("Word counts").setHeading();

		// Create settings for word counts (the rest only matter while they're on)
		const wordCountControls: (DropdownComponent | TextComponent)[] = [];
		let wordsPerPageInput: TextComponent | null = null; // Only matters for the pages unit
		const updateWordCountControls = () => {
			const { showWordCounts, wordCountUnit } = this.plugin.settings;
			for (const control of wordCountControls) control.setDisabled(!showWordCounts);
			wordsPerPageInput?.setDisabled(!showWordCounts || wordCountUnit !== "pages");
		};
		new Setting(containerEl)
			.setName("Show word counts")
			.setDesc("Count the words, characters or pages of each chapter. Reads chapter files, so it's off by default.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showWordCounts)
					.onChange(async (value) => {
						this.plugin.settings.showWordCounts = value;
						updateWordCountControls();
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("Count")
			.setDesc("What to count. Characters leave out markdown and count spaces between words.")
			.addDropdown((dropdown) => {
				wordCountControls.push(dropdown);
				dropdown
					.addOptions({
						words: "Words",
						characters: "Characters",
						pages: "Pages",
					})
					.setValue(this.plugin.settings.wordCountUnit)
					.onChange(async (value) => {
						this.plugin.settings.wordCountUnit = value as WordCountUnit;
						updateWordCountControls();
						await this.plugin.saveSettings();
					});
			});
		new Setting(containerEl)
			.setName("Words per page")
			.setDesc("How many words make a page, for counting pages.")
			.addText((text) => {
				wordsPerPageInput = text;
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text
					.setPlaceholder(String(DEFAULT_WORDS_PER_PAGE))
					.setValue(String(this.plugin.settings.wordsPerPage))
					.onChange((value) => {
						const wordsPerPage = Number(value);
						// Ignore empty or invalid input until it's a positive number
						if (!Number.isFinite(wordsPerPage) || wordsPerPage <= 0) return;
						this.plugin.settings.wordsPerPage = wordsPerPage;
						this.plugin.saveSettingsDebounced();
					});
			});
		new Setting(containerEl)
			.setName("Word count detail")
			.setDesc("Where word counts show. Group and project totals always show.")
			.addDropdown((dropdown) => {
				wordCountControls.push(dropdown);
				dropdown
					.addOptions({
						chapters: "Chapters, groups and total",
						groups: "Groups and total only",
					})
					.setValue(this.plugin.settings.wordCountGranularity)
					.onChange(async (value) => {
						this.plugin.settings.wordCountGranularity = value as WordCountGranularity;
						await this.plugin.saveSettings();
					});
			});
		new Setting(containerEl)
			.setName("Word count format")
			.setDesc("Short numbers are rounded; hover one for the exact count. Pages always show one decimal.")
			.addDropdown((dropdown) => {
				wordCountControls.push(dropdown);
				dropdown
					.addOptions({
						short: "Short (3.9K)",
						exact: "Exact (3,912)",
					})
					.setValue(this.plugin.settings.wordCountFormat)
					.onChange(async (value) => {
						this.plugin.settings.wordCountFormat = value as WordCountFormat;
						await this.plugin.saveSettings();
					});
			});
		new Setting(containerEl)
			.setName("Start counting after")
			.setDesc(
				"Only count the words after the first occurrence of this text in a chapter (e.g., a heading or a line like %%start%%). Chapters without it are counted whole. Leave empty to count everything."
			)
			.addText((text) => {
				wordCountControls.push(text);
				text
					.setPlaceholder("E.g., %%start%%")
					.setValue(this.plugin.settings.wordCountStartMarker)
					.onChange((value) => {
						// Not trimmed: spaces or line breaks can be part of the marker
						this.plugin.settings.wordCountStartMarker = value;
						this.plugin.saveSettingsDebounced(); // Counts are cached per marker, so this recounts
					});
			});

		updateWordCountControls(); // Initial disabled state

		// ====== Property column ======
		new Setting(containerEl).setName("Property column").setHeading();

		// Create setting for showing the frontmatter property column and settings
		new Setting(containerEl)
			.setName('Show target property column')
			.setDesc(
				"If enabled, shows an extra column with a target property you can change."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showProperty)
					.onChange(async (value) => {
						this.plugin.settings.showProperty = value;
						await this.plugin.saveSettings(); // Save settings (also refreshes the view)
						this.renderPropertySettings(propertySettingsContainer); // Refresh the settings
					})
			);

		const propertySettingsContainer = containerEl.createDiv({
			cls: "property-settings-container",
		});
		this.renderPropertySettings(propertySettingsContainer);

		// ====== Fragments ======
		new Setting(containerEl).setName("Fragments").setHeading();

		// Create setting for enabling fragments in the plugin
		new Setting(containerEl)
			.setName("Enable fragments")
			.setDesc("Enable a separate section for managing scene fragments and random ideas.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableFragments)
					.onChange(async (value) => {
						this.plugin.settings.enableFragments = value;
						await this.plugin.saveSettings();
						this.display(); // Re-render to show/hide each project's fragments folder
					})
			);

		// ====== Novel projects ======
		new Setting(containerEl).setName("Novel projects").setHeading();

		const novelProjectsContainer = containerEl.createDiv({
			cls: "novel-projects-container",
		});
		this.renderNovelProjects(novelProjectsContainer);

		// Button to add a new novel project
		new Setting(containerEl)
			.setName("Add new novel project")
			.setDesc("Add a new novel to track.")
			.addButton((button) =>
				button
					.setButtonText("Add novel")
					.setCta()
					.onClick(async () => {
						// Add a new novel project with a unique ID and default name
						this.plugin.settings.novelProjects.push({
							id: generateId(),
							name: `New Novel ${
								this.plugin.settings.novelProjects.length + 1
							}`,
							path: "",
							fragmentsPath: "",
						});
						await this.plugin.saveSettings();
						this.renderNovelProjects(novelProjectsContainer); // Re-render the list
					})
			);
	}

	// Adds a note line to an element; returns a function that updates it for a path value
	private addPathNote(
		parentEl: HTMLElement,
		kind: "folder" | "file",
		label: string,
	): (value: string) => void {
		// Missing folders are created when needed (neutral note); a missing template is a real problem
		const noteEl = parentEl.createDiv({
			cls: kind === "file" ? "mod-warning" : "novel-path-note",
		});
		return (value: string) => {
			const trimmed = value.trim();
			const found = trimmed
				? this.app.vault.getAbstractFileByPath(normalizePath(trimmed))
				: null;
			const missing =
				trimmed !== "" &&
				!(kind === "file" ? found instanceof TFile : found instanceof TFolder);
			noteEl.setText(
				!missing
					? ""
					: kind === "file"
						? `${label} not found.`
						: `${label} doesn't exist yet; it will be created when needed.`,
			);
			noteEl.toggle(missing);
		};
	}

	private renderPropertySettings(containerEl: HTMLElement): void {
		containerEl.empty(); // Clear existing content

		// Only show the property settings when the property column is enabled
		if (!this.plugin.settings.showProperty) return;

		const settings = this.plugin.settings;
		const isCheckbox = settings.propertyType === "checkbox";

		// Create setting for selecting the frontmatter property to change
		new Setting(containerEl)
			.setName("Target property name")
			.setDesc(
				'The actual frontmatter key to update (e.g., "status", "outlinelevel"). This is case-sensitive.'
			)
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.propertyNameToChange)
					.setValue(settings.propertyNameToChange)
					.onChange((value) => {
						settings.propertyNameToChange = value.trim(); // Trim whitespace
						this.plugin.saveSettingsDebounced(); // Debounced: saves and refreshes views once typing pauses
					})
			);

		// Create setting for customizing the property column header display name
		new Setting(containerEl)
			.setName("Property column header display name")
			.setDesc(
				'What title to display for the property column in the view (e.g., "current status"). If empty, it will use the "target property name".'
			)
			.addText((text) =>
				text
					.setPlaceholder("E.g., status (optional)")
					.setValue(settings.propertyColumnHeader)
					.onChange((value) => {
						settings.propertyColumnHeader = value.trim(); // Trim whitespace
						this.plugin.saveSettingsDebounced(); // Debounced: saves and refreshes views once typing pauses
					})
			);

		// Create setting for the type the property is saved as
		const typeSetting = new Setting(containerEl)
			.setName("Property type")
			.setDesc(
				descriptionLines([
					"How the chosen option is saved in frontmatter.",
					"Auto: each option keeps the type it's written as (see property options).",
					"Text: options are saved exactly as typed, quotes included.",
					"Number: options are saved as numbers where possible.",
					"Checkbox: a checkbox replaces the dropdown; options are ignored.",
				])
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						auto: "Auto",
						text: "Text",
						number: "Number",
						checkbox: "Checkbox",
					})
					.setValue(settings.propertyType)
					.onChange(async (value) => {
						settings.propertyType = value as PropertyTypeSetting;
						await this.plugin.saveSettings();
						this.renderPropertySettings(containerEl); // Update disabled state and warning
					})
			);

		// Warning under the type setting listing options that can't be numbers (Number only)
		const warningEl = typeSetting.descEl.createDiv({ cls: "mod-warning" });
		const updateWarning = () => {
			const { unconvertible } = buildOptions(settings);
			const show = settings.propertyType === "number" && unconvertible.length > 0;
			warningEl.setText(
				show
					? `Can't be saved as number, kept as written: ${unconvertible.join(", ")}`
					: ""
			);
			warningEl.toggle(show);
		};
		updateWarning();

		// Create setting for defining the dropdown options
		const optionsDescription = [
			"Comma-separated options for the dropdown, written like frontmatter: 3 is a number, true/false a checkbox value, \"3\" text.",
			"Commas inside quotes don't split (e.g., \"Act 1, part 2\").",
		];
		if (isCheckbox) {
			optionsDescription.push("Ignored while property type is checkbox.");
		}
		new Setting(containerEl)
			.setName("Property options")
			.setDesc(descriptionLines(optionsDescription))
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.propertyOptions)
					.setValue(settings.propertyOptions)
					.setDisabled(isCheckbox) // Kept, but unused, while the type is checkbox
					.onChange((value) => {
						settings.propertyOptions = value;
						updateWarning(); // Only the warning, so the input keeps focus
						this.plugin.saveSettingsDebounced(); // Debounced: saves and refreshes views once typing pauses
					})
			);

		// Create setting for loose matching
		new Setting(containerEl)
			.setName("Loose matching")
			.setDesc(
				descriptionLines([
					'On: 3 and "3" match the same option, and "true" ticks a checkbox.',
					"Off: the value's type must match the option's type too.",
				])
			)
			.addToggle((toggle) =>
				toggle
					.setValue(settings.looseMatching)
					.onChange(async (value) => {
						settings.looseMatching = value;
						await this.plugin.saveSettings();
					})
			);

		// Progress summaries on group headers (only with the property column)
		new Setting(containerEl).setName("Progress").setHeading();
		new Setting(containerEl)
			.setName("Show checkbox progress")
			.setDesc("Show how many chapters are checked on each group header (checkbox type).")
			.addToggle((toggle) =>
				toggle
					.setValue(settings.checkboxProgress)
					.onChange(async (value) => {
						settings.checkboxProgress = value;
						await this.plugin.saveSettings();
					})
			);
		new Setting(containerEl)
			.setName("Show option progress")
			.setDesc("Show a bar of how many chapters have each option on each group header.")
			.addToggle((toggle) =>
				toggle
					.setValue(settings.optionProgress)
					.onChange(async (value) => {
						settings.optionProgress = value;
						await this.plugin.saveSettings();
						this.renderPropertySettings(containerEl); // Update the text setting's disabled state
					})
			);
		new Setting(containerEl)
			.setName("Option progress text")
			.setDesc("What to write next to the option bar. The tooltip always has the full breakdown.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						last: "Last option",
						none: "Bar only",
						all: "All options",
					})
					.setValue(settings.optionProgressText)
					.setDisabled(!settings.optionProgress)
					.onChange(async (value) => {
						settings.optionProgressText = value as OptionProgressText;
						await this.plugin.saveSettings();
					})
			);
	}



	// Renders the list of novel projects
	private renderNovelProjects(containerEl: HTMLElement): void {
		containerEl.empty(); // Clear existing content

		const projects = this.plugin.settings.novelProjects;

		// If no projects, show a message
		if (projects.length === 0) {
			containerEl.createEl("p", {
				text: "No novel projects configured. Add one below.",
			});
		}

		// Moves a project up or down in the list (the order the view's dropdown uses)
		const moveProject = async (index: number, offset: number) => {
			const target = index + offset;
			if (target < 0 || target >= projects.length) return;
			[projects[index], projects[target]] = [projects[target], projects[index]];
			await this.plugin.saveSettings();
			this.renderNovelProjects(containerEl);
		};

		// Render each novel project with its settings
		projects.forEach((project, index) => {
			const projectSetting = new Setting(containerEl).setName(`Novel ${index + 1}`);

			// Description: "Configuration for …" plus one note per missing folder
			const configEl = projectSetting.descEl.createDiv();
			const updateConfigText = () =>
				configEl.setText(`Configuration for ${project.name || "this novel"}.`);
			updateConfigText();
			const updatePathNote = this.addPathNote(projectSetting.descEl, "folder", "Chapters folder");
			const updateFragmentsNote = this.addPathNote(projectSetting.descEl, "folder", "Fragments folder");

			// Vertical stack of inputs in the control area
			const inputStack = projectSetting.controlEl.createDiv({ cls: "novel-project-input-stack" });

			// Novel name
			new TextComponent(inputStack)
				.setPlaceholder("Novel name (e.g., my epic saga)")
				.setValue(project.name)
				.onChange((value) => {
					project.name = value.trim();
					updateConfigText(); // Only the description, so the input keeps focus
					this.plugin.saveSettingsDebounced(); // Debounced: saves and refreshes views once typing pauses
				});

			// Chapters folder
			let fragmentsText: TextComponent | null = null; // Set below when fragments are enabled
			const pathText = new TextComponent(inputStack)
				.setPlaceholder("Folder path (e.g., novels/my-epic-saga/chapters)")
				.setValue(project.path)
				.onChange((value) => {
					project.path = value.trim();
					updatePathNote(value);
					// The fragments placeholder shows the fallback, which follows this path
					fragmentsText?.setPlaceholder(this.fragmentsPlaceholder(project.path));
					this.plugin.saveSettingsDebounced(); // Debounced: saves and refreshes views once typing pauses
				});
			new FolderSuggest(this.app, pathText.inputEl);
			updatePathNote(project.path);

			// Fragments folder (only when fragments are enabled)
			if (this.plugin.settings.enableFragments) {
				fragmentsText = new TextComponent(inputStack)
					.setPlaceholder(this.fragmentsPlaceholder(project.path))
					// If empty, the plugin really uses the placeholder path (<chapters path>/Fragments)
					.setValue(project.fragmentsPath || "")
					.onChange((value) => {
						project.fragmentsPath = value.trim();
						updateFragmentsNote(value);
						this.plugin.saveSettingsDebounced(); // Debounced: saves and refreshes views once typing pauses
					});
				new FolderSuggest(this.app, fragmentsText.inputEl);
				updateFragmentsNote(project.fragmentsPath || "");
			} else {
				updateFragmentsNote(""); // Hidden while fragments are off
			}

			// Reorder and remove buttons
			projectSetting
				.addExtraButton((button) =>
					button
						.setIcon("arrow-up")
						.setTooltip("Move up")
						.setDisabled(index === 0)
						.onClick(() => void moveProject(index, -1))
				)
				.addExtraButton((button) =>
					button
						.setIcon("arrow-down")
						.setTooltip("Move down")
						.setDisabled(index === projects.length - 1)
						.onClick(() => void moveProject(index, 1))
				)
				.addExtraButton((button) =>
					button
						.setIcon("trash")
						.setTooltip("Remove this novel project")
						// Confirm, then remove the project (its files stay in the vault)
						.onClick(() => {
							new ConfirmationModal(
								this.app,
								`Remove the project "${project.name || "Unnamed Novel"}"? Its files stay in your vault.`,
								() => {
									void (async () => {
										projects.splice(index, 1);
										await this.plugin.saveSettings();
										this.renderNovelProjects(containerEl); // Re-render the list
									})();
								},
							).open();
						})
				);
		});
	}

	// Placeholder for the fragments folder: the fallback path the plugin uses when it's empty
	private fragmentsPlaceholder(chaptersPath: string): string {
		return chaptersPath ? `${chaptersPath}/Fragments` : "Fragments folder (e.g., novels/my-epic-saga/fragments)";
	}
}
