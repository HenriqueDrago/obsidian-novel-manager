// Chapter dialogs: ask the user, then call core/chapters
import { App, Notice, TFile, TFolder } from "obsidian";
import { NovelChapterPluginSettings } from "../settings";
import {
	createChapter,
	deleteChapter,
	getActiveChapterFolder,
	getChapterFolderOptions,
	renameChapter,
	renameChapterFolder,
} from "../core/chapters";
import { ChapterNameModal } from "./ChapterNameModal";
import { ConfirmationModal } from "./ConfirmationModal";
import { NewChapterModal } from "./NewChapterModal";

// Asks for a new name, then renames the chapter
export async function promptAndRenameChapter(app: App, file: TFile): Promise<void> {
	const currentName = file.basename; // Get the current chapter name

	// Create and open a modal to prompt the user for a new chapter name
	new ChapterNameModal(
		app,
		"Rename chapter",
		"Rename",
		currentName,
		(newName) => {
			if (newName && newName !== currentName) {
				renameChapter(app, file, newName).catch((error) => {
					console.error("Error renaming chapter:", error);
				});
			}
		},
	).open();
}

// Asks for confirmation, then moves the chapter to the trash
export async function promptAndDeleteChapter(app: App, file: TFile): Promise<void> {
	// Confirm before deleting
	new ConfirmationModal(
		app,
		`Are you sure you want to delete "${file.basename}"? This will move the file to the trash.`,
		() => {
			void deleteChapter(app, file);
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

	// Create and open a modal to prompt the user for a new chapter name
	new NewChapterModal(
		app,
		"Enter New Chapter Name",
		"Create Chapter",
		getChapterFolderOptions(app, settings, currentNovelProject),
		(selectedFolderPath, chapterName) => {
			void createChapter(app, settings, selectedFolderPath, chapterName);
		},
		// Otherwise the folder of the chapter you're in, if it belongs to this project
		defaultFolderPath ?? getActiveChapterFolder(app, settings, currentNovelProject),
	).open();
}

// Asks for a new folder name, then renames the folder and reports the new name
export function promptAndRenameChapterFolder(
	app: App,
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
				.then((renamed) => {
					// folder.name is already updated by the rename
					if (renamed) onRenamed(oldName, folder.name);
				})
				.catch(console.error);
		},
		"Folder name",
	).open();
}
