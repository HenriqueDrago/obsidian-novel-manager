// Chapter numbering in the vault: reading the current order, planning changes and renaming files
import { App, Notice, normalizePath, TFile } from "obsidian";
import { getNumberingOptions, NovelChapterPluginSettings, NovelProject } from "../settings";
import { getProjectChapters, moveChapter, readNumberingMarker } from "./chapters";
import {
	NumberingGroup,
	NumberingOptions,
	NumberingPlan,
	NumberingRow,
	planNumbering,
	UNNUMBERED_KEY,
} from "./numbering";
import { getChapterGroupKey, naturalCompare, OTHER_GROUP_KEY } from "./utils";

// Stands in for a chapter that doesn't exist yet in a plan (no real path starts with a NUL)
const NEW_CHAPTER_PATH = "\0new-chapter";

// One batch of renames at a time
let busy = false;
export function isNumberingBusy(): boolean {
	return busy;
}

// A project's groups in display order, each with its chapters in their current order
export function getNumberingGroups(
	app: App,
	settings: NovelChapterPluginSettings,
	project: NovelProject,
): NumberingGroup[] {
	const groups: NumberingGroup[] = [];
	// Already grouped and ordered (by number when numbering is on, by name otherwise)
	for (const file of getProjectChapters(app, settings, project)) {
		const key = getChapterGroupKey(file, project.path);
		let group = groups[groups.length - 1];
		if (!group || group.key !== key) {
			group = { key, isOther: key === OTHER_GROUP_KEY, entries: [] };
			groups.push(group);
		}
		group.entries.push({
			path: file.path,
			name: file.basename,
			folder: file.parent?.path ?? "",
			...readNumberingMarker(app, file),
		});
	}
	return groups;
}

// The group for a key, added in display order if it has no chapters yet
function ensureGroup(groups: NumberingGroup[], key: string): NumberingGroup {
	const existing = groups.find((g) => g.key === key);
	if (existing) return existing;
	const group: NumberingGroup = { key, isOther: key === OTHER_GROUP_KEY, entries: [] };
	// Subfolders naturally, "Other" last (as in sortChapters)
	const index = groups.findIndex(
		(g) => key !== OTHER_GROUP_KEY && (g.isOther || naturalCompare(key, g.key) < 0),
	);
	groups.splice(index === -1 ? groups.length : index, 0, group);
	return group;
}

// Group key of a folder of the project (the project folder itself is "Other")
function groupKeyOfFolder(project: NovelProject, folderPath: string): string {
	const root = normalizePath(project.path);
	const folder = normalizePath(folderPath);
	if (folder === root) return OTHER_GROUP_KEY;
	return folder.substring(root.length + 1).split("/")[0];
}

// Plans the project's numbering after changing the order or entries
function planProject(
	app: App,
	settings: NovelChapterPluginSettings,
	project: NovelProject,
	edit?: (groups: NumberingGroup[]) => void,
	options: NumberingOptions = getNumberingOptions(settings),
): NumberingPlan {
	const groups = getNumberingGroups(app, settings, project);
	edit?.(groups);
	return planNumbering(groups, settings.numberFormat, options);
}

// ====== Applying ======

// What a batch changed, to undo it
export interface NumberingUndo {
	paths: { file: TFile; oldPath: string }[];
	markers: { file: TFile; existed: boolean; value: unknown }[];
}

// Renames files without clashing: free targets first, then a temporary name to break cycles
async function renameAll(
	app: App,
	moves: { file: TFile; newPath: string }[],
	onRenamed: (file: TFile, oldPath: string) => void,
): Promise<void> {
	let pending = moves
		.map((m) => ({ file: m.file, newPath: normalizePath(m.newPath) }))
		.filter((m) => m.file.path !== m.newPath);
	const movers = new Set(pending.map((m) => m.file));

	// A target taken by a file outside the batch would never free up
	for (const { newPath } of pending) {
		const existing = app.vault.getAbstractFileByPath(newPath);
		if (existing && !(existing instanceof TFile && movers.has(existing))) {
			throw new Error(`"${newPath}" already exists.`);
		}
	}

	while (pending.length > 0) {
		const blocked: typeof pending = [];
		for (const move of pending) {
			const existing = app.vault.getAbstractFileByPath(move.newPath);
			// Free, or only a case change of the same file
			if (!existing || existing === move.file) {
				const oldPath = move.file.path;
				await app.fileManager.renameFile(move.file, move.newPath);
				onRenamed(move.file, oldPath);
			} else {
				blocked.push(move);
			}
		}
		if (blocked.length === pending.length) {
			// Everyone waits on someone (e.g. two chapters swapping names): move one out of the way
			const move = blocked[0];
			const oldPath = move.file.path;
			await app.fileManager.renameFile(move.file, uniqueTempPath(app, move.file));
			onRenamed(move.file, oldPath);
		}
		pending = blocked;
	}
}

// A free name next to the file, for breaking rename cycles
function uniqueTempPath(app: App, file: TFile): string {
	const folder = file.parent?.path ?? "";
	for (let i = 1; ; i++) {
		const name = `${file.basename} (renumbering ${i}).md`;
		const path = normalizePath(folder && folder !== "/" ? `${folder}/${name}` : name);
		if (!app.vault.getAbstractFileByPath(path)) return path;
	}
}

// Runs one batch at a time; returns null if another one is running
async function exclusive<T>(task: () => Promise<T>): Promise<T | null> {
	if (busy) {
		new Notice("Chapters are still being renumbered.");
		return null;
	}
	busy = true;
	try {
		return await task();
	} finally {
		busy = false;
	}
}

// Writes markers and renames files; returns what was done (also after an error, for undo)
async function applyRows(app: App, rows: NumberingRow[]): Promise<NumberingUndo> {
	const undo: NumberingUndo = { paths: [], markers: [] };
	const items = rows
		.map((row) => ({ row, file: app.vault.getAbstractFileByPath(row.path) }))
		.filter((item): item is { row: NumberingRow; file: TFile } => item.file instanceof TFile);
	const renames = items.filter(({ row }) => normalizePath(row.newPath) !== row.path);

	// Progress for long batches (each rename can update links across the vault)
	const total = renames.length;
	const progress = total > 10 ? new Notice(`Renumbering chapters… 0/${total}`, 0) : null;
	const originalPaths = new Map<TFile, string>();
	try {
		// Markers first, while the paths are still the planned ones
		for (const { row, file } of items) {
			if (row.newMarker === undefined) continue;
			await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
				undo.markers.push({
					file,
					existed: Object.prototype.hasOwnProperty.call(fm, UNNUMBERED_KEY),
					value: fm[UNNUMBERED_KEY],
				});
				if (row.newMarker === null) delete fm[UNNUMBERED_KEY];
				else fm[UNNUMBERED_KEY] = row.newMarker;
			});
		}
		await renameAll(
			app,
			renames.map(({ row, file }) => ({ file, newPath: row.newPath })),
			(file, oldPath) => {
				// The first path counts (a file may pass through a temporary name)
				if (!originalPaths.has(file)) originalPaths.set(file, oldPath);
				progress?.setMessage(`Renumbering chapters… ${originalPaths.size}/${total}`);
			},
		);
	} catch (error) {
		console.error("Error renumbering chapters:", error);
		new Notice(
			`Renumbering stopped after ${originalPaths.size} of ${total} renames: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	} finally {
		progress?.hide();
		undo.paths = Array.from(originalPaths, ([file, oldPath]) => ({ file, oldPath }));
	}
	return undo;
}

// Applies a plan's changes, refusing plans where two chapters would get the same name
export async function applyNumberingPlan(app: App, plan: NumberingPlan): Promise<NumberingUndo | null> {
	if (plan.hasDuplicates) {
		const names = plan.rows.filter((r) => r.duplicate).map((r) => r.newName);
		new Notice(`Two chapters would get the same name: ${Array.from(new Set(names)).join(", ")}`);
		return null;
	}
	if (plan.changes.length === 0) return { paths: [], markers: [] };
	return exclusive(() => applyRows(app, plan.changes));
}

// Puts names and markers back as they were before a batch
export async function undoNumbering(app: App, undo: NumberingUndo): Promise<void> {
	await exclusive(async () => {
		try {
			await renameAll(
				app,
				undo.paths.map(({ file, oldPath }) => ({ file, newPath: oldPath })),
				() => {},
			);
			for (const { file, existed, value } of undo.markers) {
				await app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
					if (existed) fm[UNNUMBERED_KEY] = value;
					else delete fm[UNNUMBERED_KEY];
				});
			}
			new Notice("Chapter names restored.");
		} catch (error) {
			console.error("Error undoing renumbering:", error);
			new Notice("Couldn't restore every chapter name. See console for details.");
		}
	});
}

// ====== Actions (each renumbers right away) ======

// Renumbers the project as it is (after a delete, a folder rename, or a change outside the plugin)
export async function renumberProject(
	app: App,
	settings: NovelChapterPluginSettings,
	project: NovelProject,
): Promise<void> {
	if (!settings.autoNumbering) return;
	await applyNumberingPlan(app, planProject(app, settings, project));
}

// The plan for renumbering the project as it is, for the out-of-date check
export function planCurrentNumbering(
	app: App,
	settings: NovelChapterPluginSettings,
	project: NovelProject,
): NumberingPlan {
	return planProject(app, settings, project);
}

// Moves a chapter one place up or down in its group; returns whether it moved
export async function moveChapterBy(
	app: App,
	settings: NovelChapterPluginSettings,
	project: NovelProject,
	file: TFile,
	offset: -1 | 1,
): Promise<boolean> {
	let moved = false;
	const plan = planProject(app, settings, project, (groups) => {
		for (const group of groups) {
			const index = group.entries.findIndex((e) => e.path === file.path);
			const target = index + offset;
			if (index === -1 || target < 0 || target >= group.entries.length) continue;
			const entries = group.entries;
			[entries[index], entries[target]] = [entries[target], entries[index]];
			moved = true;
		}
	});
	if (!moved) return false;
	return (await applyNumberingPlan(app, plan)) !== null;
}

// Moves a chapter to the end of another folder's group, renaming it to fit
export async function moveChapterToGroup(
	app: App,
	settings: NovelChapterPluginSettings,
	project: NovelProject,
	file: TFile,
	folderPath: string,
): Promise<void> {
	const destination = normalizePath(folderPath);
	if (file.parent?.path === destination) {
		new Notice("Chapter is already in that folder.");
		return;
	}
	const plan = planProject(app, settings, project, (groups) => {
		for (const group of groups) {
			const index = group.entries.findIndex((e) => e.path === file.path);
			if (index === -1) continue;
			const [entry] = group.entries.splice(index, 1);
			entry.folder = destination;
			ensureGroup(groups, groupKeyOfFolder(project, destination)).entries.push(entry);
		}
	});
	const undo = await applyNumberingPlan(app, plan);
	if (undo) new Notice(`Moved "${file.basename}" successfully.`);
}

// Moves a chapter into a folder: renumbered when numbering is on, a plain move otherwise
export async function moveChapterToFolder(
	app: App,
	settings: NovelChapterPluginSettings,
	project: NovelProject,
	file: TFile,
	folderPath: string,
): Promise<void> {
	if (settings.autoNumbering) await moveChapterToGroup(app, settings, project, file, folderPath);
	else await moveChapter(app, file, folderPath);
}

// Leaves a chapter out of numbering (it keeps its place) or numbers it again
export async function setChapterExcluded(
	app: App,
	settings: NovelChapterPluginSettings,
	project: NovelProject,
	file: TFile,
	excluded: boolean,
): Promise<void> {
	await applyNumberingPlan(app, planChapterRename(app, settings, project, file, undefined, excluded));
}

// The plan for renaming a chapter (title, or full name when unnumbered) and setting its exclusion
export function planChapterRename(
	app: App,
	settings: NovelChapterPluginSettings,
	project: NovelProject,
	file: TFile,
	title: string | undefined,
	excluded: boolean,
): NumberingPlan {
	return planProject(app, settings, project, (groups) => {
		for (const group of groups) {
			const entry = group.entries.find((e) => e.path === file.path);
			if (!entry) continue;
			entry.excluded = excluded;
			if (title !== undefined) entry.title = title;
		}
	});
}

// The plan for a new chapter at the end of a folder's group: its row, and what else changes
export function planNewChapter(
	app: App,
	settings: NovelChapterPluginSettings,
	project: NovelProject,
	folderPath: string,
	title: string,
	excluded: boolean,
): { row: NumberingRow | null; plan: NumberingPlan } {
	const folder = normalizePath(folderPath);
	const plan = planProject(app, settings, project, (groups) => {
		ensureGroup(groups, groupKeyOfFolder(project, folder)).entries.push({
			path: NEW_CHAPTER_PATH,
			name: title,
			folder,
			excluded,
			hasMarker: false,
			title,
		});
	});
	const row = plan.rows.find((r) => r.path === NEW_CHAPTER_PATH) ?? null;
	// The new chapter is created, not renamed
	plan.changes = plan.changes.filter((r) => r.path !== NEW_CHAPTER_PATH);
	return { row, plan };
}

// Whether a group is numbered (the "Other" group can be left out)
export function isGroupNumbered(settings: NovelChapterPluginSettings, groupKey: string): boolean {
	return settings.autoNumbering && !(groupKey === OTHER_GROUP_KEY && settings.numberSkipOther);
}
