// Preview of chapter numbering: what every chapter will be renamed to, before anything changes
import { ButtonComponent, Modal, Notice, Setting, setIcon } from "obsidian";
import type NovelChapterPlugin from "../main";
import { getNumberingOptions, NovelProject } from "../settings";
import { getGroupDisplayName } from "../core/chapters";
import { isCaseSensitiveFileSystem } from "../core/utils";
import {
	NumberingGroup,
	NumberingOptions,
	NumberingPlan,
	planNumbering,
	sortGroupEntries,
	validateFormat,
} from "../core/numbering";
import { applyNumberingPlan, getNumberingGroups, NumberingUndo, undoNumbering } from "../core/renumber";

export class NumberingModal extends Modal {
	private draft: NumberingOptions;
	private projects: { project: NovelProject; groups: NumberingGroup[] }[] = [];
	private exclusions = new Map<string, boolean>(); // Changed "numbered" checkboxes, by path
	private applied = false;
	private listEl!: HTMLElement;
	private summaryEl!: HTMLElement;
	private formatNoteEl!: HTMLElement;
	private confirmButton!: ButtonComponent;

	constructor(
		private plugin: NovelChapterPlugin,
		private config: {
			title: string;
			options: NumberingOptions; // Starting values (e.g. with the setting just changed)
			projects?: NovelProject[]; // Default: every project
			editableOptions?: boolean; // Default true; false when renumbering one project as it is
			onClose?: (applied: boolean) => void; // E.g. puts a toggle back on cancel
		},
	) {
		super(plugin.app);
		this.draft = { ...config.options };
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		this.modalEl.addClass("novel-numbering-modal");
		contentEl.createEl("h2", { text: this.config.title });

		// Chapters in their current order (by number when numbering is on, by name otherwise)
		const settings = this.plugin.settings;
		const projects = this.config.projects ?? settings.novelProjects;
		this.projects = projects
			.filter((project) => project.path.trim() !== "")
			.map((project) => {
				const groups = getNumberingGroups(this.app, settings, project);
				// Turned on again: unnumbered chapters go back to the places their markers saved
				if (!settings.autoNumbering) {
					for (const group of groups) {
						if (group.entries.some((entry) => entry.hasMarker)) {
							group.entries = sortGroupEntries(group.entries, settings.numberFormat);
						}
					}
				}
				return { project, groups };
			});

		if (this.config.editableOptions !== false) this.renderOptions(contentEl);

		this.summaryEl = contentEl.createDiv({ cls: "novel-numbering-summary" });
		this.listEl = contentEl.createDiv({ cls: "novel-numbering-list" });

		const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
		this.confirmButton = new ButtonComponent(buttonContainer)
			.setCta()
			.onClick(() => void this.confirm());
		new ButtonComponent(buttonContainer).setButtonText("Cancel").onClick(() => this.close());

		this.renderList();
	}

	onClose() {
		this.contentEl.empty();
		this.config.onClose?.(this.applied);
	}

	// Format, digits and the two toggles; changing them redraws only the list
	private renderOptions(containerEl: HTMLElement): void {
		const formatSetting = new Setting(containerEl)
			.setName("Format")
			.setDesc("{number} is the chapter's number, {title} the rest of its name.")
			.addText((text) =>
				text.setValue(this.draft.format).onChange((value) => {
					this.draft.format = value;
					this.renderList();
				}),
			);
		this.formatNoteEl = formatSetting.descEl.createDiv();

		new Setting(containerEl)
			.setName("Minimum digits")
			.setDesc("Pads numbers with zeros, so 2 gives 01, 02 and so on; larger numbers are never cut.")
			.addText((text) => {
				text.inputEl.type = "number";
				text.inputEl.min = "1";
				text.setValue(String(this.draft.digits)).onChange((value) => {
					const digits = Number(value);
					// Ignore empty or invalid input until it's a whole number of at least 1
					if (!Number.isInteger(digits) || digits < 1) return;
					this.draft.digits = digits;
					this.renderList();
				});
			});

		new Setting(containerEl)
			.setName("Number per folder")
			.setDesc("Each folder starts at 1. Off: numbers continue through the whole project.")
			.addToggle((toggle) =>
				toggle.setValue(this.draft.perFolder).onChange((value) => {
					this.draft.perFolder = value;
					this.renderList();
				}),
			);

		const otherName = this.plugin.settings.otherGroupName || "Other";
		new Setting(containerEl)
			.setName(`Leave out "${otherName}"`)
			.setDesc("Chapters directly in the project folder keep their names.")
			.addToggle((toggle) =>
				toggle.setValue(this.draft.skipOther).onChange((value) => {
					this.draft.skipOther = value;
					this.renderList();
				}),
			);
	}

	// Names are read with the applied format; before turning numbering on, the new one may already fit
	private get parseFormat(): string {
		const settings = this.plugin.settings;
		return settings.autoNumbering ? settings.numberFormat : this.draft.format;
	}

	// Plans for every project with the draft options and the checkboxes
	private makePlans(): { project: NovelProject; plan: NumberingPlan }[] {
		return this.projects.map(({ project, groups }) => {
			const edited = groups.map((group) => ({
				...group,
				entries: group.entries.map((entry) => ({
					...entry,
					excluded: this.exclusions.get(entry.path) ?? entry.excluded,
				})),
			}));
			return { project, plan: planNumbering(edited, this.parseFormat, this.draft, isCaseSensitiveFileSystem()) };
		});
	}

	private renderList(): void {
		const { errors, warnings } = validateFormat(this.draft.format);
		if (this.formatNoteEl) {
			this.formatNoteEl.empty();
			for (const text of [...errors, ...warnings]) {
				this.formatNoteEl.createDiv({ cls: "mod-warning", text });
			}
		}

		// Redrawn on every change; the list keeps its scroll position (e.g. after ticking a checkbox)
		const scrollTop = this.listEl.scrollTop;
		this.listEl.empty();
		this.summaryEl.empty();
		if (errors.length > 0) {
			this.summaryEl.setText("Fix the format to see the new names.");
			this.confirmButton.setButtonText("Rename").setDisabled(true);
			return;
		}

		const plans = this.makePlans();
		const renames = plans.reduce(
			(sum, { plan }) => sum + plan.changes.filter((r) => r.newPath !== r.path).length,
			0,
		);
		const total = plans.reduce((sum, { plan }) => sum + plan.rows.length, 0);
		const hasDuplicates = plans.some(({ plan }) => plan.hasDuplicates);
		this.summaryEl.setText(
			renames === 0
				? "No chapter needs a new name."
				: `${renames} of ${total} ${total === 1 ? "chapter" : "chapters"} will be renamed. Links to them are updated.`,
		);
		if (hasDuplicates) {
			this.summaryEl.createDiv({
				cls: "mod-warning",
				text: "Some chapters would end up with the same name. Change their titles or leave one out of numbering.",
			});
		}
		this.confirmButton
			.setButtonText(renames > 0 ? `Rename ${renames} ${renames === 1 ? "chapter" : "chapters"}` : "Apply")
			.setDisabled(hasDuplicates);

		for (const { project, plan } of plans) {
			if (plans.length > 1) this.listEl.createDiv({ cls: "novel-numbering-project", text: project.name });
			if (plan.rows.length === 0) {
				this.listEl.createDiv({ cls: "novel-numbering-empty", text: "No chapters." });
				continue;
			}
			let currentGroup: string | null = null;
			for (const row of plan.rows) {
				if (row.groupKey !== currentGroup) {
					currentGroup = row.groupKey;
					const groupEl = this.listEl.createDiv({
						cls: "novel-numbering-group",
						text: getGroupDisplayName(this.plugin.settings, row.groupKey),
					});
					if (row.skipped) groupEl.createSpan({ cls: "novel-numbering-tag", text: "not numbered" });
				}
				const rowEl = this.listEl.createDiv({ cls: "novel-numbering-row" });
				const renamed = row.newPath !== row.path;
				rowEl.toggleClass("is-unchanged", !renamed);
				rowEl.toggleClass("is-duplicate", row.duplicate);

				// Numbered or not (the skipped group has no choice)
				const checkbox = rowEl.createEl("input", { type: "checkbox" });
				checkbox.checked = row.number !== null;
				checkbox.disabled = row.skipped;
				checkbox.setAttr("aria-label", row.skipped ? "Not numbered" : "Numbered");
				checkbox.addEventListener("change", () => {
					this.exclusions.set(row.path, !checkbox.checked);
					this.renderList();
				});

				const namesEl = rowEl.createDiv({ cls: "novel-numbering-names" });
				if (renamed) {
					namesEl.createSpan({ cls: "novel-numbering-old", text: row.oldName });
					setIcon(namesEl.createSpan({ cls: "novel-numbering-arrow" }), "arrow-right");
				}
				namesEl.createSpan({ cls: "novel-numbering-new", text: row.newName });
				if (row.number === null && !row.skipped) {
					namesEl.createSpan({ cls: "novel-numbering-tag", text: "unnumbered" });
				}
			}
		}
		this.listEl.scrollTop = scrollTop;
	}

	// Saves the options, renames everything, and offers to undo it all
	private async confirm(): Promise<void> {
		if (validateFormat(this.draft.format).errors.length > 0) return;
		const plans = this.makePlans();
		if (plans.some(({ plan }) => plan.hasDuplicates)) return;

		const settings = this.plugin.settings;
		const previous = { autoNumbering: settings.autoNumbering, ...getNumberingOptions(settings) };
		// Settings first: the files then match them, and the view orders by the new names
		settings.autoNumbering = true;
		settings.numberFormat = this.draft.format;
		settings.numberDigits = this.draft.digits;
		settings.numberPerFolder = this.draft.perFolder;
		settings.numberSkipOther = this.draft.skipOther;
		// Closed after the change: closing redraws the settings tab, which must show it on
		this.applied = true;
		this.close();
		await this.plugin.saveSettings(false);

		// Puts the numbering settings back as they were (Undo, or a failed project)
		const restoreSettings = async () => {
			settings.autoNumbering = previous.autoNumbering;
			settings.numberFormat = previous.format;
			settings.numberDigits = previous.digits;
			settings.numberPerFolder = previous.perFolder;
			settings.numberSkipOther = previous.skipOther;
			await this.plugin.saveSettings();
			this.plugin.settingsTab?.redrawIfOpen(); // Its toggles show the restored settings
		};

		// One undo for every project
		const undo: NumberingUndo = { paths: [], markers: [] };
		for (const { plan } of plans) {
			const done = await applyNumberingPlan(this.app, plan);
			if (!done) {
				// That project already put itself back; the earlier ones and the settings follow
				const hadChanges = undo.paths.length + undo.markers.length > 0;
				if (hadChanges) await undoNumbering(this.app, undo);
				await restoreSettings();
				if (hadChanges) new Notice("The other projects and the numbering settings were put back.");
				return;
			}
			undo.paths.push(...done.paths);
			undo.markers.push(...done.markers);
		}
		await this.plugin.saveSettings(); // Redraws the views

		const changed = undo.paths.length + undo.markers.length;
		if (changed === 0 && previous.autoNumbering) return;
		const notice = new Notice(
			createFragment((frag) => {
				frag.createSpan({ text: changed > 0 ? "Chapters renumbered. " : "Chapter numbering is on. " });
				frag.createEl("button", { text: "Undo" }).addEventListener("click", (event) => {
					event.stopPropagation();
					notice.hide();
					void (async () => {
						if (changed > 0) await undoNumbering(this.app, undo);
						await restoreSettings();
					})();
				});
			}),
			10000,
		);
	}
}
