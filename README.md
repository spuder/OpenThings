# OpenThings

A self-hosted, local-first task manager. Calm list design, time tracking, habits, an Eisenhower matrix, and a brain dump that cleans itself up after 48 hours. Keyboard-first: every action has a shortcut.

Inspired by the principles of [Things 3](https://culturedcode.com/things/) and [Super Productivity](https://github.com/super-productivity/super-productivity), built independently. Not affiliated with either project. See [AGENTS.md](AGENTS.md) for the clean-room and licensing rules.

> **Status: proof of concept.** Desktop web app only. Data lives in your browser (SQLite in IndexedDB). No sync server, desktop shell or mobile app yet.

![Today](docs/screenshots/today.png)

| Brain Dump | Matrix |
| --- | --- |
| ![Brain dump](docs/screenshots/brain-dump.png) | ![Matrix](docs/screenshots/matrix.png) |
| **Habits** | **Quick add** |
| ![Habits](docs/screenshots/habits.png) | ![Quick add](docs/screenshots/quick-add.png) |

## Features

- **Lists:** Inbox, Today with This Evening, Upcoming, Anytime, Someday, Logbook.
- **Structure:** Areas of responsibility → Projects → Headings → To-dos, with notes, checklists, tags, deadlines and repeats.
- **Brain Dump:** a paper-styled scratch list. Unchecked items fade over 48 hours, then are deleted for good. Check them off, or keep them by moving to the Inbox, Today or any list. Supports sections.
- **Habits** with a 21-day grid and streaks.
- **Matrix:** Eisenhower quadrants from urgent / important flags.
- **Time tracking** per task and a 25-minute Pomodoro.
- **Completion sounds**, synthesized in the browser (toggle with ⇧M).
- **Quick add** with short syntax (below), from anywhere with `Q`.
- **Command palette** (`Ctrl/⌘ K`) and a shortcut sheet (`?`).
- **Local-first data:** SQLite (WASM) with an op log of every change, ready for a sync server. JSON export.
- Light and dark mode.

## Quick add syntax

| Token | Meaning |
| --- | --- |
| `#tag` | Tag |
| `+Project` | Project or area (hyphens for spaces: `+Launch-storefront`) |
| `@today` `@tonight` `@tomorrow` `@someday` `@inbox` | When |
| `@fri` `@in3d` `@2w` `@next-week` `@nov-3` `@2026-11-02` | When, by weekday, offset or date |
| `@dump` `@dump/Ideas` | Brain dump, optional section |
| `!fri` | Deadline |
| `~30m` `~1h30m` | Time estimate |
| `*daily` `*weekly` `*weekdays` `*2w` | Repeat |
| `^u` `^i` `^ui` | Urgent / important |
| `… // notes` | Everything after `//` becomes notes |

Example: `Photograph products +Launch-storefront @fri !next-week ~45m #shop ^i`

## Keyboard

| Keys | Action |
| --- | --- |
| `Q` / `N` | Quick add |
| `B` | Add to brain dump |
| `Alt+1…9` or `G` then `I T U A S L D H M` | Inbox, Today, Upcoming, Anytime, Someday, Logbook, Dump, Habits, Matrix |
| `J` / `K` | Move selection |
| `Enter` | Open / close task |
| `X` | Complete |
| `T` `E` `R` `S` | Today, This Evening, Tomorrow, Someday |
| `W` / `D` | When… / Deadline… |
| `M` | Move to list |
| `#` | Tag |
| `U` / `I` | Urgent / important |
| `P` / `⇧P` | Timer / Pomodoro |
| `Alt+↑` / `Alt+↓` | Reorder |
| `⌫` | Delete |
| `Ctrl/⌘ K` | Command palette |
| `?` | All shortcuts |

## Development

```sh
npm install
npm run dev     # http://localhost:5173
npm test
npm run check
npm run build
```

To start over with the demo data, run **Reset demo data** from the command palette.

## Self-hosting the proof of concept

```sh
docker compose up -d --build
```

`compose.yaml` carries [DockTail](https://github.com/marvinvr/docktail) labels, so with DockTail running on the host the app appears at `https://openthings.<tailnet>.ts.net` with no published ports. Without DockTail, add `ports: ["8080:8080"]`.

The image is a static build served by nginx. Until the sync server exists, **each browser keeps its own data** in IndexedDB, so hosting it centrally gives every device the same app but not the same tasks. Use **Export JSON backup** (`Ctrl/⌘ ⇧ E`) to save a copy.

## Roadmap

1. **Sync server:** TypeScript on Bun, SQLite, one Docker container on Tailscale. Serves this web app, and clients push and pull the op log. Replaces the nginx image.
2. **REST API** on the server: tasks, projects, areas, habits, brain dump, time entries. Quick add accepts the same syntax as the app.
3. **MCP server** on the same container, so AI assistants can read and manage tasks (list Today, add with quick-add syntax, complete, move, start timers). It's a thin layer over the REST API and goes through the same op log.
4. **Calendar time-blocking:** drag tasks onto a day timeline; blocks sync to a CalDAV calendar (iCloud, Radicale, Nextcloud, etc.) from the server, and existing events show as busy time.
5. **Desktop:** Tauri shell with a global quick-add hotkey (macOS and Omarchy/Hyprland).
6. **Mobile:** Capacitor iOS and Android, plus native widgets, Shortcuts and share sheet.
7. Things 3 import, CLI.

## License

[MIT](LICENSE). Third-party licenses: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
