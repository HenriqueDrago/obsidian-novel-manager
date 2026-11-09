// Chapter dialogs: ask the user, then call core/chapters
import { App, Notice, TFile, TFolder } from "obsidian";
import { NovelChapterPluginSettings, NovelProject } from "../settings";
import {
	createChapter,
	deleteChapter,
	findProjectForFile,
	getActiveChapterFolder,
	getCaseVariantWarning,
	getNameError,
	getChapterFolderOptions,
	getNewFolderStatus,
	moveChapterToNewFolder,
	readNumberingMarker,
	renameChapter,
	renameChapterFolder,
} from "../core/chapters";
import { guessTitle, NumberingPlan, parseChapterName } from "../core/numbering";
import {
	applyNumberingPlan,
	isGroupNumbered,
	moveChapterToGroup,
	planChapterRename,
	planNewChapter,
	renumberProject,
	setChapterExcluded,
	undoNumbering,
} from "../core/renumber";
import { getChapterGroupKey, sanitizeFileName } from "../core/utils";
import { ChapterNameModal } from "./ChapterNameModal";
import { ConfirmationModal } from "./ConfirmationModal";
import { NewChapterModal } from "./NewChapterModal";
import { NamePreview, RenameChapterModal } from "./RenameChapterModal";

// The project of a chapter in a numbered group, or null (numbering off, or the unnumbered "Other")
function numberedProjectOf(settings: NovelChapterPluginSettings, file: TFile): NovelProject | null {
	if (!settings.autoNumbering) return null;
	const project = findProjectForFile(settings, file);
	if (!project) return null;
	return isGroupNumbered(settings, getChapterGroupKey(file, project.path)) ? project : null;
}

// How many other chapters a plan renames, as a note for the name preview
function renumberNote(plan: NumberingPlan, ownPath: string | null): string | undefined {
	const others = plan.changes.filter((r) => r.path !== ownPath && r.newPath !== r.path).length;
	if (others === 0) return undefined;
	return `Renumbers ${others} other ${others === 1 ? "chapter" : "chapters"}.`;
}

// Asks for a new name, then renames the chapter
export async function promptAndRenameChapter(
	app: App,
	settings: NovelChapterPluginSettings,
	file: TFile,
): Promise<void> {
	const currentName = file.basename; // Get the current chapter name

	// Numbered chapters: edit the title, see the real name, choose whether it's numbered
	const project = numberedProjectOf(settings, file);
	if (project) {
		const { excluded } = readNumberingMarker(app, file);
		const initialTitle = excluded
			? currentName
			: parseChapterName(currentName, settings.numberFormat)?.title ?? guessTitle(currentName);
		const plan = (title: string, exclude: boolean) =>
			planChapterRename(app, settings, project, file, sanitizeFileName(title).trim(), exclude);
		new RenameChapterModal(app, {
			initialTitle,
			initialExcluded: excluded,
			preview: (title, exclude): NamePreview => {
				const result = plan(title, exclude);
				const row = result.rows.find((r) => r.path === file.path);
				return {
					name: row?.newName ?? "",
					error: row?.duplicate ? "Another chapter already has this name." : undefined,
					warning: row ? getCaseVariantWarning(app, row.newPath, file) ?? undefined : undefined,
					note: renumberNote(result, file.path),
				};
			},
			onSubmit: (title, exclude) => {
				applyNumberingPlan(app, plan(title, exclude)).catch(console.error);
			},
		}).open();
		return;
	}

	// Create and open a modal to prompt the user for a new chapter name
	new ChapterNameModal(
		app,
		"Rename chapter",
		"Rename",
		currentName,
		(newName) => {
			renameChapter(app, file, newName).catch((error) => {
				console.error("Error renaming chapter:", error);
			});
		},
		"Chapter name",
		(value) => getCaseVariantWarning(app, `${file.parent?.path ?? ""}/${sanitizeFileName(value).trim()}.md`, file),
		// Unchanged: nothing to do, so the button is greyed out without a message
		(value) => value.trim() === currentName
			? ""
			: getNameError(app, file.parent?.path ?? "", value, file),
	).open();
}

// Asks for confirmation, then moves the chapter to the trash
export async function promptAndDeleteChapter(
	app: App,
	settings: NovelChapterPluginSettings,
	file: TFile,
): Promise<void> {
	const project = numberedProjectOf(settings, file);
	const renumberText = project ? " The chapters after it will be renumbered." : "";
	// Confirm before deleting
	new ConfirmationModal(
		app,
		`Are you sure you want to delete "${file.basename}"? This will move the file to the trash.${renumberText}`,
		() => {
			void (async () => {
				await deleteChapter(app, file);
				if (project) await renumberProject(app, settings, project); // Close the gap
			})();
		},
	).open();
}

// Asks for a chapter name and folder, then creates the chapter
export async function promptAndCreateNewChapter(
	app: App,
	settings: NovelChapterPluginSettings,
	projectId: string | null,
	defaultFolderPath?: string, // Preselected folder; defaults to the active chapter's
): Promise<void> {
	// Check if a project ID is provided
	if (!projectId) {
		new Notice("Please select a novel project first.");
		return;
	}

	// Find the current novel project based on the provided ID
	const currentNovelProject = settings.novelProjects.find(
		(p) => p.id === projectId,
	);

	// If the project is not found or does not have a valid path, show an error message
	if (!currentNovelProject || !currentNovelProject.path?.trim()) {
		new Notice(
			"The selected project does not have a valid folder path configured.",
		);
		return;
	}

	// With numbering, the new chapter goes at the end of its folder's group
	const plan = (folderPath: string, title: string, excluded: boolean) =>
		planNewChapter(app, settings, currentNovelProject, folderPath, sanitizeFileName(title).trim(), excluded);
	const numberingPreview = settings.autoNumbering
		? (folderPath: string, title: string, excluded: boolean): NamePreview => {
				const { row, plan: result } = plan(folderPath, title, excluded);
				return {
					name: row?.newName ?? "",
					error: row?.duplicate ? "Another chapter already has this name." : undefined,
					warning: row ? getCaseVariantWarning(app, row.newPath) ?? undefined : undefined,
					note: renumberNote(result, null),
				};
			}
		: undefined;

	// Create and open a modal to prompt the user for a new chapter name
	new NewChapterModal(
		app,
		"Enter New Chapter Name",
		"Create Chapter",
		getChapterFolderOptions(app, settings, currentNovelProject),
		(selectedFolderPath, chapterName, excluded) => {
			if (!settings.autoNumbering) {
				void createChapter(app, settings, selectedFolderPath, chapterName);
				return;
			}
			void (async () => {
				const title = sanitizeFileName(chapterName).trim();
				const { row, plan: result } = plan(selectedFolderPath, chapterName, excluded);
				if (!row) return;
				// Chapters after it shift first, so its name is free
				const shift = await applyNumberingPlan(app, result);
				if (shift === null) return;
				const created = await createChapter(app, settings, selectedFolderPath, row.newName, {
					title,
					number: row.number,
					marker: typeof row.newMarker === "number" ? row.newMarker : null,
				});
				// No new chapter: the others go back to their old numbers
				if (!created && shift.paths.length + shift.markers.length > 0) {
					await undoNumbering(app, shift);
				}
			})();
		},
		// Otherwise the folder of the chapter you're in, if it belongs to this project
		defaultFolderPath ?? getActiveChapterFolder(app, settings, currentNovelProject),
		numberingPreview,
		(folderPath, name) => getNameError(app, folderPath, name),
		(folderPath, name) => getCaseVariantWarning(app, `${folderPath}/${sanitizeFileName(name).trim()}.md`),
	).open();
}

// Asks for a folder name, then moves the chapter into that new subfolder
export function promptAndMoveChapterToNewFolder(
	app: App,
	settings: NovelChapterPluginSettings,
	project: NovelProject,
	file: TFile,
): void {
	new ChapterNameModal(
		app,
		"Move to new folder",
		"Move",
		"",
		(folderName) => {
			// With numbering, it's renamed to fit the new folder in the same step
			const move = settings.autoNumbering
				? (f: TFile, path: string) => moveChapterToGroup(app, settings, project, f, path)
				: undefined;
			moveChapterToNewFolder(app, settings, project, file, folderName, move)
				.catch(console.error);
		},
		"Folder name",
		(value) => {
			const name = value.trim();
			const otherName = settings.otherGroupName || "Other";
			switch (getNewFolderStatus(app, settings, project, value)) {
				case "exists":
					return `Folder "${name}" already exists. The chapter will be moved into it.`;
				case "other-name":
					return `"${otherName}" is the group for chapters directly in the project folder. This folder is separate and shows as "${name} (folder)".`;
				case "fragments":
					return "That's the fragments folder.";
				case "invalid":
					return name ? "Invalid folder name." : null; // Nothing typed yet: no warning
				default:
					return null; // New folder, or nothing typed yet
			}
		},
	).open();
}

// Asks for a new folder name, then renames the folder and reports the new name
export function promptAndRenameChapterFolder(
	app: App,
	settings: NovelChapterPluginSettings,
	project: NovelProject,
	folder: TFolder,
	onRenamed: (oldName: string, newName: string) => void,
): void {
	const oldName = folder.name;
	new ChapterNameModal(
		app,
		"Rename folder",
		"Rename",
		oldName,
		(newName) => {
			renameChapterFolder(app, folder, newName)
				.then(async (renamed) => {
					if (!renamed) return;
					// folder.name is already updated by the rename
					onRenamed(oldName, folder.name);
					// Folders are numbered in name order, so a new name can change the numbers
					await renumberProject(app, settings, project);
				})
				.catch(console.error);
		},
		"Folder name",
	).open();
}

// Leaves a chapter out of numbering or numbers it again; asks first when its new name
// differs from another file's only in letter case
export function promptAndSetChapterExcluded(
	app: App,
	settings: NovelChapterPluginSettings,
	project: NovelProject,
	file: TFile,
	excluded: boolean,
): void {
	const apply = () => {
		setChapterExcluded(app, settings, project, file, excluded).catch(console.error);
	};
	const row = planChapterRename(app, settings, project, file, undefined, excluded).rows.find(
		(r) => r.path === file.path,
	);
	const warning = row && !row.duplicate ? getCaseVariantWarning(app, row.newPath, file) : null;
	if (!row || !warning) {
		apply(); // Taken names are refused (with a notice) when the plan is applied
		return;
	}
	new ConfirmationModal(app, `The chapter will be renamed to "${row.newName}". ${warning}`, apply).open();
}
