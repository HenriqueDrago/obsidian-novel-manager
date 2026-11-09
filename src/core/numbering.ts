// Chapter numbering: format parsing, titles and renumbering plans (pure, no Obsidian imports)

// Frontmatter key that marks a chapter as unnumbered; its value is the position ("after chapter N")
export const UNNUMBERED_KEY = "unnumbered-after";

export const DEFAULT_NUMBER_FORMAT = "Chapter {number} - {title}";

// The numbering settings a plan is made with
export interface NumberingOptions {
	format: string;
	digits: number; // Minimum digits, zero-padded
	perFolder: boolean; // Restart at 1 in each group, else count through the project
	skipOther: boolean; // Leave the "Other" group (project folder) out
}

// Natural sort (same as core/utils, which imports Obsidian)
function naturalCompare(a: string, b: string): number {
	return a.localeCompare(b, undefined, { numeric: true });
}

// ====== Format ======

const NUMBER_TOKEN = "{number}";
const TITLE_TOKEN = "{title}";

// Problems with a format: errors block it, warnings don't
export function validateFormat(format: string): { errors: string[]; warnings: string[] } {
	const errors: string[] = [];
	const warnings: string[] = [];
	const count = (token: string) => format.split(token).length - 1;
	if (count(NUMBER_TOKEN) === 0) errors.push("The format needs {number}.");
	if (count(NUMBER_TOKEN) > 1) errors.push("Use {number} only once.");
	if (count(TITLE_TOKEN) > 1) errors.push("Use {title} only once.");
	// Same characters sanitizeFileName removes
	const invalid = Array.from(new Set(format.match(/[\\/:*?"<>|]/g) ?? []));
	if (invalid.length > 0) {
		errors.push(`Not allowed in file names: ${invalid.join(" ")}`);
	}
	if (format.trim().startsWith(".")) errors.push("File names can't start with a dot.");
	const risky = Array.from(new Set(format.match(/[#^[\]]/g) ?? []));
	if (risky.length > 0) warnings.push(`These break links to the chapter: ${risky.join(" ")}`);
	return { errors, warnings };
}

// Separators left at the ends when the title is empty ("Chapter 3 - " → "Chapter 3")
const EDGE_SEPARATORS = /^[\s\-–—.,_]+|[\s\-–—.,_]+$/g;

// A chapter's file name from the format
export function formatChapterName(format: string, number: number, digits: number, title: string): string {
	const padded = String(number).padStart(Math.max(1, digits), "0");
	// Function replacers so "$" in titles isn't a replacement pattern
	const name = format.replace(NUMBER_TOKEN, () => padded).replace(TITLE_TOKEN, () => title);
	if (title.trim() !== "" || !format.includes(TITLE_TOKEN)) return name.trim();
	return name.replace(EDGE_SEPARATORS, "");
}

function escapeRegex(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Number and title of a name written in the format, or null if it doesn't match
export function parseChapterName(name: string, format: string): { number: number; title: string } | null {
	if (!format.includes(NUMBER_TOKEN)) return null;
	// Literal parts escaped; the tokens become groups (in their order in the format)
	const parts = format.split(/(\{number\}|\{title\})/);
	const tokens: string[] = [];
	const pattern = parts
		.map((part) => {
			if (part === NUMBER_TOKEN || part === TITLE_TOKEN) {
				tokens.push(part);
				return part === NUMBER_TOKEN ? "(\\d+)" : "(.*)";
			}
			return escapeRegex(part);
		})
		.join("");
	const match = new RegExp(`^${pattern}$`).exec(name.trim());
	if (!match) return null;
	let number = NaN;
	let title = "";
	tokens.forEach((token, i) => {
		if (token === NUMBER_TOKEN) number = Number(match[i + 1]);
		else title = match[i + 1].trim();
	});
	return Number.isFinite(number) ? { number, title } : null;
}

// Title of a name that isn't in the format: drops a leading "Chapter 3 -", "03." and the like
export function guessTitle(name: string): string {
	return name
		.replace(/^\s*(?:(?:chapter|chap\.?|ch\.?|part)\s*)?\d+\s*(?:[-–—:.)_]\s*)?/i, "")
		.trim();
}

// ====== Plans ======

// A chapter going into a plan
export interface NumberingEntry {
	path: string; // Current path
	name: string; // Current file name, without ".md"
	folder: string; // Folder it ends up in (its own, unless it's being moved)
	excluded: boolean; // Should be left out of numbering
	hasMarker: boolean; // The marker is in its frontmatter now (any value)
	marker?: number; // Current marker value, if it's a number
	title?: string; // Title to use instead of the one read from the name (rename, new chapter)
}

// A group in display order; its entries are in the order they should end up in
export interface NumberingGroup {
	key: string;
	isOther: boolean;
	entries: NumberingEntry[];
}

// Result for one chapter
export interface NumberingRow {
	path: string;
	groupKey: string;
	oldName: string;
	newName: string;
	newPath: string;
	number: number | null; // Its number, or null when unnumbered or skipped
	skipped: boolean; // In a group that isn't numbered ("Other")
	newMarker: number | null | undefined; // New marker value; null removes it, undefined leaves it
	duplicate: boolean; // Another chapter ends up with the same path
}

export interface NumberingPlan {
	rows: NumberingRow[];
	changes: NumberingRow[]; // Rows that rename, move or change the marker
	hasDuplicates: boolean;
}

// The sort key inside a group: the number, the marker for unnumbered chapters, else last
function orderKey(entry: NumberingEntry, format: string): number {
	if (entry.excluded) return entry.marker ?? Infinity;
	return parseChapterName(entry.name, format)?.number ?? Infinity;
}

// Sorts a group's chapters by their current numbering (names in the format, markers)
export function sortGroupEntries<T extends NumberingEntry>(entries: T[], format: string): T[] {
	return entries
		.map((entry) => ({ entry, key: orderKey(entry, format) }))
		.sort((a, b) => {
			if (a.key !== b.key) return a.key < b.key ? -1 : 1;
			return naturalCompare(a.entry.name, b.entry.name);
		})
		.map(({ entry }) => entry);
}

// Title of an entry: given, read with the current format, or guessed
function titleOf(entry: NumberingEntry, parseFormat: string): string {
	if (entry.title !== undefined) return entry.title.trim();
	return parseChapterName(entry.name, parseFormat)?.title ?? guessTitle(entry.name);
}

// Marker values for a run of unnumbered chapters after chapter `after`: 3.1, 3.2… (finer when long)
function markerValues(after: number, count: number): number[] {
	const step = count <= 9 ? 0.1 : count <= 99 ? 0.01 : 0.001;
	return Array.from({ length: count }, (_, i) => Math.round((after + (i + 1) * step) * 1000) / 1000);
}

// Names, numbers and markers for every chapter, keeping the given order
export function planNumbering(
	groups: NumberingGroup[],
	parseFormat: string, // Format the names are currently written in
	options: NumberingOptions,
	caseSensitive = false, // Whether "namer" and "Namer" are different files (Linux)
): NumberingPlan {
	const rows: NumberingRow[] = [];
	let counter = 0; // Last number given out

	for (const group of groups) {
		const skipped = group.isOther && options.skipOther;
		if (options.perFolder && !skipped) counter = 0;
		const groupRows: NumberingRow[] = [];
		// Unnumbered chapters waiting for their markers: the number they follow, and the rows
		let run: { after: number; rows: { row: NumberingRow; entry: NumberingEntry }[] } = {
			after: counter,
			rows: [],
		};
		const flushRun = () => {
			const values = markerValues(run.after, run.rows.length);
			run.rows.forEach(({ row, entry }, i) => {
				// Only written when it differs from what's there
				row.newMarker = entry.hasMarker && entry.marker === values[i] ? undefined : values[i];
			});
		};

		for (const entry of group.entries) {
			let newName: string;
			let number: number | null = null;
			let newMarker: number | null | undefined = undefined;
			if (skipped || entry.excluded) {
				// Unnumbered: keep the name, but drop a number this plugin wrote (moved here, or just excluded)
				const parsed = parseChapterName(entry.name, parseFormat);
				newName = entry.title?.trim() || (parsed ? parsed.title || entry.name : entry.name);
			} else {
				counter++;
				number = counter;
				newName = formatChapterName(options.format, counter, options.digits, titleOf(entry, parseFormat));
				if (entry.hasMarker) newMarker = null; // Numbered again: the marker goes
			}
			const row: NumberingRow = {
				path: entry.path,
				groupKey: group.key,
				oldName: entry.name,
				newName,
				newPath: entry.folder ? `${entry.folder}/${newName}.md` : `${newName}.md`,
				number,
				skipped,
				newMarker,
				duplicate: false,
			};
			groupRows.push(row);

			if (skipped) continue; // Markers in a skipped group are left alone
			if (entry.excluded) {
				run.rows.push({ row, entry });
			} else {
				flushRun();
				run = { after: counter, rows: [] };
			}
		}
		if (!skipped) flushRun();
		rows.push(...groupRows);
	}

	// Two chapters with the same final path (ignoring case, unless the file system doesn't)
	const byPath = new Map<string, NumberingRow[]>();
	for (const row of rows) {
		const key = caseSensitive ? row.newPath : row.newPath.toLowerCase();
		byPath.set(key, [...(byPath.get(key) ?? []), row]);
	}
	let hasDuplicates = false;
	for (const same of byPath.values()) {
		if (same.length < 2) continue;
		hasDuplicates = true;
		same.forEach((row) => (row.duplicate = true));
	}

	const changes = rows.filter((row) => row.newPath !== row.path || row.newMarker !== undefined);
	return { rows, changes, hasDuplicates };
}
