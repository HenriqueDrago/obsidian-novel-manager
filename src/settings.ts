import { App, PluginSettingTab, Setting } from "obsidian";
import NovelChapterPlugin from "./main";

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
	chapterTemplatePath: string; // Path to the chapter template file
	otherGroupName: string; // Name for the "Other" group
	excludeOtherFromCount: boolean; // Whether to exclude "Other" from total count
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
	chapterTemplatePath: "", // Default to no template
	otherGroupName: "Other", // Default name for the "Other" group
	excludeOtherFromCount: false, // Default to including "Other" in counts
};

// Helper to generate a unique ID
function generateId(): string {
	return `novel-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// Create a setting tab for the plugin
export class NovelChapterPluginSettingsTab extends PluginSettingTab {
	plugin: NovelChapterPlugin;

	// Initialize with the app and plugin instance
	constructor(app: App, plugin: NovelChapterPlugin) {
		super(app, plugin);
		this.plugin = plugin;
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
					.onChange(async (value) => {
						this.plugin.settings.chapterTemplatePath = value.trim();
						await this.plugin.saveSettings();
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
					.onChange(async (value) => {
						this.plugin.settings.otherGroupName = value || "Other";
						await this.plugin.saveSettings();
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
						await this.plugin.saveSettings();
						this.renderPropertySettings(propertySettingsContainer); // Refresh the settings
						this.plugin.refreshNovelChapterView(true); // Refresh the view
					})
			);
		
		// if(this.plugin.settings.showProperty) {
		// 	 // For styling purposes
		// }

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
						this.plugin.refreshNovelChapterView(true); // Refresh the view
					})
			);
	}

	private renderPropertySettings(containerEl: HTMLElement): void {
		containerEl.empty(); // Clear existing content

		new Setting(containerEl);

		// If the setting to show the property is toggled
		if(this.plugin.settings.showProperty) {
			// Create setting for selecting the frontmatter property to change
			new Setting(containerEl)
				.setName("Target property name")
				.setDesc(
					'The actual frontmatter key to update (e.g., "status", "outlinelevel"). This is case-sensitive.'
				)
				.addText((text) =>
					text
						.setPlaceholder(DEFAULT_SETTINGS.propertyNameToChange)
						.setValue(this.plugin.settings.propertyNameToChange)
						.onChange(async (value) => {
							this.plugin.settings.propertyNameToChange =
								value.trim(); // Trim whitespace
							await this.plugin.saveSettings();
							this.plugin.refreshNovelChapterView(); // Refresh to update the column header if needed
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
						.setValue(this.plugin.settings.propertyColumnHeader)
						.onChange(async (value) => {
							this.plugin.settings.propertyColumnHeader =
								value.trim(); // Trim whitespace
							await this.plugin.saveSettings();
							this.plugin.refreshNovelChapterView(); // Refresh to update the column header
						})
				);

			// Create setting for defining the dropdown options
			new Setting(containerEl)
				.setName("Property options")
				.setDesc(
					'Enter a comma-separated list of options for the dropdown (e.g., "to do,in progress,complete").'
				)
				.addText((text) =>
					text
						.setPlaceholder(DEFAULT_SETTINGS.propertyOptions)
						.setValue(this.plugin.settings.propertyOptions)
						.onChange(async (value) => {
							this.plugin.settings.propertyOptions = value;
							await this.plugin.saveSettings();
							this.plugin.refreshNovelChapterView(); // Refresh to update the dropdown options
						})
				);
		}
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
					.onChange(async (value) => {
						project.name = value.trim();
						await this.plugin.saveSettings();
						this.plugin.refreshNovelChapterView(true); // Refresh the view
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
					.onChange(async (value) => {
						project.path = value.trim();
						await this.plugin.saveSettings();
						this.plugin.refreshNovelChapterView(true); // Refresh the view
					});
				// Move the input element into our vertical stack
				inputStack.appendChild(text.inputEl);
			});
			
			// Text input for fragments path
			// Only appears if fragments are enabled
			if (this.plugin.settings.enableFragments) {
				projectSetting.addText((text) => {
					// Dynamically set default placeholder based on the main path
					const defaultPath = project.path ? `${project.path}/Fragments` : "e.g., Novels/MyEpicSaga/Fragments";
					
					text
						.setPlaceholder(defaultPath)
						// If the value is undefined or empty, it visually falls back to the placeholder
						.setValue(project.fragmentsPath || "")
						.onChange(async (value) => {
							project.fragmentsPath = value.trim();
							await this.plugin.saveSettings();
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
					// Set up the click handler to remove the project
					.onClick(async () => {
						this.plugin.settings.novelProjects.splice(index, 1); // Remove this project from the array
						await this.plugin.saveSettings();
						this.renderNovelProjects(containerEl); // Re-render the list
						this.plugin.refreshNovelChapterView(true); // Refresh the view
					})
			);
		});
	}
}
