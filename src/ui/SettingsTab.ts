// The plugin's settings screen.
import { App, PluginSettingTab, Setting } from "obsidian";
import type NovelChapterPlugin from "../main";
import { DEFAULT_SETTINGS } from "../settings";
import { generateId } from "../core/utils";
import { buildOptions, PropertyTypeSetting } from "../core/property";
import { ConfirmationModal } from "./ConfirmationModal";

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

		// Create setting for specifying the chapter template file path
		new Setting(containerEl)
			.setName("Chapter template file path")
			.setDesc(
				'Path to a markdown file to use as a template for new chapters (e.g., "Templates/ChapterTemplate.md"). Leave empty to not use a template. Placeholders like {{title}} and {{date}} can be used in the template.'
			)
			.addText((text) =>
				text
					.setPlaceholder(
						DEFAULT_SETTINGS.chapterTemplatePath ||
							"e.g., Templates/ChapterTemplate.md"
					)
					.setValue(this.plugin.settings.chapterTemplatePath)
					.onChange((value) => {
						this.plugin.settings.chapterTemplatePath = value.trim();
						this.plugin.saveSettingsDebounced(); // Debounced: saves and refreshes views once typing pauses
					})
			);
		
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
						this.display(); // Force re-render to show/hide the fragment paths
					})
			);
		
		// Property Settings
		new Setting(containerEl)
		.setName("Property")
		.setHeading();

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
		})
		this.renderPropertySettings(propertySettingsContainer);

		new Setting(containerEl)
            .setName("Novel projects") // Lembre-se do "Sentence case" (P minúsculo!)
            .setHeading();
            
        const novelProjectsContainer = containerEl.createDiv({
            cls: "novel-projects-container",
        });

		// Initial render of the novel projects list
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
	}

	// Renders the list of novel projects
	private renderNovelProjects(containerEl: HTMLElement): void {
		containerEl.empty(); // Clear existing content

		// If no projects, show a message
		if (this.plugin.settings.novelProjects.length === 0) {
			containerEl.createEl("p", {
				text: "No novel projects configured. Add one below.",
			});
		}

		// Render each novel project with its settings
		this.plugin.settings.novelProjects.forEach((project, index) => {
			// Create a setting for each novel project
			const projectSetting = new Setting(containerEl)
				.setName(`Novel ${index + 1}`)
				.setDesc(`Configuration for ${project.name || "this novel"}.`);

			// Create a vertical stack container inside the setting's control area
			const inputStack = projectSetting.controlEl.createDiv({ cls: "novel-project-input-stack" });

			// Text input for the novel name
			projectSetting.addText((text) => {
				text
					.setPlaceholder("Novel name (e.g., my epic saga)")
					.setValue(project.name)
					.onChange((value) => {
						project.name = value.trim();
						this.plugin.saveSettingsDebounced(); // Debounced: saves and refreshes views once typing pauses
					});
				// Move the input element into our vertical stack
				inputStack.appendChild(text.inputEl);
			});

			// Text input for the folder path
			projectSetting.addText((text) => {
				text
					.setPlaceholder(
						"Folder path (e.g., novels/my-epic-saga/chapters)"
					)
					.setValue(project.path)
					.onChange((value) => {
						project.path = value.trim();
						this.plugin.saveSettingsDebounced(); // Debounced: saves and refreshes views once typing pauses
					});
				// Move the input element into our vertical stack
				inputStack.appendChild(text.inputEl);
			});
			
			// Fragments path input (only when fragments are enabled)
			if (this.plugin.settings.enableFragments) {
				projectSetting.addText((text) => {
					// Dynamically set default placeholder based on the main path
					const defaultPath = project.path ? `${project.path}/Fragments` : "e.g., Novels/MyEpicSaga/Fragments";
					
					text
						.setPlaceholder(defaultPath)
						// If empty, the plugin really uses the placeholder path (<chapters path>/Fragments)
						.setValue(project.fragmentsPath || "")
						.onChange((value) => {
							project.fragmentsPath = value.trim();
							this.plugin.saveSettingsDebounced(); // Debounced: saves and refreshes views once typing pauses
						});
					// Move the input element into our vertical stack
					inputStack.appendChild(text.inputEl);
				});
			}

			// Button to remove the novel project
			projectSetting.addButton((button) =>
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
									this.plugin.settings.novelProjects.splice(index, 1);
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
