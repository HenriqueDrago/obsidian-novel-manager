// The plugin's settings screen.
import {
	App,
	ButtonComponent,
	PluginSettingTab,
	Setting,
	TextComponent,
} from "obsidian";
import type NovelChapterPlugin from "../main";
import { DEFAULT_SETTINGS, getNumberingOptions } from "../settings";
import { DEFAULT_NUMBER_FORMAT, NumberingOptions, validateFormat } from "../core/numbering";
import { NumberingModal } from "./NumberingModal";
import { generateId } from "../core/utils";
import { buildOptions, OptionProgressText, PropertyTypeSetting } from "../core/property";
import {
	DEFAULT_WORDS_PER_PAGE,
	WordCountFormat,
	WordCountGranularity,
	WordCountUnit,
} from "../core/wordCount";
import { ConfirmationModal } from "./ConfirmationModal";
import { addPathNote, fragmentsPlaceholder, setSettingEnabled } from "./settingHelpers";
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

	// Redraws the page if it's showing (after settings changed outside it, e.g. an undo)
	redrawIfOpen(): void {
		if (this.containerEl.isConnected && this.containerEl.isShown()) this.display();
	}

	// Display the settings UI
	display(): void {
		const { containerEl } = this; // Get the container element
		containerEl.empty(); // Clear existing content

		// ====== Chapters ======
		new Setting(containerEl).setName("Chapters").setHeading();

		// Create setting for specifying the chapter template file path
		const templateSetting = new Setting(containerEl)
			.setName("Chapter template")
			.setDesc(
				"Note used for new chapters; {{title}} and {{date}} are filled in. Leave empty for blank chapters."
			);
		const updateTemplateNote = addPathNote(this.app, templateSetting.descEl, "file", "File");
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
			.setName("Label for chapters outside subfolders")
			.setDesc(
				"Group name for chapters directly in the project folder. Shown last in the list."
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
			.setName("Leave this group out of totals")
			.setDesc(
				"Chapters directly in the project folder don't count toward the totals at the top of the list: chapter count, word count and progress. Their own group still shows its numbers."
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

		// Create setting for the chapter counts on the stats lines
		new Setting(containerEl)
			.setName("Show chapter counts")
			.setDesc("How many chapters the project and each group have, on the line under their headers.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showChapterCount)
					.onChange(async (value) => {
						this.plugin.settings.showChapterCount = value;
						await this.plugin.saveSettings();
					})
			);

		// Create setting for keyboard navigation in the chapter table
		new Setting(containerEl)
			.setName("Keyboard navigation")
			.setDesc(
				"Arrow keys move through the list; Enter opens, space changes the property, F2 renames, delete deletes."
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
			.setName("Reveal in file menus")
			.setDesc(
				"Adds a reveal option to a chapter's menu in the file explorer and tab header."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.revealInFileMenu)
					.onChange(async (value) => {
						this.plugin.settings.revealInFileMenu = value;
						await this.plugin.saveSettings(false); // Read when a menu opens; nothing to redraw
					})
			);

		// Create setting for the ribbon icon that opens the view
		new Setting(containerEl)
			.setName("Show ribbon icon")
			.setDesc("An icon in the left ribbon that opens the view. The open view command always works.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showRibbonIcon)
					.onChange(async (value) => {
						this.plugin.settings.showRibbonIcon = value;
						this.plugin.updateRibbonIcon();
						await this.plugin.saveSettings(false); // Nothing in the views changes
					})
			);

		// ====== Chapter numbering ======
		new Setting(containerEl).setName("Chapter numbering").setHeading();
		this.renderNumberingSettings(containerEl.createDiv());

		// ====== Word counts ======
		new Setting(containerEl).setName("Word counts").setHeading();

		// Create settings for word counts (the rest only matter while they're on)
		const wordCountSettings: Setting[] = [];
		let wordsPerPageSetting: Setting | null = null; // Only matters for the pages unit
		const updateWordCountControls = () => {
			const { showWordCounts, wordCountUnits } = this.plugin.settings;
			for (const setting of wordCountSettings) setSettingEnabled(setting, showWordCounts);
			if (wordsPerPageSetting) {
				setSettingEnabled(wordsPerPageSetting, showWordCounts && wordCountUnits.includes("pages"));
			}
		};
		new Setting(containerEl)
			.setName("Show counts")
			.setDesc(
				"Words, characters and pages per chapter, group and project. Headers show every unit turned on below; chapter rows show the first one. Reads chapter files."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showWordCounts)
					.onChange(async (value) => {
						this.plugin.settings.showWordCounts = value;
						updateWordCountControls();
						await this.plugin.saveSettings();
					})
			);
		// One toggle per unit: any combination can be shown
		const unitToggles: { unit: WordCountUnit; name: string; desc: string }[] = [
			{ unit: "words", name: "Words", desc: "" },
			{ unit: "characters", name: "Characters", desc: "Leaves out markdown; spaces between words count." },
			{ unit: "pages", name: "Pages", desc: "Words divided by the words per page below." },
		];
		for (const { unit, name, desc } of unitToggles) {
			const unitSetting = new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.wordCountUnits.includes(unit))
						.onChange(async (value) => {
							const selected = new Set(this.plugin.settings.wordCountUnits);
							if (value) selected.add(unit);
							else selected.delete(unit);
							// Kept in display order: words, characters, pages
							this.plugin.settings.wordCountUnits = unitToggles
								.map((entry) => entry.unit)
								.filter((u) => selected.has(u));
							updateWordCountControls();
							await this.plugin.saveSettings();
						})
				);
			wordCountSettings.push(unitSetting);
		}
		wordsPerPageSetting = new Setting(containerEl)
			.setName("Words per page")
			.setDesc("How many words make a page, for counting pages.")
			.addText((text) => {
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
		const detailSetting = new Setting(containerEl)
			.setName("Detail")
			.setDesc("Show counts on every chapter, only on groups and the total, or only on chapters.")
			.addDropdown((dropdown) => {
				dropdown
					.addOptions({
						chapters: "Chapters, groups and total",
						groups: "Groups and total only",
						"chapters-only": "Chapters only",
					})
					.setValue(this.plugin.settings.wordCountGranularity)
					.onChange(async (value) => {
						this.plugin.settings.wordCountGranularity = value as WordCountGranularity;
						await this.plugin.saveSettings();
					});
			});
		wordCountSettings.push(detailSetting);
		const formatSetting = new Setting(containerEl)
			.setName("Format")
			.setDesc("Short numbers are rounded; hover one for the exact count. Pages always show one decimal.")
			.addDropdown((dropdown) => {
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
		wordCountSettings.push(formatSetting);
		const markerSetting = new Setting(containerEl)
			.setName("Start counting after")
			.setDesc(
				"Only count the words after the first occurrence of this text in a chapter (e.g., a heading or a line like %%start%%). Chapters without it are counted whole. Leave empty to count everything."
			)
			.addText((text) => {
				text
					.setPlaceholder("E.g., %%start%%")
					.setValue(this.plugin.settings.wordCountStartMarker)
					.onChange((value) => {
						// Not trimmed: spaces or line breaks can be part of the marker
						this.plugin.settings.wordCountStartMarker = value;
						this.plugin.saveSettingsDebounced(); // Counts are cached per marker, so this recounts
					});
			});

		wordCountSettings.push(markerSetting);
		updateWordCountControls(); // Initial disabled state

		// ====== Property column ======
		new Setting(containerEl).setName("Property column").setHeading();

		// Create setting for showing the frontmatter property column and settings
		new Setting(containerEl)
			.setName("Show property column")
			.setDesc(
				"A column to view and change a frontmatter property of each chapter."
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
			.setDesc("A tab for quick idea notes, saved in each project's fragments folder.")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableFragments)
					.onChange(async (value) => {
						this.plugin.settings.enableFragments = value;
						await this.plugin.saveSettings();
						// Only the projects (their fragments folder field), so the page keeps its scroll position
						this.renderNovelProjects(novelProjectsContainer);
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
							name: `New novel ${
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

	private renderPropertySettings(containerEl: HTMLElement): void {
		containerEl.empty(); // Clear existing content

		// Always shown; greyed out while the property column is off
		const settings = this.plugin.settings;
		const isCheckbox = settings.propertyType === "checkbox";
		const columnOn = settings.showProperty;

		// Create setting for selecting the frontmatter property to change
		const propertySetting = new Setting(containerEl)
			.setName("Property")
			.setDesc(
				"Frontmatter key to show and change (case-sensitive), e.g., status."
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
		const titleSetting = new Setting(containerEl)
			.setName("Column title")
			.setDesc(
				"Shown above the column. Leave empty to use the property name."
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
		const optionsSetting = new Setting(containerEl)
			.setName("Options")
			.setDesc(descriptionLines(optionsDescription))
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.propertyOptions)
					.setValue(settings.propertyOptions)
					.onChange((value) => {
						settings.propertyOptions = value;
						updateWarning(); // Only the warning, so the input keeps focus
						this.plugin.saveSettingsDebounced(); // Debounced: saves and refreshes views once typing pauses
					})
			);

		// Create setting for loose matching
		const looseSetting = new Setting(containerEl)
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
		const checkboxProgressSetting = new Setting(containerEl)
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
		const optionProgressSetting = new Setting(containerEl)
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
		const progressTextSetting = new Setting(containerEl)
			.setName("Progress text")
			.setDesc("What to write next to the option bar; the tooltip always has the full breakdown.")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						last: "Last option",
						none: "Bar only",
						all: "All options",
					})
					.setValue(settings.optionProgressText)
					.onChange(async (value) => {
						settings.optionProgressText = value as OptionProgressText;
						await this.plugin.saveSettings();
					})
			);

		// Grey out what can't apply right now
		for (const setting of [
			propertySetting,
			titleSetting,
			typeSetting,
			looseSetting,
			checkboxProgressSetting,
			optionProgressSetting,
		]) {
			setSettingEnabled(setting, columnOn);
		}
		setSettingEnabled(optionsSetting, columnOn && !isCheckbox); // Kept, but unused, for checkboxes
		setSettingEnabled(progressTextSetting, columnOn && settings.optionProgress);
	}



	// Chapter numbering: every change that renames files goes through the preview
	private renderNumberingSettings(containerEl: HTMLElement): void {
		containerEl.empty();
		const settings = this.plugin.settings;
		const on = settings.autoNumbering;
		const rerender = () => this.renderNumberingSettings(containerEl);
		// The preview applies or cancels; either way the section then shows the real settings
		const openPreview = (title: string, options: NumberingOptions) => {
			new NumberingModal(this.plugin, { title, options, onClose: rerender }).open();
		};

		new Setting(containerEl)
			.setName("Number chapters automatically")
			.setDesc(
				"Keeps chapter names numbered in order, following the format below. Moving, adding or removing chapters in the view renames the ones after them. You'll see every new name before anything is renamed."
			)
			.addToggle((toggle) =>
				toggle.setValue(on).onChange(async (value) => {
					if (value) {
						openPreview("Turn on chapter numbering", getNumberingOptions(settings));
						return;
					}
					// Turning it off renames nothing
					settings.autoNumbering = false;
					await this.plugin.saveSettings();
					rerender();
				})
			);

		// Format and digits are drafts until applied (renaming on every keystroke would be chaos)
		let draftFormat = settings.numberFormat;
		let draftDigits = settings.numberDigits;
		let applyButton: ButtonComponent | null = null;
		const updateApply = () => {
			const valid = validateFormat(draftFormat).errors.length === 0;
			const changed = draftFormat !== settings.numberFormat || draftDigits !== settings.numberDigits;
			applyButton?.setDisabled(!on || !valid || !changed);
		};

		const formatSetting = new Setting(containerEl)
			.setName("Format")
			.setDesc("{number} is the chapter's number and {title} the rest of its name.");
		const formatNoteEl = formatSetting.descEl.createDiv();
		const updateFormatNote = () => {
			const { errors, warnings } = validateFormat(draftFormat);
			formatNoteEl.empty();
			for (const text of [...errors, ...warnings]) formatNoteEl.createDiv({ cls: "mod-warning", text });
		};
		formatSetting.addText((text) =>
			text
				.setPlaceholder(DEFAULT_NUMBER_FORMAT)
				.setValue(draftFormat)
				.onChange((value) => {
					draftFormat = value;
					updateFormatNote();
					updateApply();
				})
		);
		updateFormatNote();

		const digitsSetting = new Setting(containerEl)
			.setName("Minimum digits")
			.setDesc("Pads numbers with zeros, so 2 gives 01, 02 and so on; larger numbers are never cut.")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text.setValue(String(draftDigits)).onChange((value) => {
					const digits = Number(value);
					// Ignore empty or invalid input until it's a whole number of at least 1
					if (!Number.isInteger(digits) || digits < 1) return;
					draftDigits = digits;
					updateApply();
				});
			});

		const applySetting = new Setting(containerEl)
			.setName("Apply format changes")
			.setDesc("Shows the new names of every chapter before renaming them.")
			.addButton((button) => {
				applyButton = button;
				button.setButtonText("Apply…").onClick(() =>
					openPreview("Change chapter numbering", {
						...getNumberingOptions(settings),
						format: draftFormat,
						digits: draftDigits,
					})
				);
			});

		// Toggles open the preview with the new value right away
		const perFolderSetting = new Setting(containerEl)
			.setName("Number per folder")
			.setDesc("Each folder starts at 1. Off: numbers continue through the whole project.")
			.addToggle((toggle) =>
				toggle.setValue(settings.numberPerFolder).onChange((value) =>
					openPreview("Change chapter numbering", { ...getNumberingOptions(settings), perFolder: value })
				)
			);

		const otherName = settings.otherGroupName || "Other";
		const skipOtherSetting = new Setting(containerEl)
			.setName(`Leave out "${otherName}"`)
			.setDesc("Chapters directly in the project folder keep their names and aren't numbered.")
			.addToggle((toggle) =>
				toggle.setValue(settings.numberSkipOther).onChange((value) =>
					openPreview("Change chapter numbering", { ...getNumberingOptions(settings), skipOther: value })
				)
			);

		// Greyed out while numbering is off (turning it on asks for all of them in the preview)
		for (const setting of [formatSetting, digitsSetting, applySetting, perFolderSetting, skipOtherSetting]) {
			setSettingEnabled(setting, on);
		}
		updateApply(); // After setSettingEnabled, which would enable the button
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
			const updatePathNote = addPathNote(this.app, projectSetting.descEl, "folder", "Chapters folder");
			const updateFragmentsNote = addPathNote(this.app, projectSetting.descEl, "folder", "Fragments folder");

			// Vertical stack of labeled inputs in the control area
			const inputStack = projectSetting.controlEl.createDiv({ cls: "novel-project-input-stack" });
			// A label above each input; the label wraps the input, so clicking it focuses the field
			const addField = (label: string): HTMLElement => {
				const fieldEl = inputStack.createEl("label", { cls: "novel-project-field" });
				fieldEl.createSpan({ cls: "novel-project-field-label", text: label });
				return fieldEl;
			};

			// Novel name
			new TextComponent(addField("Name"))
				.setPlaceholder("E.g., my epic saga")
				.setValue(project.name)
				.onChange((value) => {
					project.name = value.trim();
					updateConfigText(); // Only the description, so the input keeps focus
					this.plugin.saveSettingsDebounced(); // Debounced: saves and refreshes views once typing pauses
				});

			// Chapters folder
			let fragmentsText: TextComponent | null = null; // Created below
			const pathText = new TextComponent(addField("Chapters folder"))
				.setPlaceholder("E.g., novels/my-epic-saga/chapters")
				.setValue(project.path)
				.onChange((value) => {
					project.path = value.trim();
					updatePathNote(value);
					// The fragments placeholder shows the fallback, which follows this path
					fragmentsText?.setPlaceholder(fragmentsPlaceholder(project.path));
					this.plugin.saveSettingsDebounced(); // Debounced: saves and refreshes views once typing pauses
				});
			new FolderSuggest(this.app, pathText.inputEl);
			updatePathNote(project.path);

			// Fragments folder: always shown, greyed out while fragments are off
			const fragmentsOn = this.plugin.settings.enableFragments;
			const fragmentsField = addField(fragmentsOn ? "Fragments folder" : "Fragments folder (fragments are off)");
			fragmentsField.toggleClass("is-disabled", !fragmentsOn);
			fragmentsText = new TextComponent(fragmentsField)
				.setPlaceholder(fragmentsPlaceholder(project.path))
				// If empty, the plugin really uses the placeholder path (<chapters path>/Fragments)
				.setValue(project.fragmentsPath || "")
				.setDisabled(!fragmentsOn)
				.onChange((value) => {
					project.fragmentsPath = value.trim();
					updateFragmentsNote(value);
					this.plugin.saveSettingsDebounced(); // Debounced: saves and refreshes views once typing pauses
				});
			new FolderSuggest(this.app, fragmentsText.inputEl);
			// The missing-folder note only matters while fragments are on
			updateFragmentsNote(fragmentsOn ? project.fragmentsPath || "" : "");

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
								`Remove the project "${project.name || "Unnamed novel"}"? Its files stay in your vault.`,
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
}
