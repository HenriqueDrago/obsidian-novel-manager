// Progress summaries for group headers and the column header (read-only)
import type {
	CheckboxSummary,
	OptionProgressText,
	OptionSummary,
	PropertyOption,
} from "../core/property";

// A bar segment: share of the total, plus a modifier class for its color
function addSegment(barEl: HTMLElement, count: number, total: number, cls: string, opacity?: number) {
	if (count === 0 || total === 0) return;
	const segment = barEl.createSpan({ cls: `novel-progress-segment ${cls}` });
	segment.setCssProps({ "--novel-segment": `${(count / total) * 100}%` });
	if (opacity !== undefined) segment.setCssProps({ "--novel-segment-opacity": String(opacity) });
}

function createContainer(parentEl: HTMLElement, tooltip: string): HTMLElement {
	return parentEl.createSpan({ cls: "novel-progress", attr: { "aria-label": tooltip } });
}

// "7/8" with a bar of the checked share
export function renderCheckboxProgress(parentEl: HTMLElement, summary: CheckboxSummary): void {
	if (summary.total === 0) return;
	const tooltip = [`${summary.checked} checked`, `${summary.unchecked} unchecked`];
	if (summary.mixed > 0) {
		tooltip.push(`${summary.mixed} other ${summary.mixed === 1 ? "value" : "values"}`);
	}
	const el = createContainer(parentEl, tooltip.join(" · "));
	const barEl = el.createSpan({ cls: "novel-progress-bar" });
	addSegment(barEl, summary.checked, summary.total, "is-option", 1);
	el.createSpan({ cls: "novel-progress-text", text: `${summary.checked}/${summary.total}` });
}

// A stacked bar of option counts (in the options' order), then unlisted, then unset
export function renderOptionProgress(
	parentEl: HTMLElement,
	summary: OptionSummary,
	options: PropertyOption[],
	textMode: OptionProgressText,
): void {
	if (summary.total === 0 || options.length === 0) return;

	// Full breakdown for the tooltip (zero counts left out)
	const parts = options
		.map((option, i) => ({ label: option.label, count: summary.counts[i] ?? 0 }))
		.filter((part) => part.count > 0)
		.map((part) => `${part.label} ${part.count}`);
	if (summary.unlisted > 0) parts.push(`Unlisted ${summary.unlisted}`);
	const visibleParts = [...parts]; // "All options" text: everything but "No value"
	if (summary.none > 0) parts.push(`No value ${summary.none}`);

	const el = createContainer(parentEl, parts.join(" · "));
	const barEl = el.createSpan({ cls: "novel-progress-bar" });
	// Stronger toward the last option, so a workflow list reads as progress
	options.forEach((_, i) => {
		const opacity = 0.3 + (0.7 * (i + 1)) / options.length;
		addSegment(barEl, summary.counts[i] ?? 0, summary.total, "is-option", opacity);
	});
	addSegment(barEl, summary.unlisted, summary.total, "is-unlisted");
	// Unset chapters stay as empty track

	let text = "";
	if (textMode === "last") {
		const lastIndex = options.length - 1;
		text = `${options[lastIndex]?.label ?? ""} ${summary.counts[lastIndex] ?? 0}/${summary.total}`;
	} else if (textMode === "all") {
		text = visibleParts.join(" · ");
	}
	if (text) el.createSpan({ cls: "novel-progress-text", text });
}
