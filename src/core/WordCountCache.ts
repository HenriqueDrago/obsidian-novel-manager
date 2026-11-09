// Word and character counts per chapter, cached by modification time (in memory only)
import { App, TFile } from "obsidian";
import { countText, TextCounts } from "./wordCount";

const BATCH_SIZE = 20; // Files read at once, so a large project doesn't block the UI

export class WordCountCache {
	// Each entry remembers the start marker it was counted with, so changing it recounts.
	// Words and characters are both kept, so switching the unit needs no recount.
	private counts = new Map<string, { mtime: number; marker: string; counts: TextCounts }>();
	private pending = new Map<string, Promise<void>>(); // Counts in progress, shared by overlapping requests

	constructor(
		private app: App,
		private getStartMarker: () => string,
	) {}

	// The count, if cached for the file's current version and the current marker
	get(file: TFile): TextCounts | undefined {
		const entry = this.counts.get(file.path);
		return entry && entry.mtime === file.stat.mtime && entry.marker === this.getStartMarker()
			? entry.counts
			: undefined;
	}

	// The last known count, even for an older version (shown until the recount finishes)
	getLatest(file: TFile): TextCounts | undefined {
		return this.counts.get(file.path)?.counts;
	}

	// Counts the files that are missing or out of date, a batch at a time
	async compute(files: TFile[]): Promise<void> {
		const stale = files.filter((file) => this.get(file) === undefined);
		for (let i = 0; i < stale.length; i += BATCH_SIZE) {
			await Promise.all(stale.slice(i, i + BATCH_SIZE).map((file) => this.countFile(file)));
		}
	}

	private countFile(file: TFile): Promise<void> {
		const marker = this.getStartMarker();
		const key = `${file.path}\n${marker}`;
		const inFlight = this.pending.get(key);
		if (inFlight) return inFlight;
		const mtime = file.stat.mtime; // The version being read
		const promise = this.app.vault
			.cachedRead(file)
			.then((content) => {
				this.counts.set(file.path, { mtime, marker, counts: countText(content, marker) });
			})
			.catch((error) => console.error(`Couldn't count words in ${file.path}:`, error))
			.finally(() => this.pending.delete(key));
		this.pending.set(key, promise);
		return promise;
	}

	// Keeps a renamed chapter's count (same content, same mtime)
	rename(oldPath: string, newPath: string): void {
		const entry = this.counts.get(oldPath);
		if (!entry) return;
		this.counts.delete(oldPath);
		this.counts.set(newPath, entry);
	}

	delete(path: string): void {
		this.counts.delete(path);
	}
}
