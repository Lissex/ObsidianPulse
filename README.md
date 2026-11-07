# Vault Scope

An adaptive Obsidian dashboard for local note statistics and planning. The interface uses the color variables of the active Obsidian theme and is designed for both desktop and mobile.

## Development

1. Install dependencies with `npm install`.
2. Run `npm run dev` to watch and bundle the plugin into `main.js`.
3. Run `npm run build` to type-check and create a production bundle.
4. Copy `manifest.json`, `main.js`, and `styles.css` into `.obsidian/plugins/vault-pulse/` in a test vault.

## Architecture

`main.ts` owns plugin startup, Obsidian event registration, and coordination between services. `dashboard.ts` owns dashboard state and panel composition; `dashboard-charts.ts` renders activity charts and folder/tag breakdowns. `settings-tab.ts` owns the settings UI and its Obsidian settings-search entry, while `settings-model.ts` validates persisted settings and supplies defaults. `view-utils.ts` contains shared presentation and Markdown helpers. Statistics, tasks, daily notes, schedules, period plans, GitHub, and learning remain in focused domain modules.

## Statistics

The plugin indexes Markdown notes available through the Obsidian Vault API, including nested folders, archives, and template folders. The statistics history is stored in `Vault Pulse/activity.json` within the vault. The file can be moved and synced along with the vault.

Creation and modification events are grouped into a single record per note per type per day so that autosaving does not inflate the count. On first launch, the plugin uses file timestamps for the initial index. It cannot recover every edit made prior to installation or while the plugin was disabled. External synchronization may appear as a regular modification because the public Obsidian event does not report a reliable source for the operation.

Series of 20 notes within 2 minutes are flagged as possible bulk activity. The user can manually classify a series as regular work, import, synchronization, or bulk modification. This is a hint, not an automatic determination of origin.

Folders and tags can be excluded from statistics display in the settings. By default, all available Markdown notes are included, including archives and templates. The plugin does not send data to external services and does not modify user note content.

## Daily Note

The "Today" panel displays note activity and events/completed tasks recorded in the daily note. The path, date format, composition, and block order are configured in the plugin settings. To create a daily note or add missing blocks, a preview is opened first. Existing text is preserved entirely; writing is performed only after clicking the confirmation button.

## Tasks

The plugin reads standard Markdown tasks `- [ ]` and `- [x]` across the vault's notes. Due dates are set with the `📅 YYYY-MM-DD` marker, priorities with `🔺`, `⏫`, `🔼`, `🔽`, or `⏬` markers, and tags with regular hashtags in the task line. The panel groups overdue, today's, future, undated, and completed tasks; filters are available by status, priority, folder, and tag.

New tasks are added by default to the "Plan of the day" section of the daily note. You can select a separate Markdown file in the settings. Before adding, the path and the resulting Markdown line are shown. Toggling the checkbox updates only the source task line and preserves the rest of the file.

## Schedule

Events are stored in the `## Events` section of the daily note as a Markdown list: `- 09:00–09:30 | Name · Task: [[Path/to/note]] — task text`. Events without an end time are given a duration equal to the grid step. The panel displays busy and free intervals within the selected working hours and highlights overlaps when adding an event.

Task migration is available for incomplete tasks from yesterday's daily note. A selection list is shown first; the plugin copies the tasks to today's note and deletes the original lines only after successfully writing to the destination. Working hours, grid step, time format, and the start of the week are configured in the settings.

## Period Plans

The "Period Plans" panel shows a summary for the current week, month, or year: note creation and modification, active notes, and tasks with a due date in the period. For each period, the folder, file name, and Markdown template are configurable. Substitutions `{{period}}`, `{{start}}`, `{{end}}`, `{{stats}}`, `{{tasks}}`, `{{notes}}`, and `{{projects}}` are available. Creating or appending a plan goes through a preview and explicit confirmation. Blocks between the `vault-pulse:stats`, `vault-pulse:tasks`, and `vault-pulse:notes` comments are updated on the next confirmed preview; manual text outside these blocks is preserved.

Markdown tasks do not contain a standard completion date, so the number of completed tasks in the overview is counted among tasks with a due date in the selected period, rather than as an exact timeline of when they were checked off.

## GitHub

In the GitHub settings, add repositories in the `owner/repo` format. The panel shows commits for the currently selected period and allows filtering them by repository and author. The request is triggered by a button; periodic synchronization can be enabled separately. Public repositories are accessible without a token. Private repositories require a fine-grained personal access token restricted to the necessary repositories and the `Contents: read` permission. The token is selected via Obsidian's SecretStorage and does not end up in the `data.json` settings. The plugin uses the commit list API without downloading file contents. Up to 50 commits are displayed, and synchronization reads a maximum of 1000 commits per repository per period.

## Learning

The "Learning" panel maintains a local list of courses from Stepik, Udemy, and other platforms. Add the course, link, progress, status, and next step; records are stored in `Vault Pulse/learning.json`. Tracking is manual: the [Stepik API](https://help.stepik.org/article/64188) requires OAuth access to an account for personal data, and student progress is described among the [Udemy Business APIs](https://partnersupport.udemy.com/hc/en-us/articles/17361835464087-Summary-of-Available-APIs), which are configured by the organization. The plugin does not request platform passwords or tokens and does not scan website pages. In the settings, you can hide courses from each platform; hiding does not delete records.

## Appearance

In the "Appearance" settings section, three card styles are available (translucent macOS-inspired, minimal, and outlined), three activity chart shapes (bars, line, area), and three complete color themes: Obsidianite, classic dark, and classic light. Layout adapts to the dashboard pane width, including narrow desktop sidebars.

The Obsidianite theme uses dark violet surfaces with cyan and pink accents regardless of the active Obsidian theme. Classic dark and classic light use neutral surfaces and blue accents. All themes inherit the active theme's font.

Notes inside hidden directories that are inaccessible via the Vault API may not be indexed. This is a limitation of the public API, particularly important for consistent mobile support.
