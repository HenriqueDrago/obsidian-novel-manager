// Project and chapter logic: lookups and chapter file operations (plain functions)
import { App, Notice, normalizePath, TFile, TFolder } from "obsidian";
import { NovelChapterPluginSettings, NovelProject } from "../settings";
import {
	getChapterGroupKey,
	isFileInFolder,
	naturalCompare,
	OTHER_GROUP_KEY,
	generateId,
	sanitizeFileName,
	sortChapters,
} from "./utils";
import { defaultValueYaml } from "./property";
import { sortGroupEntries, UNNUMBERED_KEY } from "./numbering";

// Helper function for getting files
export function getMarkdownFilesInFolder(app: App, folderPath: string): TFile[] {
	const folder = app.vault.getAbstractFileByPath(
		normalizePath(folderPath),
	);
	const files: TFile[] = [];

	if (folder instanceof TFolder) {
		const recurse = (currentFolder: TFolder) => {
			for (const child of currentFolder.children) {
				if (child instanceof TFile && child.extension === "md") {
					files.push(child);
				} else if (child instanceof TFolder) {
					recurse(child);
				}
			}
		};
		recurse(folder);
	}
	return files;
}

// A project's fragments folder, or null when fragments are off
export function getFragmentsPath(
	settings: NovelChapterPluginSettings,
	project: NovelProject,
): string | null {
	if (!settings.enableFragments) return null;
	const custom = project.fragmentsPath?.trim();
	if (custom) return normalizePath(custom);
	// Empty falls back to "<chapters path>/Fragments", as the settings placeholder shows
	const base = project.path?.trim();
	return base ? normalizePath(`${base}/Fragments`) : null;
}

// Whether a file is a chapter of the project
export function isChapterOf(
	settings: NovelChapterPluginSettings,
	file: TFile,
	project: NovelProject,
): boolean {
	if (!project.path || !isFileInFolder(file, project.path)) return false;
	// Fragments inside the chapters folder aren't chapters
	const fragmentsPath = getFragmentsPath(settings, project);
	return !(fragmentsPath && isFileInFolder(file, fragmentsPath));
}

// Whether a folder is the project's fragments folder
export function isFragmentsFolder(
	settings: NovelChapterPluginSettings,
	folderPath: string,
	project: NovelProject,
): boolean {
	return normalizePath(folderPath) === getFragmentsPath(settings, project);
}

// Helper to get sorted chapters for a given project
export function getProjectChapters(
	app: App,
	settings: NovelChapterPluginSettings,
	project: NovelProject,
): TFile[] {
	if (!project.path || project.path.trim() === "") return [];

	// Same order as the table: subfolder groups first, "Other" last, natural sort
	const files = sortChapters(
		getMarkdownFilesInFolder(app, project.path).filter((file) =>
			isChapterOf(settings, file, project),
		),
		project.path,
	);
	if (!settings.autoNumbering) return files;

	// With numbering, each group follows its numbers (and unnumbered chapters their markers)
	const ordered: TFile[] = [];
	let start = 0;
	while (start < files.length) {
		const key = getChapterGroupKey(files[start], project.path);
		let end = start;
		while (end < files.length && getChapterGroupKey(files[end], project.path) === key) end++;
		const group = files.slice(start, end);
		if (key === OTHER_GROUP_KEY && settings.numberSkipOther) {
			ordered.push(...group); // Not numbered: by name
		} else {
			const entries = group.map((file) => ({
				file,
				path: file.path,
				name: file.basename,
				folder: file.parent?.path ?? "",
				...readNumberingMarker(app, file),
			}));
			ordered.push(...sortGroupEntries(entries, settings.numberFormat).map((entry) => entry.file));
		}
		start = end;
	}
	return ordered;
}

// A chapter's "unnumbered" marker: whether it's there, and its value when it's a number
export function readNumberingMarker(
	app: App,
	file: TFile,
): { excluded: boolean; hasMarker: boolean; marker?: number } {
	const frontmatter = app.metadataCache.getFileCache(file)?.frontmatter;
	if (!frontmatter || !Object.prototype.hasOwnProperty.call(frontmatter, UNNUMBERED_KEY)) {
		return { excluded: false, hasMarker: false };
	}
	const value: unknown = frontmatter[UNNUMBERED_KEY];
	const marker = typeof value === "number" && Number.isFinite(value) ? value : undefined;
	return { excluded: true, hasMarker: true, marker };
}

// Order of the fragments feed
export type FragmentSort = "newest" | "oldest" | "name";
export const FRAGMENT_SORTS: readonly FragmentSort[] = ["newest", "oldest", "name"];

// Helper to get sorted fragments for a given project path
export function getProjectFragments(
	app: App,
	fragmentsPath: string,
	order: FragmentSort = "newest",
): TFile[] {
	if (!fragmentsPath || fragmentsPath.trim() === "") return [];

	const fragmentFiles = getMarkdownFilesInFolder(app, fragmentsPath);
	fragmentFiles.sort((a, b) => {
		if (order === "name") return naturalCompare(a.basename, b.basename);
		if (order === "oldest") return a.stat.mtime - b.stat.mtime;
		return b.stat.mtime - a.stat.mtime;
	});
	return fragmentFiles;
}

// Method to move a chapter file to a new folder
export async function moveChapter(
	app: App,
	fileToMove: TFile,
	destinationFolderPath: string,
): Promise<void> {
	// Create the new path for the file in the destination folder
	const newPath = normalizePath(
		`${destinationFolderPath}/${fileToMove.name}`,
	);

	// Check if the file is already in the destination folder
	if (fileToMove.path === newPath) {
		new Notice("Chapter is already in that folder.");
		return;
	}

	// Check if the destination folder exists
	if (await app.vault.adapter.exists(newPath)) {
		new Notice(
			`A file named "${fileToMove.name}" already exists in the destination.`,
		);
		return;
	}

	// Attempt to rename (move) the file to the new path
	try {
		await app.fileManager.renameFile(fileToMove, newPath);
		new Notice(`Moved "${fileToMove.basename}" successfully.`);
	} catch (error) {
		console.error("Error moving chapter:", error);
		new Notice("Failed to move chapter. See console for details.");
	}
}

// Display name of a chapter group; a subfolder named like "Other" is marked so the two differ
export function getGroupDisplayName(
	settings: NovelChapterPluginSettings,
	groupKey: string,
): string {
	const otherName = settings.otherGroupName || "Other";
	if (groupKey === OTHER_GROUP_KEY) return otherName;
	return groupKey.trim().toLowerCase() === otherName.trim().toLowerCase()
		? `${groupKey} (folder)`
		: groupKey;
}

// What a typed new-folder name would do, for the dialog's warning
export type NewFolderStatus = "new" | "invalid" | "fragments" | "other-name" | "exists";
export function getNewFolderStatus(
	app: App,
	settings: NovelChapterPluginSettings,
	project: NovelProject,
	folderName: string,
): NewFolderStatus {
	const sanitized = sanitizeFileName(folderName).trim();
	if (!sanitized || sanitized === "." || sanitized === "..") return "invalid";
	const folderPath = normalizePath(`${project.path}/${sanitized}`);
	if (folderPath === getFragmentsPath(settings, project)) return "fragments";
	// Same name as the "Other" group: shown marked, as "<name> (folder)"
	if (getGroupDisplayName(settings, sanitized) !== sanitized) return "other-name";
	if (app.vault.getAbstractFileByPath(folderPath) instanceof TFolder) return "exists";
	return "new";
}

// Moves a chapter into a subfolder of the project folder, creating it if needed
export async function moveChapterToNewFolder(
	app: App,
	settings: NovelChapterPluginSettings,
	project: NovelProject,
	file: TFile,
	folderName: string,
	// How to move it there (numbering moves and renames in one step)
	move: (file: TFile, folderPath: string) => Promise<void> = (f, path) => moveChapter(app, f, path),
): Promise<void> {
	const sanitized = sanitizeFileName(folderName).trim();
	// "." and ".." would point at the project folder or above it
	if (!sanitized || sanitized === "." || sanitized === "..") {
		new Notice("Invalid folder name.");
		return;
	}
	const folderPath = normalizePath(`${project.path}/${sanitized}`);

	// Chapters in the fragments folder would vanish from the list
	if (folderPath === getFragmentsPath(settings, project)) {
		new Notice("That's the fragments folder.");
		return;
	}

	// An existing folder (e.g. another group's) is simply moved into
	if (!(await app.vault.adapter.exists(folderPath))) {
		try {
			await app.vault.createFolder(folderPath);
		} catch (error) {
			console.error("Error creating chapter folder:", error);
			new Notice(`Failed to create folder "${folderPath}".`);
			return;
		}
	}
	await move(file, folderPath);
}

// Helper to find which project a file belongs to (as a chapter, or also as a fragment)
export function findProjectForFile(
	settings: NovelChapterPluginSettings,
	file: TFile,
	includeFragments = false,
): NovelProject | null {
	if (!file) return null; // If no file is provided, return null
	let best: NovelProject | null = null;
	let bestDepth = -1;
	for (const project of settings.novelProjects) {
		const fragmentsPath = includeFragments ? getFragmentsPath(settings, project) : null;
		const matches =
			isChapterOf(settings, file, project) ||
			(!!fragmentsPath && isFileInFolder(file, fragmentsPath));
		// Nested project folders: the deepest match wins
		const depth = normalizePath(project.path).length;
		if (matches && depth > bestDepth) {
			best = project;
			bestDepth = depth;
		}
	}
	return best;
}

// Updates a chapter's frontmatter property, with Undo
export async function updateChapterProperty(
	app: App,
	file: TFile,
	propertyName: string,
	newValue: unknown, // An option's value, a checkbox state, or "" to remove the property
): Promise<void> {
	const previous = { existed: false, value: undefined as unknown };
	try {
		// If the new value is empty, delete the property from frontmatter
		await app.fileManager.processFrontMatter(
			file,
			(fm: Record<string, unknown>) => {
				previous.existed = Object.prototype.hasOwnProperty.call(
					fm,
					propertyName,
				);
				previous.value = fm[propertyName];
				if (newValue === "") {
					delete fm[propertyName];
				} else {
					fm[propertyName] = newValue;
				}
			},
		);
	} catch (error) {
		console.error(`Error updating frontmatter for ${file.path}:`, error);
		new Notice(`Failed to update ${propertyName} for ${file.basename}.`);
		return;
	}

	// Success notice with an Undo button
	const notice = new Notice(
		createFragment((frag) => {
			frag.createSpan({
				text: `Chapter '${file.basename}' ${propertyName} updated. `,
			});
			const undoButton = frag.createEl("button", { text: "Undo" });
			undoButton.addEventListener("click", (event) => {
				event.stopPropagation();
				notice.hide();
				void restoreChapterProperty(app,
					file,
					propertyName,
					previous.existed,
					previous.value,
				);
			});
		}),
		8000,
	);
}

// Undo for updateChapterProperty
async function restoreChapterProperty(
	app: App,
	file: TFile,
	propertyName: string,
	existed: boolean,
	value: unknown,
): Promise<void> {
	try {
		await app.fileManager.processFrontMatter(
			file,
			(fm: Record<string, unknown>) => {
				if (existed) {
					fm[propertyName] = value;
				} else {
					delete fm[propertyName];
				}
			},
		);
		new Notice(`Chapter '${file.basename}' ${propertyName} restored.`);
	} catch (error) {
		console.error(`Error restoring frontmatter for ${file.path}:`, error);
		new Notice(`Failed to restore ${propertyName} for ${file.basename}.`);
	}
}

// Logic to rename a chapter file
export async function renameChapter(app: App, file: TFile, newName: string): Promise<void> {
	// Sanitize the new chapter name to remove invalid characters
	const sanitizedFileName = sanitizeFileName(newName).trim();

	// Check if the sanitized name is empty
	if (sanitizedFileName === "") {
		new Notice("Invalid chapter name provided.");
		return;
	}

	// Check if the file has a parent folder
	if (!file.parent) {
		new Notice("Cannot rename file: No parent folder found.");
		console.error("Could not find parent for file:", file.path);
		return;
	}

	// Create the new path for the renamed file
	const newPath = `${file.parent.path}/${sanitizedFileName}.md`;

	// Check if a file with the new name already exists
	// (case-only renames "exist" on case-insensitive file systems)
	const isCaseOnlyRename =
		normalizePath(newPath).toLowerCase() === file.path.toLowerCase();
	if (
		!isCaseOnlyRename &&
		(await app.vault.adapter.exists(normalizePath(newPath)))
	) {
		new Notice(
			`A chapter named "${sanitizedFileName}.md" already exists.`,
		);
		return;
	}

	// Attempt to rename the file using the file manager
	try {
		await app.fileManager.renameFile(file, newPath);
		new Notice(`Chapter renamed to "${sanitizedFileName}".`);
	} catch (error) {
		console.error("Error renaming file:", error);
		new Notice("Failed to rename chapter. See console for details.");
	}
}

// Logic to delete the chapter file
export async function deleteChapter(app: App, file: TFile): Promise<void> {
	// Try to move the file to the trash
	try {
		await app.fileManager.trashFile(file);
		new Notice(`Chapter "${file.basename}" moved to trash.`);
	} catch (error) {
		console.error("Error deleting file:", error);
		new Notice("Failed to delete chapter. See console for details.");
	}
}

// Opens the previous or next chapter (toolbar buttons and commands)
export function openAdjacentChapter(
	app: App,
	settings: NovelChapterPluginSettings,
	direction: "previous" | "next",
	requireProjectId?: string | null, // Toolbar only: the chapter must be in this project
): void {
	// Get the currently active file in the workspace
	const currentFile = app.workspace.getActiveFile();
	// If no file is open, show a notice
	if (!currentFile) {
		new Notice("Open a chapter file to use navigation.");
		return;
	}
	// Find the project for the current file
	const project = findProjectForFile(settings, currentFile);
	// If the project is not found or doesn't match the required project, show a notice
	if (
		!project ||
		(requireProjectId !== undefined && project.id !== requireProjectId)
	) {
		new Notice("The active chapter doesn't belong to the selected project.");
		return;
	}
	// Get the chapters for the current project and find the current one
	const chapters = getProjectChapters(app, settings, project);
	const currentIndex = chapters.findIndex(
		(chap) => chap.path === currentFile.path,
	);

	// -1 when there is no previous/next chapter
	const targetIndex =
		direction === "previous"
			? currentIndex > 0
				? currentIndex - 1
				: -1
			: currentIndex !== -1 && currentIndex < chapters.length - 1
				? currentIndex + 1
				: -1;

	if (targetIndex === -1) {
		new Notice(
			direction === "previous"
				? "This is the first chapter."
				: "This is the last chapter.",
		);
		return;
	}
	app.workspace
		.openLinkText(chapters[targetIndex].path, "", false)
		.catch(console.error);
}

// Folders a new chapter can be created in
export function getChapterFolderOptions(
	app: App,
	settings: NovelChapterPluginSettings,
	currentNovelProject: NovelProject,
): { name: string; path: string }[] {
	const projectRootPath = normalizePath(currentNovelProject.path);
	const projectFolder =
		app.vault.getAbstractFileByPath(projectRootPath);

	// Create a list to hold the folder choices for the dropdown.
	const folderOptions: { name: string; path: string }[] = [];

	// The first option is always the project's root folder (other group)
	folderOptions.push({
		name: getGroupDisplayName(settings, OTHER_GROUP_KEY),
		path: projectRootPath,
	});

	// If the project folder exists, look for subfolders inside it.
	if (projectFolder instanceof TFolder) {
		for (const child of projectFolder.children) {
			if (
				child instanceof TFolder &&
				!isFragmentsFolder(settings, child.path, currentNovelProject)
			) {
				// Add each subfolder (except the fragments folder) to our list of options.
				folderOptions.push({
					name: getGroupDisplayName(settings, child.name),
					path: child.path,
				});
			}
		}
	}

	// Subfolders in natural order ("Act 2" before "Act 10"), after the project folder
	const [root, ...subfolders] = folderOptions;
	subfolders.sort((a, b) => naturalCompare(a.name, b.name));
	return [root, ...subfolders];
}

// Folder option holding the active chapter, if it's in the project
export function getActiveChapterFolder(
	app: App,
	settings: NovelChapterPluginSettings,
	project: NovelProject,
): string | undefined {
	const activeFile = app.workspace.getActiveFile();
	if (!activeFile || !isChapterOf(settings, activeFile, project)) return undefined;

	return getGroupFolderPath(project, getChapterGroupKey(activeFile, project.path));
}

// Folder of a chapter group: its first-level subfolder, or the project folder for "Other"
export function getGroupFolderPath(project: NovelProject, groupKey: string): string {
	return groupKey === OTHER_GROUP_KEY
		? normalizePath(project.path)
		: normalizePath(`${project.path}/${groupKey}`);
}

// Renames a chapter group's folder (links are updated); returns false if it didn't happen
export async function renameChapterFolder(
	app: App,
	folder: TFolder,
	newName: string,
): Promise<boolean> {
	const sanitized = sanitizeFileName(newName).trim();
	if (!sanitized) {
		new Notice("Invalid folder name.");
		return false;
	}
	if (sanitized === folder.name) return false;

	// Folders at the vault root have parent path "/", which must not be prefixed
	const parentPath = folder.parent?.path ?? "/";
	const newPath = normalizePath(
		parentPath === "/" ? sanitized : `${parentPath}/${sanitized}`,
	);

	// Case-only renames "exist" on case-insensitive file systems
	const isCaseOnlyRename = newPath.toLowerCase() === folder.path.toLowerCase();
	if (!isCaseOnlyRename && (await app.vault.adapter.exists(newPath))) {
		new Notice(`A folder named "${sanitized}" already exists.`);
		return false;
	}
	try {
		await app.fileManager.renameFile(folder, newPath);
		return true;
	} catch (error) {
		console.error("Error renaming folder:", error);
		new Notice("Failed to rename folder. See console for details.");
		return false;
	}
}

// Creates a chapter file in the given folder, from the template if one is configured
export async function createChapter(
	app: App,
	settings: NovelChapterPluginSettings,
	selectedFolderPath: string,
	chapterName: string,
	// With numbering: the title for {{title}} (the name holds the number) and the number for {{number}}
	numbering?: { title: string; number: number | null; marker: number | null },
): Promise<boolean> {
	const title = numbering?.title ?? chapterName;
	const numberText = numbering?.number != null ? String(numbering.number) : "";
	// Sanitize the chapter name to remove invalid characters
	const sanitizedFileName = sanitizeFileName(chapterName)
		.trim();
	if (sanitizedFileName === "") {
		new Notice("Invalid chapter name.");
		return false;
	}

	// Create the folder if it doesn't exist yet
	if (!(await app.vault.adapter.exists(normalizePath(selectedFolderPath)))) {
		try {
			await app.vault.createFolder(normalizePath(selectedFolderPath));
		} catch (error) {
			console.error("Error creating chapter folder:", error);
			new Notice(`Failed to create folder "${selectedFolderPath}".`);
			return false;
		}
	}

	// Create the full file path for the new chapter
	const filePath = normalizePath(
		`${selectedFolderPath}/${sanitizedFileName}.md`,
	);

	// Check if a file with the same name already exists
	if (await app.vault.adapter.exists(filePath)) {
		new Notice(
			`A chapter named "${sanitizedFileName}.md" already exists.`,
		);
		return false;
	}

	// Prepare the content for the new chapter file
	let fileContent = "";

	// If a chapter template path is configured, read the template file
	const templatePath =
		settings.chapterTemplatePath?.trim();
	if (templatePath) {
		// Normalize the template path to ensure it is valid
		const normalizedTemplatePath =
			normalizePath(templatePath);

		// Get the template file from the vault
		const templateFile =
			app.vault.getAbstractFileByPath(
				normalizedTemplatePath,
			);

		// Check if the template file exists and is a TFile
		if (templateFile instanceof TFile) {
			// Read the content of the template file
			fileContent =
				await app.vault.read(templateFile);

			// Replace placeholders in the template with the chapter name and current date
			const today = new Date();
			const formattedDate = `${today.getFullYear()}-${String(
				today.getMonth() + 1,
			).padStart(2, "0")}-${String(
				today.getDate(),
			).padStart(2, "0")}`;
			// Function replacers so "$" in names isn't treated as a replacement pattern
			fileContent = fileContent.replace(
				/\{\{title\}\}/gi,
				() => title,
			);
			fileContent = fileContent.replace(
				/\{\{number\}\}/gi,
				() => numberText,
			);
			fileContent = fileContent.replace(
				/\{\{date\}\}/gi,
				() => formattedDate,
			);
		} else {
			new Notice(
				`Template file not found at "${templatePath}". Creating a default chapter.`,
			);
		}
	}

	// No template (or an empty one): default chapter structure
	if (fileContent === "") {
		const { propertyNameToChange } = settings;
		// JSON string = valid YAML double-quoted scalar, safe for ":" , "#", quotes, etc.
		fileContent = `---\ntitle: ${JSON.stringify(title)}\n`;
		if (propertyNameToChange)
			fileContent += `${propertyNameToChange}: ${defaultValueYaml(settings.propertyType)}\n`;
		fileContent += `---\n\n# ${title}\n\n`;
	}

	// Attempt to create the new chapter file in the vault
	try {
		const file = await app.vault.create(filePath, fileContent);
		// Unnumbered: its position goes in the frontmatter
		const marker = numbering?.marker;
		if (marker != null) {
			await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				fm[UNNUMBERED_KEY] = marker;
			});
		}
		new Notice(
			`Chapter "${sanitizedFileName}" created successfully.`,
		);
		return true;
	} catch (error) {
		console.error("Error creating new chapter:", error);
		new Notice(
			"Failed to create new chapter. Check console for details.",
		);
		return false;
	}
}

// Adds a novel project to the settings and returns it (the caller saves)
export function addNovelProject(
	settings: NovelChapterPluginSettings,
	fields: { name: string; path: string; fragmentsPath: string },
): NovelProject {
	const project: NovelProject = {
		id: generateId(),
		name: fields.name.trim(),
		path: fields.path.trim(),
		fragmentsPath: fields.fragmentsPath.trim(),
	};
	settings.novelProjects.push(project);
	return project;
}
