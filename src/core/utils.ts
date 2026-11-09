// Small helpers: path checks, sorting, IDs and filename cleanup
import { App, normalizePath, Platform, TFile, TFolder } from "obsidian";

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

// Linux file systems tell "namer" and "Namer" apart; macOS, Windows and mobile storage usually don't
export function isCaseSensitiveFileSystem(): boolean {
	return Platform.isLinux;
}

// Whether a path is taken by another file or folder (any letter case where the file system ignores it)
export function isPathTaken(app: App, path: string, except?: TFile): boolean {
	const existing = app.vault.getAbstractFileByPath(path);
	if (existing) return existing !== except;
	if (isCaseSensitiveFileSystem()) return false;
	const slash = path.lastIndexOf("/");
	const parent = app.vault.getAbstractFileByPath(slash === -1 ? "/" : path.slice(0, slash));
	if (!(parent instanceof TFolder)) return false;
	const lower = path.toLowerCase();
	return parent.children.some((child) => child !== except && child.path.toLowerCase() === lower);
}

// Another file whose path differs only in letter case (only possible where the file system allows it)
export function findCaseVariant(app: App, path: string, except?: TFile): string | null {
	if (!isCaseSensitiveFileSystem()) return null; // There it's the same name, so it's taken
	const slash = path.lastIndexOf("/");
	const parent = app.vault.getAbstractFileByPath(slash === -1 ? "/" : path.slice(0, slash));
	if (!(parent instanceof TFolder)) return null;
	const lower = path.toLowerCase();
	const variant = parent.children.find(
		(child) => child !== except && child.path !== path && child.path.toLowerCase() === lower,
	);
	return variant ? variant.name : null;
}
