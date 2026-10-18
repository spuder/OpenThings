# AGENTS.md

Guidance for AI coding agents (and humans) working on OpenThings.

## What this is

A self-hosted, local-first task manager. It is **inspired by the principles** of two apps:

- **Things 3** by Cultured Code: calm design, Areas → Projects → Headings → To-dos, When vs Deadline, Today / This Evening / Upcoming / Anytime / Someday / Logbook, fast keyboard capture.
- **Super Productivity** (SP): time tracking, Pomodoro, Eisenhower matrix, habits, completion sounds, short-syntax quick add.

Plus features neither has, such as the 48-hour **Brain Dump**.

## Licensing and clean-room rules (read before writing code)

The two inspirations have different licenses, so they are treated differently.

### Things 3: closed source, clean room only

Things is proprietary software. Everything inspired by it must be an **independent, clean-room implementation**:

- Work only from publicly observable behavior (using the app, public descriptions of features). Never decompile, disassemble, or inspect the app bundle, its databases' internals beyond documented export, network traffic, or private resources.
- Copy **no** code, icons, logos, artwork, sounds, screenshots, fonts, color palettes taken from the app, or UI copy/strings.
- Don't reproduce its trade dress: layouts, icons and visual details here are our own. Similar *concepts* (a "Today" list, a checkbox) are fine; pixel-matching their look is not.
- Don't use the Things name or Cultured Code marks for branding, app icons, or marketing. Factual comparison ("inspired by Things") in docs is fine.
- The Things 3 importer (planned) must read data the user exports or owns; it must not depend on undocumented internals beyond what's needed to read the user's own data, and must not bundle any Cultured Code code.

### Super Productivity: MIT licensed, reuse allowed

SP is open source under the MIT License (https://github.com/super-productivity/super-productivity), so its **code may be reused or adapted**, with these conditions:

- Keep SP's copyright and MIT permission notice: add an entry to `THIRD_PARTY_NOTICES.md` naming the source file(s), the upstream commit, and what was adapted.
- Put a header comment in any adapted file: `Adapted from Super Productivity (MIT), <path> @ <commit>`.
- Don't use SP's name or logo as our branding.

### Our own assets

- Icons in `src/lib/ui/Icon.svelte` are original drawings for this project.
- Sounds in `src/lib/sound.ts` are synthesized at runtime; no audio files are shipped.
- Fonts: Inter and Caveat via `@fontsource` (SIL Open Font License).

When in doubt, write it from scratch and say so in the PR description.

## Stack

- Svelte 5 (runes) + TypeScript + Vite
- SQLite in the browser via `sql.js` (WASM), persisted to IndexedDB
- `chrono-node` for natural-language date fallback in quick add
- Vitest for unit tests, Playwright (dev only) for screenshots

Planned (see the architecture doc): Tauri desktop shell, Capacitor iOS/Android, a TypeScript/Bun sync server in Docker on Tailscale.

## Commands

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # vitest
npm run check      # svelte-check + tsc
npm run build
```

## Code map

| Path | Purpose |
| --- | --- |
| `src/lib/db.ts` | SQLite schema, `insert` / `update` / `remove`, op log, IndexedDB persistence, UUIDv7, HLC |
| `src/lib/store.svelte.ts` | App state (runes) and every write action |
| `src/lib/views.ts` | Pure view filters (Inbox, Today, Upcoming, Matrix, Brain Dump expiry, streaks) |
| `src/lib/parse.ts` | Quick-add syntax parser and recurrence helpers |
| `src/lib/commands.ts` | Command registry and keyboard handling |
| `src/lib/sound.ts` | Synthesized UI sounds |
| `src/lib/seed.ts` | Demo data for a fresh install |
| `src/lib/ui/*` | Svelte components |

## Conventions

- **All writes go through `db.insert` / `db.update` / `db.remove`** (via the store). They record the op log that future sync depends on. Never write SQL that mutates data elsewhere.
- **Every user action is a command** in `commands.ts` with a default key. Buttons call commands or store actions; the palette and help sheet read the registry. Keyboard-first is a requirement, not a nice-to-have.
- Logic that can be pure (filters, parsing, dates) lives outside components and has tests in `*.test.ts`.
- IDs are UUIDv7; ordering uses fractional `sort` values; dates are local `YYYY-MM-DD` strings.
- Brain Dump items are tasks with `dump = 1`. Unchecked ones are deleted for good 48 hours after `created_at`. Moving one to any list clears `dump`.
- Keep the UI calm: few elements per row, short animations (`transform`/`opacity`), no new colors without a token in `app.css`.
