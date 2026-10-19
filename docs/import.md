# Importing from other task managers

OpenThings can import an existing **Things 3** database, but only in the
**macOS desktop app**. The browser version cannot read the Things group container,
so its Settings page says that importing is desktop-only.

This document covers what is imported, what is deliberately left behind, and the
evaluation of a Super Productivity importer.

The code lives in `src/lib/import/`. It reads the source database in memory and
only ever writes through `db.bulkInsert`, which records the normal op log and
syncs like any other change. The desktop shell finds the database and passes the
bytes to the same importer; the web build has no import UI.

## Things 3

Things has no export file, so the importer reads the SQLite database that the app
keeps on the user's own Mac. That is the user's data, not an API: the importer is
an independent implementation of the mapping, does not bundle Cultured Code code,
and never writes to the source file.

### Using it

1. **Quit Things first.** The database is in WAL mode, and recent changes may live
   in `main.sqlite-wal`; quitting lets Things checkpoint them into `main.sqlite`.
2. In the macOS app: **Settings → Data**. The app looks for
   `~/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-*/Things Database.thingsdatabase/main.sqlite`
   and shows the path it found.
3. Click **Find Things on this Mac**, review the preview, then **Import**.
   Importing **adds** to the current data; it does not replace or delete anything.
   Export a JSON backup first if unsure.

The database is read in memory with `sql.js` inside the app. Nothing is uploaded,
and the original file is untouched.

### What is imported

| Things 3 | OpenThings |
| --- | --- |
| Areas (including hidden ones) | Areas, in Things order |
| Projects (name, notes, area, completed state) | Projects, with notes and area |
| Headings | Headings, in their project |
| To-dos: title, notes | To-dos |
| When (scheduled date) | `when_date` |
| Deadline | `deadline` |
| Someday | `someday` |
| Project / area / heading | Same container |
| Tags | Tags and task-tag links (flat) |
| Checklist items and checked state | Checklist items |
| Creation and completion timestamps | `created_at`, `completed_at` |
| Canceled to-dos | Imported as completed (there is no Dropped state) |

New UUIDv7 ids are generated, so re-importing creates a second copy rather than
merging. Duplicate imports are the user's call; there is no undo. Tag names are
the exception: if a tag with the same name already exists, the import reuses it.

### What is left behind

- **Trash.** Items with `trashed = 1` are skipped, as are to-dos inside trashed
  projects. The preview says how many.
- **Repeat rules.** Repeating to-dos are imported as single to-dos; repeat rules
  are not decoded. The preview counts them.
- **Reminders.** Things reminder times are not carried over; re-add with `A` or
  `%time` in quick add.
- **This Evening.** Evening to-dos import with their date and appear in Today, but
  not in This Evening.
- **Contacts / delegates, project deadlines, smart lists, Things settings.**
- **Manual Today order.** `sort` follows Things' list index, not the per-day
  Today position.

### Database notes for maintainers

Only `TMArea`, `TMTask`, `TMTag`, `TMTaskTag` and `TMChecklistItem` are read.
Columns are looked up through `PRAGMA table_info`, and older names
(`actionGroup` for `heading`, `dueDate` for `deadline`) are accepted.

Dates need care because the format changed. Current Things releases pack a
calendar date into an integer:

```
(year << 16) | (month << 12) | (day << 7)
```

so 2026-10-15 is `132818816`. Older databases store seconds since 2001-01-01 UTC;
`decodeThingsDate` falls back to that when the packed form is not a real date.
`creationDate`, `userModificationDate` and `stopDate` are Unix seconds, not
Things dates.

The importer is covered by `src/lib/import/things.test.ts`, which builds a
synthetic database with the same table shapes (including trashed rows, canceled
to-dos, repeats and duplicate tag links). When changing the mapping, keep the
test fixture realistic rather than testing only the happy path.

### Limitations

- Schema changes in a future Things release can break the import. The parser fails
  with a readable error rather than importing a partial database.
- Only the Mac database is supported. The iPhone/iPad app has no accessible file,
  which is one reason import is desktop / web only.
- Notes are imported as plain text, exactly as stored.

## Super Productivity (evaluation)

Status: **evaluated, not implemented.** The issue asks to evaluate importing a
Super Productivity (SP) database. Recommendation: support SP's **JSON backup**
later, not its live IndexedDB database.

### Which input to use

SP stores runtime state in IndexedDB (`SUP_OPS` for the operation log, plus legacy
`pf`/`SUP` databases). Reading that directly is a bad idea:

- It is an internal operation log with schema migrations owned by SP; its shape is
  not a stable API.
- On desktop it is LevelDB/IndexedDB under Electron's user-data folder, with lock
  files; copying it while SP runs can produce a corrupt read.
- It also contains device-local credentials and sync configuration that an
  importer should never need.

SP does publish a supported path: **Settings → Import/Export → Export data** (and
automatic `backups/*.json`) produces a plaintext JSON snapshot of the application
model. That is versioned, validated by SP, and documented. The importer should
accept that file. It must reject the retired V1 `config` + `tasks` shape and only
accept the current wrapper (`{ data, timestamp, crossModelVersion }`) or the raw
state object.

### Feasible mapping

| Super Productivity | OpenThings | Notes |
| --- | --- | --- |
| `task` entities | To-dos | title, notes, done state, `doneOn` → `completed_at` |
| `task.projectId` | Project | |
| `project` entities | Projects | SP has no areas; import without one, or group under an optional "Super Productivity" area |
| `tag` + `task.tagIds` | Tags / task-tag links | |
| `task.dueDay` / `dueWithTime` | `when_date` / `reminder_at` | due-with-time can carry a reminder |
| `task.timeEstimate` | `estimate_min` | SP stores milliseconds |
| `task.isDone` + archive tiers | `completed_at` | archived tasks become Logbook entries |
| `task.subTaskIds` | Checklist items **or** child to-dos | lossy either way: SP subtasks are full tasks, OpenThings checklists have no dates/tags |
| `task.timeSpent` per day | `time_entries` | synthesize one entry per task per day; no start/end times exist |
| `task.repeatCfgId` / repeat config | `rrule` | only simple rules map; after-completion repeats do not |
| Planner, boards, metrics, counters, plugin data | — | out of scope |

### What makes it more work than the Things importer

- **Version surface.** SP migrates backup shapes between major versions. The
  importer needs to detect and accept the current shape and give a clear error for
  older ones, with fixtures for both.
- **Import semantics.** SP's own import *replaces* the workspace. OpenThings
  imports *add* to it. The UI wording and confirmation need to be explicit, and a
  backup is recommended first.
- **Subtasks and archives.** Both need product decisions, not just field mapping.
- **Credentials.** SP's snapshot can include issue-provider tokens and a capture
  key in `config`. The importer must read only `task`, `project`, `tag` and
  `repeatCfg` entities and ignore everything else.

### Recommendation

Defer until someone asks for it. The groundwork is in place: the Things importer
produces a neutral plan (rows for each OpenThings table plus counts and warnings),
and `db.bulkInsert` applies a plan in one transaction. An SP importer would be a
sibling module, `src/lib/import/super-productivity.ts`, that parses a backup JSON
into the same kind of plan, plus fixtures and a second button in Settings → Data.
Estimate: roughly a day of work, most of it fixture coverage for backup versions.
