// The property column's cell: option dropdown or checkbox
import { App, TFile } from "obsidian";
import { NovelChapterPluginSettings, NovelProject } from "../settings";
import { getProjectChapters, updateChapterProperty } from "../core/chapters";
import {
	checkboxState,
	describeValue,
	findMatches,
	PropertyOption,
	sameValue,
} from "../core/property";
import { ConfirmationModal } from "./ConfirmationModal";

// Dropdown value for the display-only extra entry ("(not in options)" / "(multiple)")
const ORIGINAL_VALUE_OPTION = "__novel-manager-original-value__";

// Whether no other chapter in the project has exactly this value
function isLastWithValue(
	app: App,
	settings: NovelChapterPluginSettings,
	file: TFile,
	project: NovelProject,
	propertyName: string,
	value: unknown,
): boolean {
	// All chapters (ignoring search and filter), compared type-sensitively
	return !getProjectChapters(app, settings, project).some(
		(other) =>
			other.path !== file.path &&
			sameValue(
				app.metadataCache.getFileCache(other)?.frontmatter?.[
					propertyName
				],
				value,
			),
	);
}

// Checkbox for the checkbox property type
export function renderPropertyCheckbox(
	app: App,
	settings: NovelChapterPluginSettings,
	cell: HTMLElement,
	file: TFile,
	project: NovelProject,
	propertyName: string,
	rawValue: unknown,
): void {
	const state = checkboxState(rawValue, settings.looseMatching);
	const checkbox = cell.createEl("input", { type: "checkbox" });
	const showCurrentState = () => {
		checkbox.checked = state === true;
		checkbox.indeterminate = state === "mixed";
	};
	showCurrentState();
	// Values that aren't true/false show a dash; hover shows the value
	if (state === "mixed") {
		checkbox.title = `Current value: ${describeValue(rawValue)}`;
	}

	checkbox.addEventListener("change", () => {
		const newValue = checkbox.checked; // Clicking the dash state checks the box
		const write = () =>
			void updateChapterProperty(app, file, propertyName, newValue);

		// Ask first if this is the last chapter with that value
		if (
			state === "mixed" &&
			isLastWithValue(app, settings, file, project, propertyName, rawValue)
		) {
			new ConfirmationModal(
				app,
				`This chapter's ${propertyName} is ${describeValue(rawValue)}, which isn't true/false, and no other chapter has it. Replace it with ${String(newValue)}?`,
				write,
				showCurrentState, // Cancelled: back to the dash state
			).open();
		} else {
			write();
		}
	});
}

// Dropdown of the options
export function renderPropertyDropdown(
	app: App,
	settings: NovelChapterPluginSettings,
	cell: HTMLElement,
	file: TFile,
	project: NovelProject,
	propertyName: string,
	rawValue: unknown,
	options: PropertyOption[],
): void {
	const selectEl = cell.createEl("select");
	const matches = findMatches(
		rawValue,
		options,
		settings.looseMatching,
	);
	const isEmpty =
		rawValue === undefined || rawValue === null || rawValue === "";
	const notInOptions = !isEmpty && matches.length === 0;

	selectEl.createEl("option", { text: "--- select ---", value: "" });

	// Display-only entry for a value matching no option, or several
	const showExtraEntry = !isEmpty && matches.length !== 1;
	if (showExtraEntry) {
		selectEl.createEl("option", {
			text: notInOptions
				? `${describeValue(rawValue)} (not in options)`
				: `${matches.map((i) => options[i].label).join(", ")} (multiple)`,
			value: ORIGINAL_VALUE_OPTION,
		});
	}

	// Option values are indexes, since labels can contain quotes
	options.forEach((option, index) => {
		selectEl.createEl("option", { text: option.label, value: `opt-${index}` });
	});

	const initialValue = showExtraEntry
		? ORIGINAL_VALUE_OPTION
		: matches.length === 1 && !isEmpty
			? `opt-${matches[0]}`
			: "";
	selectEl.value = initialValue;

	selectEl.addEventListener("change", () => {
		const selected = selectEl.value;
		if (selected === ORIGINAL_VALUE_OPTION) return; // Display-only entry: nothing to write

		const option =
			selected === "" ? null : options[Number(selected.slice("opt-".length))];
		const newValue: unknown = option ? option.value : ""; // "" removes the property
		const write = () =>
			void updateChapterProperty(app, file, propertyName, newValue);

		// Ask first if this is the last chapter with that value
		if (
			notInOptions &&
			isLastWithValue(app, settings, file, project, propertyName, rawValue)
		) {
			const action = option ? `Replace it with ${option.label}?` : "Remove it?";
			new ConfirmationModal(
				app,
				`This chapter's ${propertyName} is ${describeValue(rawValue)}, which isn't one of the options, and no other chapter has it. ${action}`,
				write,
				() => {
					selectEl.value = initialValue; // Cancelled: back to the current value
				},
			).open();
		} else {
			write();
		}
	});
}
