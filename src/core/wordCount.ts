// Word and character counting, pages, and formatting (no Obsidian imports, testable in Node)

// chapters = everywhere, groups = headers only, chapters-only = rows only
export const WORD_COUNT_GRANULARITIES = ["chapters", "groups", "chapters-only"] as const;
export type WordCountGranularity = (typeof WORD_COUNT_GRANULARITIES)[number];
export const WORD_COUNT_FORMATS = ["short", "exact"] as const;
export type WordCountFormat = (typeof WORD_COUNT_FORMATS)[number];
export const WORD_COUNT_UNITS = ["words", "characters", "pages"] as const;
export type WordCountUnit = (typeof WORD_COUNT_UNITS)[number];

export const DEFAULT_WORDS_PER_PAGE = 300;

// Han, kana and hangul: each character counts as a word (as in Obsidian's count)
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const HAS_WORD_CHAR = /[\p{L}\p{N}]/u;

export interface TextCounts {
	words: number;
	characters: number; // Prose characters, spaces between words included
}

// The chapter's prose: no frontmatter, hidden text or link syntax.
// With a start marker, only the text after its first occurrence (all of it if it's missing).
function proseOf(markdown: string, startMarker: string): string {
	let body = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, ""); // Frontmatter
	// Before the other removals, so a marker inside a comment (e.g. %%start%%) is found
	if (startMarker) {
		const index = body.indexOf(startMarker);
		if (index !== -1) body = body.slice(index + startMarker.length);
	}
	return body
		.replace(/%%[\s\S]*?%%/g, "") // Obsidian comments
		.replace(/<!--[\s\S]*?-->/g, "") // HTML comments
		.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "") // Fenced code blocks
		.replace(/!\[\[[^\]]*\]\]/g, "") // Embeds
		.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2") // [[target|alias]] -> alias
		.replace(/\[\[([^\]]*)\]\]/g, "$1") // [[target]] -> target
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1"); // [text](url) -> text
}

// Words and characters of a chapter's prose
export function countText(markdown: string, startMarker = ""): TextCounts {
	const text = proseOf(markdown, startMarker);

	const cjkCount = text.match(CJK)?.length ?? 0;
	// The rest: whitespace-separated tokens with at least one letter or digit (skips #, -, >, *)
	const otherCount = text
		.replace(CJK, " ")
		.split(/\s+/)
		.filter((token) => HAS_WORD_CHAR.test(token)).length;

	// Characters: without markdown markers, line breaks and runs of spaces count as one space
	const plain = text
		.replace(/^[ \t]*(#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+|[-*_]{3,}[ \t]*$)/gm, "") // Line markers
		.replace(/[*_~=`]/g, "") // Emphasis, highlight and code marks
		.replace(/\s+/g, " ")
		.trim();
	// Array.from counts emoji and other surrogate pairs as one character
	return { words: cjkCount + otherCount, characters: Array.from(plain).length };
}

// The number to show for a unit; pages come from words
export function countInUnit(counts: TextCounts, unit: WordCountUnit, wordsPerPage: number): number {
	if (unit === "characters") return counts.characters;
	if (unit === "pages") return counts.words / wordsPerPage;
	return counts.words;
}

const shortFormat = new Intl.NumberFormat(undefined, {
	notation: "compact",
	maximumFractionDigits: 1,
});
const pageFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

// "3.9K" (locale-aware; exact below 1,000) or "3,912"; pages always with one decimal
export function formatWordCount(count: number, format: WordCountFormat, unit: WordCountUnit = "words"): string {
	if (unit === "pages") return pageFormat.format(count);
	return format === "short" ? shortFormat.format(count) : count.toLocaleString();
}

// "words", "characters", "pages" (singular for exactly 1)
export function unitLabel(count: number, unit: WordCountUnit): string {
	if (count === 1) return unit.slice(0, -1);
	return unit;
}
