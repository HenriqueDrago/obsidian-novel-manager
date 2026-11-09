// Small helpers: path checks, sorting, IDs and filename cleanup
import { App, normalizePath, Platform, TAbstractFile, TFile, TFolder } from "obsidian";

// Whether a file is inside a folder (at any depth)
export function isFileInFolder(file: TFile, folderPath: string): boolean {
	if (!folderPath || folderPath.trim() === "") return false;
	const normalizedFilePath = normalizePath(file.path);
	let normalizedFolderPath = normalizePath(folderPath);

	// Trailing slash so "Novel" doesn't match "Novel 2"
	if (!normalizedFolderPath.endsWith("/")) {
		normalizedFolderPath += "/";
	}
	return normalizedFilePath.startsWith(normalizedFolderPath);
}

// Natural sort so "Chapter 2" comes before "Chapter 10"
export function naturalCompare(a: string, b: string): number {
	return a.localeCompare(b, undefined, { numeric: true });
}

// Generates a unique project ID
export function generateId(): string {
	// Random suffix so IDs made in the same millisecond still differ
	return `novel-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

// Removes characters that aren't allowed in file names
export function sanitizeFileName(name: string): string {
	return name.replace(/[\\/:*?"<>|]/g, "");
}

// Group key for chapters directly in the project folder (the "Other" group)
export const OTHER_GROUP_KEY = ""; // Folder names are never empty, so no collision

// First-level subfolder of a chapter, or OTHER_GROUP_KEY
export function getChapterGroupKey(file: TFile, projectPath: string): string {
	let root = normalizePath(projectPath);
	if (!root.endsWith("/")) root += "/";
	const parts = normalizePath(file.path).substring(root.length).split("/");
	return parts.length > 1 ? parts[0] : OTHER_GROUP_KEY;
}

// Sorts chapters in display order (shared by the table and next/previous navigation)
export function sortChapters(files: TFile[], projectPath: string): TFile[] {
	return files.sort((a, b) => {
		const groupA = getChapterGroupKey(a, projectPath);
		const groupB = getChapterGroupKey(b, projectPath);
		// Subfolder groups first, "Other" last
		if (groupA !== groupB) {
			if (groupA === OTHER_GROUP_KEY) return 1;
			if (groupB === OTHER_GROUP_KEY) return -1;
			return naturalCompare(groupA, groupB);
		}
		return naturalCompare(a.path, b.path); // Then by path within the group
	});
}

// Whether the vault's drive tells "namer" and "Namer" apart. Guessed from the platform
// (Linux yes; macOS, Windows and mobile no) until detectCaseSensitivity tests the drive.
let caseSensitive = Platform.isLinux;

export function isCaseSensitiveFileSystem(): boolean {
	return caseSensitive;
}

// Tests the vault's drive: the config folder (".obsidian") also answers to ".OBSIDIAN" only where
// case is ignored. Keeps the platform guess if the test fails.
export async function detectCaseSensitivity(app: App): Promise<void> {
	const dir = app.vault.configDir;
	const swapped = Array.from(dir, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join("");
	if (swapped === dir) return; // No letters to swap
	try {
		caseSensitive = !(await app.vault.adapter.exists(swapped));
	} catch (error) {
		console.error("Could not test the vault's case sensitivity:", error);
	}
}

// The file or folder at a path, or at the same path in another letter case where the drive ignores case
export function findPathOccupant(app: App, path: string): TAbstractFile | null {
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing || caseSensitive) return existing;
	const slash = path.lastIndexOf("/");
	const parent = app.vault.getAbstractFileByPath(slash === -1 ? "/" : path.slice(0, slash));
	if (!(parent instanceof TFolder)) return null;
	const lower = path.toLowerCase();
	return parent.children.find((child) => child.path.toLowerCase() === lower) ?? null;
}

// Whether a path is taken by another file or folder (any letter case where the drive ignores it)
export function isPathTaken(app: App, path: string, except?: TFile): boolean {
	const occupant = findPathOccupant(app, path);
	return occupant !== null && occupant !== except;
}

// Another file whose path differs only in letter case (only possible where the drive allows it)
export function findCaseVariant(app: App, path: string, except?: TFile): string | null {
	if (!caseSensitive) return null; // There it's the same name, so it's taken
	const slash = path.lastIndexOf("/");
	const parent = app.vault.getAbstractFileByPath(slash === -1 ? "/" : path.slice(0, slash));
	if (!(parent instanceof TFolder)) return null;
	const lower = path.toLowerCase();
	const variant = parent.children.find(
		(child) => child !== except && child.path !== path && child.path.toLowerCase() === lower,
	);
	return variant ? variant.name : null;
}

// A file name from the first words of a note's first line with text: no markdown, link-breaking or invalid characters, no
// leading or trailing dots (hidden files, Windows). "" when nothing usable is left.
export function titleFromText(text: string, maxWords = 6, maxLength = 50): string {
	const plain = text
		.replace(/^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/, "") // Frontmatter
		.replace(/!\[\[[^\]]*\]\]/g, "") // Embeds
		.replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2") // [[target|alias]] -> alias
		.replace(/\[\[([^\]]*)\]\]/g, "$1") // [[target]] -> target
		.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // [text](url) -> text
		.replace(/^[ \t]*(#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(\[.\][ \t]+)?|\d+[.)][ \t]+)/gm, "") // Line markers
		.replace(/[#^[\]|*_~=`]/g, ""); // Break links, or are emphasis marks
	const firstLine = sanitizeFileName(plain).split("\n").find((line) => line.trim() !== "") ?? "";
	const words = firstLine.split(/\s+/).filter(Boolean);
	let title = "";
	for (const word of words.slice(0, maxWords)) {
		const next = title ? `${title} ${word}` : word;
		if (next.length > maxLength) break;
		title = next;
	}
	if (!title && words.length > 0) title = words[0].slice(0, maxLength); // One very long word
	return title.replace(/^[.\s]+|[.\s]+$/g, "");
}

// A free path for a new note: "<name>.md", else "<name> 2.md", "<name> 3.md"…
// (also skips names that differ from another file's only in letter case)
export function uniqueFilePath(app: App, folderPath: string, baseName: string): string {
	for (let i = 1; ; i++) {
		const path = normalizePath(`${folderPath}/${i === 1 ? baseName : `${baseName} ${i}`}.md`);
		if (!isPathTaken(app, path) && !findCaseVariant(app, path)) return path;
	}
}
