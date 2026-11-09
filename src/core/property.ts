// Parsing and matching for the property options (no Obsidian imports)

// Property types: auto (option syntax decides), text (as typed), number, checkbox
export const PROPERTY_TYPE_SETTINGS = ["auto", "text", "number", "checkbox"] as const;
export type PropertyTypeSetting = (typeof PROPERTY_TYPE_SETTINGS)[number];

export type OptionValue = string | number | boolean;

// Text next to the option progress bar: last option's count, none, or every option
export const OPTION_PROGRESS_TEXTS = ["last", "none", "all"] as const;
export type OptionProgressText = (typeof OPTION_PROGRESS_TEXTS)[number];

export interface PropertyOption {
	label: string; // The option exactly as typed (used for display and as the filter key)
	value: OptionValue; // The value written to frontmatter
}

// Plain decimal numbers only, so "007", "1e3" and "0x10" stay text
const PLAIN_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;

function isQuote(ch: string | undefined): ch is '"' | "'" {
	return ch === '"' || ch === "'";
}

// Index of the quote closing the one at `start`, or -1 if it never closes
function findClosingQuote(input: string, start: number): number {
	const quote = input[start];
	for (let i = start + 1; i < input.length; i++) {
		const ch = input[i];
		// A backslash escapes the quote or another backslash
		if (ch === "\\" && (input[i + 1] === quote || input[i + 1] === "\\")) {
			i++; // Skip the escaped character
			continue;
		}
		if (ch === quote) {
			if (quote === "'" && input[i + 1] === "'") {
				i++; // '' is an escaped single quote
				continue;
			}
			return i;
		}
	}
	return -1;
}

// Resolves the escapes inside a quoted section (without its surrounding quotes)
function unescapeQuoted(body: string, quote: string): string {
	let out = "";
	for (let i = 0; i < body.length; i++) {
		const ch = body[i];
		const next = body[i + 1];
		if (ch === "\\" && (next === quote || next === "\\")) {
			out += next;
			i++;
		} else if (quote === "'" && ch === "'" && next === "'") {
			out += "'";
			i++;
		} else {
			out += ch;
		}
	}
	return out;
}

// Splits the options setting on commas, except commas inside quotes
export function splitOptions(input: string): string[] {
	const tokens: string[] = [];
	let i = 0;
	while (i < input.length) {
		while (i < input.length && /\s/.test(input[i])) i++; // Skip leading whitespace
		if (i >= input.length) break;

		let searchFrom = i;
		// Only a leading quote counts (as in YAML), so "hya'e" stays literal
		if (isQuote(input[i])) {
			const close = findClosingQuote(input, i);
			// Unclosed quotes are literal; closed ones protect their commas
			if (close !== -1) searchFrom = close + 1;
		}

		let end = input.indexOf(",", searchFrom);
		if (end === -1) end = input.length;
		const token = input.slice(i, end).trim();
		if (token) tokens.push(token);
		i = end + 1;
	}
	return tokens;
}

// Reads one option the way frontmatter would (used by "auto")
export function parseOptionValue(token: string): OptionValue {
	const t = token.trim();
	// Fully quoted: text, quotes removed
	if (t.length >= 2 && isQuote(t[0]) && findClosingQuote(t, 0) === t.length - 1) {
		return unescapeQuoted(t.slice(1, -1), t[0]);
	}
	if (PLAIN_NUMBER.test(t)) return Number(t);
	// true/false in any case
	const lower = t.toLowerCase();
	if (lower === "true") return true;
	if (lower === "false") return false;
	return t; // Anything else is text as typed
}

// Builds the dropdown options for the given settings
export function buildOptions(settings: {
	propertyOptions: string;
	propertyType: PropertyTypeSetting;
}): { options: PropertyOption[]; unconvertible: string[] } {
	const options: PropertyOption[] = [];
	const unconvertible: string[] = []; // Options that can't be numbers (Number type only)
	if (settings.propertyType === "checkbox") return { options, unconvertible };

	for (const label of splitOptions(settings.propertyOptions)) {
		if (settings.propertyType === "text") {
			options.push({ label, value: label }); // Saved exactly as typed
			continue;
		}

		const parsed = parseOptionValue(label);
		if (settings.propertyType === "number" && typeof parsed !== "number") {
			if (typeof parsed === "string" && PLAIN_NUMBER.test(parsed.trim())) {
				options.push({ label, value: Number(parsed.trim()) }); // e.g. "3" -> 3
			} else {
				unconvertible.push(label); // Keep the auto value (true never becomes 1)
				options.push({ label, value: parsed });
			}
			continue;
		}

		options.push({ label, value: parsed });
	}
	return { options, unconvertible };
}

function isScalar(v: unknown): v is OptionValue {
	return typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

// Text used for loose comparison
function looseText(v: OptionValue): string {
	const text = String(v);
	// "TRUE"/"True" compare equal to true
	const lower = text.trim().toLowerCase();
	return lower === "true" || lower === "false" ? lower : text;
}

// Compares two frontmatter values (loose: 3 = "3", true = "true")
export function scalarEquals(a: unknown, b: unknown, loose: boolean): boolean {
	if (!isScalar(a) || !isScalar(b)) return false; // No list support for now
	if (a === b) return true;
	return loose && looseText(a) === looseText(b);
}

// Indices of the options matching a chapter's value, for the row dropdown
export function findMatches(
	chapterValue: unknown,
	options: PropertyOption[],
	loose: boolean,
): number[] {
	const matching = (looseCompare: boolean) =>
		options.flatMap((option, index) =>
			scalarEquals(chapterValue, option.value, looseCompare) ? [index] : [],
		);
	// Exact type first: with options 3 and "3", a chapter with "3" shows "3"
	const strict = matching(false);
	return strict.length > 0 || !loose ? strict : matching(true);
}

// Whether a chapter matches the filter option (no exact-type preference)
export function filterMatches(chapterValue: unknown, option: PropertyOption, loose: boolean): boolean {
	return scalarEquals(chapterValue, option.value, loose);
}

// Checkbox state of a chapter's value
export function checkboxState(v: unknown, loose: boolean): true | false | "mixed" {
	if (v === undefined || v === null || v === "") return false; // Unset counts as unchecked
	if (v === true || v === false) return v;
	if (loose && typeof v === "string") {
		const lower = v.trim().toLowerCase();
		if (lower === "true") return true;
		if (lower === "false") return false;
	}
	return "mixed"; // Shown as a dash, so it isn't overwritten by accident
}

// YAML for the property in a new chapter's default frontmatter
export function defaultValueYaml(type: PropertyTypeSetting): string {
	return type === "checkbox" ? "false" : '""';
}

// Short, readable form of a frontmatter value for labels and dialogs
export function describeValue(v: unknown, maxLength = 40): string {
	const text = typeof v === "string" ? v : (JSON.stringify(v) ?? String(v));
	return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

// Exact, type-sensitive equality of two frontmatter values
export function sameValue(a: unknown, b: unknown): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

// Whether a value counts as unset (same rule as checkboxState)
function isUnset(v: unknown): boolean {
	return v === undefined || v === null || v === "";
}

export interface CheckboxSummary {
	checked: number;
	unchecked: number; // Unset or false
	mixed: number; // Other values (the dash state), counted as unchecked in the bar
	total: number;
}

// Counts checked/unchecked chapters for the checkbox progress
export function summarizeCheckbox(values: unknown[], loose: boolean): CheckboxSummary {
	const summary: CheckboxSummary = { checked: 0, unchecked: 0, mixed: 0, total: values.length };
	for (const value of values) {
		const state = checkboxState(value, loose);
		if (state === true) summary.checked++;
		else if (state === "mixed") summary.mixed++;
		else summary.unchecked++;
	}
	return summary;
}

export interface OptionSummary {
	counts: number[]; // Per option, in the options' order
	unlisted: number; // Set, but matching no option (typos, old options, lists)
	none: number; // Unset
	total: number;
}

// Counts chapters per option for the option progress (same matching as the row dropdown)
export function summarizeOptions(
	values: unknown[],
	options: PropertyOption[],
	loose: boolean,
): OptionSummary {
	const summary: OptionSummary = {
		counts: options.map(() => 0),
		unlisted: 0,
		none: 0,
		total: values.length,
	};
	for (const value of values) {
		if (isUnset(value)) {
			summary.none++;
			continue;
		}
		const [first] = findMatches(value, options, loose);
		if (first === undefined) summary.unlisted++;
		else summary.counts[first]++;
	}
	return summary;
}
