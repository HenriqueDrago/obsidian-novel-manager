// Small helpers: path checks, sorting, IDs and filename cleanup
import { normalizePath, TFile } from "obsidian";

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
