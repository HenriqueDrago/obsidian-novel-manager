// Chapter dialogs: ask the user, then call core/chapters
import { App, Notice, TFile } from "obsidian";
import { NovelChapterPluginSettings } from "../settings";
import {
	createChapter,
	deleteChapter,
	getActiveChapterFolder,
	getChapterFolderOptions,
	renameChapter,
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
		"Rename Chapter",
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
		// Default to the folder of the chapter you're in, if it belongs to this project
		getActiveChapterFolder(app, settings, currentNovelProject),
	).open();
}
