# REST API and MCP

The OpenThings server (the Docker image) offers a JSON API for scripts, Home Assistant, n8n and Shortcuts, and an MCP endpoint for AI assistants. Both read and change the same data your devices sync, and every change goes through the op log, so it reaches your devices on their next sync.

- **Base URL:** `https://openthings.<tailnet>.ts.net` (or wherever you run the container)
- **Auth:** optional. If the server sets `OPENTHINGS_TOKEN`, send `Authorization: Bearer <token>` with every request; otherwise keep the server on your tailnet or another private network. Browser requests from other websites are refused either way (see [sync.md](sync.md#auth-and-access)).
- **Hosts:** if the server sets `OPENTHINGS_HOSTNAMES`, use one of those names (or `localhost`) in the URL.
- **Dates:** "today" follows the container's `TZ`. Days are `YYYY-MM-DD`; reminders are ISO timestamps (UTC).

Settings → REST API / MCP in the app shows these with your server's address filled in.

## REST API

All bodies are JSON. Errors are `{"error": "…"}` with status 400 (bad input), 401 (missing or wrong token), 403 (origin not allowed), 404 (unknown id or name) or 421 (host not in `OPENTHINGS_HOSTNAMES`).

```sh
curl -H "Authorization: Bearer $OPENTHINGS_TOKEN" 'https://openthings.example.ts.net/api/v1/tasks?view=today'
```

### To-dos

| Method | Path | |
| --- | --- | --- |
| GET | `/api/v1/tasks?view=today` | A list: `inbox`, `today`, `week`, `upcoming`, `anytime`, `someday`, `logbook`, `dump`, `trash`, `matrix`, `all`. Narrow with `project=`, `area=`, `tag=` (names or ids; then the default view is `all`). `include_completed=1` with `all`. `limit=`. |
| GET | `/api/v1/tasks?q=dentist` | Search titles and notes (every word must match). |
| GET | `/api/v1/tasks/:id` | One to-do. |
| POST | `/api/v1/tasks` | Create. `{"text": "…"}` is parsed like quick add; or send fields (below). Fields win over the text. |
| PATCH | `/api/v1/tasks/:id` | Change fields. `null` clears a date, deadline, reminder or repeat. |
| POST | `/api/v1/tasks/:id/complete` | Check off. A repeating to-do returns `next`, its next occurrence. |
| POST | `/api/v1/tasks/:id/uncomplete` | Un-check. |
| POST | `/api/v1/tasks/:id/move` | `{"project": "…"}`, `{"area": "…"}`, `{"inbox": true}` or `{"dump": true}`. Leaving the Brain Dump makes it permanent. |
| DELETE | `/api/v1/tasks/:id` | Move to the Trash (restorable for 30 days). |
| POST | `/api/v1/tasks/:id/restore` | Take it out of the Trash. |
| POST | `/api/v1/tasks/:id/checklist` | `{"title": "…"}` adds a checklist item. |
| PATCH | `/api/v1/checklist/:id` | `{"done": true}` checks an item. |

Fields for create and update:

| Field | Example | |
| --- | --- | --- |
| `text` | `"Call dentist +Health @fri %9am #phone"` | Create only. [Quick-add syntax](../README.md#quick-add-syntax). |
| `title` | `"Call dentist"` | Literal, no parsing. |
| `notes` | `"Ask about x-rays"` | |
| `when` | `today`, `tonight`, `tomorrow`, `fri`, `next-week`, `in3d`, `someday`, `anytime`, `inbox`, `2026-11-02` | `inbox` on update also clears the project and area. |
| `deadline` | `fri`, `2026-11-02` | |
| `reminder` | `9am`, `fri 9am`, `in 30m`, ISO timestamp | A bare time lands on the to-do's day. |
| `repeat` | `daily`, `weekly`, `weekdays`, `2w` | |
| `project`, `area` | `"Health"` | An existing one, by name or id. (Quick-add `+Name` creates a project, as in the app.) |
| `tags` | `["phone"]` | Replaces all tags. Update also takes `add_tags` and `remove_tags`. |
| `urgent`, `important` | `true` | Eisenhower flags. |
| `estimate_min` | `30` | |
| `dump`, `dump_section` | `true`, `"Ideas"` | Create only: put it in the Brain Dump. |

A to-do in responses is the stored row plus `tags` (names), `project` and `area` (names), `checklist` and `repeat` (a description). Lists also carry `group`: `evening` in Today, the date in `upcoming` and `week`, the quadrant in `matrix`.

### Projects, areas, tags

| Method | Path | |
| --- | --- | --- |
| GET | `/api/v1/projects` | With area name and open to-do count. |
| POST | `/api/v1/projects` | `{"name": "…", "area": "…"}` |
| GET | `/api/v1/areas` | |
| POST | `/api/v1/areas` | `{"name": "…"}` |
| GET | `/api/v1/tags` | With open to-do count. |

### Habits and time tracking

| Method | Path | |
| --- | --- | --- |
| GET | `/api/v1/habits` | With today's check-in, streak, schedule and the last two weeks. |
| POST | `/api/v1/habits` | `{"text": "Gym 4x 60d"}`: trailing words set the schedule and challenge, as in the app. |
| POST | `/api/v1/habits/:id/check` | Check in today, or `{"day": "yesterday"}`. `:id` may be the habit's name. |
| DELETE | `/api/v1/habits/:id/check?day=…` | Remove a check-in. |
| GET | `/api/v1/timers` | The running timer, or `null`. |
| POST | `/api/v1/timers/start` | `{"task_id": "…"}`. Stops any running timer first. |
| POST | `/api/v1/timers/stop` | |

### Examples

```sh
# Add a to-do with quick-add syntax
curl -X POST https://openthings.example.ts.net/api/v1/tasks \
  -H 'content-type: application/json' \
  -d '{"text": "Call dentist +Health @fri %9am #phone"}'

# Today's list
curl 'https://openthings.example.ts.net/api/v1/tasks?view=today'

# Check off
curl -X POST https://openthings.example.ts.net/api/v1/tasks/<id>/complete
```

## MCP

`POST /mcp` speaks the Model Context Protocol over Streamable HTTP (stateless JSON responses; MCP 2024-11-05 through 2025-11-25).

```sh
claude mcp add --transport http openthings https://openthings.example.ts.net/mcp --header "Authorization: Bearer $OPENTHINGS_TOKEN"
```

In a JSON config, put the token in `headers`:

```json
{ "mcpServers": { "openthings": { "type": "http", "url": "https://openthings.example.ts.net/mcp", "headers": { "Authorization": "Bearer YOUR_TOKEN" } } } }
```

Clients that only run local commands can bridge with `mcp-remote`:

```json
{ "mcpServers": { "openthings": { "command": "npx", "args": ["-y", "mcp-remote", "https://openthings.example.ts.net/mcp", "--header", "Authorization:${AUTH_HEADER}"], "env": { "AUTH_HEADER": "Bearer YOUR_TOKEN" } } } }
```

Leave out the header if the server has no token. Without one, `/mcp` answers 401 with `WWW-Authenticate: Bearer`.

| Tool | |
| --- | --- |
| `list_tasks` | A list (today by default), optionally for a project, area or tag |
| `search_tasks` | Find to-dos by words in the title or notes |
| `get_task` | One to-do with notes, tags and checklist |
| `add_task` | Create with quick-add syntax, plus optional fields |
| `update_task` | Title, notes, when, deadline, reminder, repeat, tags, flags |
| `complete_task` | Check off (`undo` to un-check); repeating to-dos schedule the next one |
| `move_task` | To a project, area, the Inbox or the Brain Dump |
| `delete_task` | Move to the Trash (`restore` to take it back) |
| `brain_dump` | Capture into the Brain Dump |
| `add_checklist_item`, `check_checklist_item` | Checklists |
| `list_projects`, `add_project` | Areas, projects and tags |
| `list_habits`, `check_habit` | Habits and check-ins |
| `start_timer`, `stop_timer`, `current_timer` | Time tracking |

Tool results are compact JSON: empty fields are left out.
