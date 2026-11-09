# Novel Manager for Obsidian

A sidebar for writing a novel in chapters: see them grouped by folder, track their status, count words, keep them numbered, and jot down ideas, without leaving Obsidian.

## Features

- **[Chapter list](#projects-and-chapters):** chapters grouped by subfolder, with search, collapsible groups, previous/next navigation, right-click menus and drag and drop.
- **[Several novels](#getting-started):** one project per novel, switched from a dropdown.
- **[Property column](#property-column):** see and change a frontmatter property (like `status`) for every chapter from a dropdown or checkbox, with progress bars per group.
- **[Word counts](#word-counts):** words, characters or pages per chapter, group and project.
- **[Chapter numbering](#chapter-numbering):** keeps names like `Chapter 03 - The storm` in order as you move, add and remove chapters.
- **[Fragments](#fragments):** a quick-capture tab for ideas and snippets.
- **[Keyboard navigation](#keyboard-navigation):** move through the list, open, rename, delete and reorder chapters without the mouse.

Works on desktop and mobile. Drag and drop is desktop only.

## Installation

### From a release

1. Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/HenriqueDrago/obsidian-novel-manager/releases/latest).
2. Put them in a folder named `obsidian-novel-chapter-list` inside your vault's `.obsidian/plugins/` folder.
3. In Obsidian, open **Settings → Community plugins**, reload the list, and turn on **Novel Manager**.

### With BRAT

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from the community plugins.
2. Run **BRAT: Add a beta plugin for testing** and enter `HenriqueDrago/obsidian-novel-manager`.
3. Turn on **Novel Manager** in **Settings → Community plugins**.

To build it yourself, see [Development](#development).

## Getting started

1. Open the view with the ribbon icon (a numbered list; it can be hidden in the settings) or the **Novel Manager: Open view** command.
2. Create a project: choose **New project…** in the project dropdown (or use **Add novel** in the settings). Give it a name and the folder your chapters live in.
3. Click **New chapter** in the toolbar to create your first chapter, or point the project at a folder that already has some.

Every markdown file in the project's folder is a chapter. Each novel is a separate project; the dropdown at the top of the view switches between them.

## Projects and chapters

### Groups

- Each first-level subfolder of the project folder is a group (e.g. `Act 1`, `Act 2`). Chapters in deeper subfolders belong to their first-level folder's group.
- Chapters directly in the project folder go in the **Other** group, which is always last. You can rename it in the settings.
- Empty folders show as empty groups, so you can drop chapters into them.
- Groups and chapters are sorted naturally: `Chapter 2` comes before `Chapter 10`.
- Each group header shows its chapter count, and optionally word counts and progress. Click a header to collapse or expand it.

### Toolbar

- **Search chapters…** filters by name. The filter dropdown shows only chapters with a given property value.
- **Collapse all / Expand all**, **Open chapter template**, **Previous chapter**, **Next chapter** and **New chapter**.

### Menus

- **Right-click a chapter:** open in a new tab or to the right, rename, delete, leave out of numbering, or **Move to…** another group. The last entry, **New folder…**, creates a folder and moves the chapter into it.
- **Right-click a group header:** new chapter here, rename folder, collapse other groups.

### Drag and drop

On desktop, drag a chapter onto another group to move it there. While dragging, a **Drop here to move to a new folder** zone appears below the list. Dropping a chapter into a note inserts a link to it.

### Following the open chapter

- Opening a chapter highlights it in the list. With **Follow the open chapter** on, the view also switches to that chapter's project.
- **Reveal in Novel Manager** in the file explorer's and tab header's menus jumps to a chapter in the list.
- Hover a chapter with Ctrl (Cmd on macOS) held to see a page preview. This can be changed in **Settings → Page preview**.

### Chapter template

Set a **Chapter template** note in the settings and new chapters start from it. These placeholders are filled in:

| Placeholder  | Becomes                                        |
| ------------ | ---------------------------------------------- |
| `{{title}}`  | The chapter's title                            |
| `{{date}}`   | Today's date, `YYYY-MM-DD`                     |
| `{{number}}` | The chapter's number, with chapter numbering on |

Without a template (or with an empty or missing one), new chapters are blank notes. Numbering may still add its `unnumbered-after` property.

## Property column

A column that shows one frontmatter property of every chapter and lets you change it from the list. For example, set the property to `status` with the options `To Do, In Progress, Done`.

- **Options** are comma-separated and written like frontmatter values: `3` is a number, `true`/`false` a checkbox value, and `"3"` text. Commas inside quotes don't split, so `"Act 1, part 2"` is one option.
- **Property type** decides how the chosen option is saved:
  - **Auto:** each option keeps the type it's written as.
  - **Text:** saved exactly as typed.
  - **Number:** saved as a number where possible.
  - **Checkbox:** a checkbox replaces the dropdown.
- **Loose matching** (on by default) treats `3` and `"3"` as the same option.
- Every change shows a notice with **Undo**. If you're about to replace a value that no other chapter has, you're asked first.

### Progress

Group headers and the project header summarize their chapters' values:

- With the checkbox type, how many chapters are checked.
- With options, a bar with one segment per option. Next to it is the count for the last option (e.g. "Done"), all options, or just the bar. Hover the bar for the full breakdown.

## Word counts

Turn on **Show counts** to see counts for each chapter, each group and the whole project.

- **Units:** words, characters, pages (words ÷ **Words per page**, 300 by default), in any combination. Headers show every unit you turn on; chapter rows show the first one.
- **Detail:** counts on every chapter, only on groups and the total, or only on chapters.
- **Format:** short (`3.9K`) or exact (`3,912`). Hover a short number for the exact count.
- **What's counted:** frontmatter, comments (`%% %%` and HTML), code blocks and embeds are skipped. Link aliases count. Chinese, Japanese and Korean text counts one word per character.
- **Start counting after:** only text after the first occurrence of a marker counts (a heading or a line like `%%start%%`). Notes and outlines above it don't add to the total. Chapters without the marker are counted whole.

Counts are cached and only recounted when a chapter changes.

## Chapter numbering

Keeps chapter names numbered in order, following a format like `Chapter {number} - {title}`. Turn it on in **Settings → Chapter numbering**.

- **Format:** `{number}` is the chapter's number and `{title}` the rest of its name. Characters that aren't allowed in file names (like `:` and `?`) are rejected.
- **Minimum digits:** pads numbers with zeros: with 2, chapters are `01`, `02`… Larger numbers are never cut.
- **Number per folder:** each group starts at 1. Off (the default): numbers continue through the whole project.
- **Leave out "Other":** on by default. Chapters directly in the project folder keep their names.

### Previewing changes

Turning numbering on, or changing any of its settings, first shows a preview of every chapter's new name. You can untick chapters there to leave them unnumbered. Nothing is renamed until you confirm, and the notice afterwards has **Undo**.

### What renumbers automatically

Once it's on, these actions rename the chapters after them right away:

- the up and down arrows on each row (or Alt+Up/Down with keyboard navigation)
- creating a chapter (it's added at the end of its folder)
- deleting a chapter
- moving a chapter to another folder (it goes to the end of that folder)
- renaming a chapter: you edit only the title and see the full name before saving
- renaming a folder (folder order sets the numbers)

The arrows are faded at the top and bottom of a group, and while a search or filter is active.

Renaming in Obsidian updates links to the chapter, following your **Settings → Files and links → Automatically update internal links** setting.

### Unnumbered chapters

For a prologue, an interlude or an epilogue, right-click it and choose **Leave out of numbering** (or use the toggle in the rename dialog). It keeps its name and its place: the position is saved in its frontmatter as `unnumbered-after` (e.g. `3.1` = the first unnumbered chapter after chapter 3).

### Changes made outside the view

Renaming or adding chapters in the file explorer never renumbers on its own. Instead, a bar above the list says how many chapters don't match the numbering, with a **Renumber…** button that opens the preview.

## Fragments

An optional second tab for quick ideas, snippets and notes about the novel. Turn it on with **Enable fragments**.

- Each project saves fragments in its own folder, set in the project's settings. Left empty, it's a `Fragments` folder inside the chapters folder. The fragments folder is never listed as chapters.
- Write in the box at the top and save with the button or Ctrl+Enter (Cmd+Enter on macOS). An unsaved draft survives refreshes.
- Fragments are listed newest first, oldest first or by name, with search. Long fragments are cut with **Show more**. Each one can be copied, renamed or deleted, and its title opens the note.

## Keyboard navigation

Turn on **Keyboard navigation** in the settings, then click the list or run **Focus chapter list**.

| Key                     | Action                                                                  |
| ----------------------- | ----------------------------------------------------------------------- |
| Up / Down               | Move between chapters and group headers                                 |
| Home / End              | First / last item                                                       |
| Enter                   | Open the chapter, or collapse/expand the group                          |
| Ctrl/Cmd+Enter          | Open the chapter in a new tab                                           |
| Left / Right            | Collapse/expand a group; jump between a group and its chapters          |
| Right (on a chapter)    | Step into the property cell                                             |
| Space                   | Open the property dropdown, or toggle the checkbox                      |
| Escape                  | Leave the property cell                                                 |
| F2                      | Rename the chapter or folder                                            |
| Delete                  | Delete the chapter                                                      |
| Alt+Up / Alt+Down       | Move the chapter within its group (with chapter numbering)              |
| Menu key / Shift+F10    | Open the chapter's or group's menu                                      |

## Commands

All commands start with **Novel Manager:** in the command palette.

- **Open view**
- **Open chapters**
- **Open fragments** (focuses the fragment box; with fragments on)
- **Focus chapter list**
- **Reveal current chapter in view**
- **Create new chapter in project**
- **Open next chapter** / **Open previous chapter** (while a chapter is open)

You can assign hotkeys to any of them in **Settings → Hotkeys**.

## Settings

Defaults in parentheses.

### Chapters

- **Chapter template** (none): note new chapters start from.
- **Label for chapters outside subfolders** (`Other`): name of the group for chapters directly in the project folder.
- **Leave this group out of totals** (off): those chapters don't count toward the project's chapter count, word count and progress.

### Chapter list

- **Follow the open chapter** (off): switch to a chapter's project when you open it.
- **Show chapter counts** (on): chapter counts under the project and group headers.
- **Keyboard navigation** (off): see [Keyboard navigation](#keyboard-navigation).
- **Drag chapters between folders** (on): desktop only.
- **Reveal in file menus** (on): adds **Reveal in Novel Manager** to chapters' menus.
- **Show ribbon icon** (on): the icon in the left ribbon that opens the view.

### Chapter numbering

- **Number chapters automatically** (off)
- **Format** (`Chapter {number} - {title}`)
- **Minimum digits** (1)
- **Apply format changes:** previews and applies a new format or digit count.
- **Number per folder** (off)
- **Leave out "Other"** (on)

### Word counts

- **Show counts** (off)
- **Words** (on), **Characters** (off), **Pages** (off)
- **Words per page** (300)
- **Detail** (chapters, groups and total)
- **Format** (short)
- **Start counting after** (empty: count everything)

### Property column

- **Show property column** (on)
- **Property** (`status`)
- **Column title** (empty: the property name)
- **Property type** (auto)
- **Options** (`To Do, Done, In Progress`)
- **Loose matching** (on)
- **Show checkbox progress** (on) and **Show option progress** (on)
- **Progress text** (last option)

### Fragments

- **Enable fragments** (off)

### Novel projects

One row per project: name, chapters folder and fragments folder, with buttons to move it up or down (the dropdown's order) or remove it. Removing a project never deletes its files.

## Development

```bash
git clone https://github.com/HenriqueDrago/obsidian-novel-manager.git
cd obsidian-novel-manager
npm install
npm run dev     # rebuilds main.js on every change
```

Clone it into a test vault's `.obsidian/plugins/` folder and reload the plugin after each build.

- `npm run build`: type-check and build a production `main.js`
- `npm run lint`: ESLint with the official Obsidian plugin rules
- `npm version <x.y.z>`: bumps the version in `manifest.json` and `versions.json`

## License

See [LICENSE](LICENSE).
