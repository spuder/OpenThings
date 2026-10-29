# URL scheme

The desktop app (macOS, Linux), the iOS app and the Android app open `openthings://` links, so Automator,
Shortcuts, Tasker, Raycast, Alfred, scripts and other apps can add to-dos and open lists. They handle the same
links with the same code (`parseRoute` in `src/lib/native/snapshot.ts`, `openRoute` in
`src/lib/native/links.ts`). The web app in a browser doesn't: browsers don't let a web page claim a
URL scheme.

`openthings://add` and `openthings:///add` (three slashes, as some apps write links) are the same.
Encode values as in any URL: a space is `%20`, `#` is `%23`, a new line is `%0A`.

## Add a to-do

```
openthings://add?title=Call%20the%20plumber&when=tomorrow&list=House&tags=errand,phone&notes=Leaking%20tap
```

| Parameter | |
| --- | --- |
| `title` | The title, as written. A `#` or `@` in it stays part of the title. |
| `notes` | Notes, as written. Several lines are fine. |
| `when` | `today`, `tomorrow`, `evening` (this evening), `someday`, `anytime`, `inbox`, a weekday (`fri`), `next week`, `in 3d`, `2026-11-02`, `nov 3`: the words quick add's `@` takes. |
| `deadline` | A date, in the same words: `fri`, `2026-11-02`. |
| `tags` | Comma-separated: `tags=errand,phone`. Tags that don't exist yet are created. |
| `list` | A project or area, by name; the start of the name is enough. A project with that name is created if there is none. |
| `text` | Quick-add text with its tokens: `Buy milk #shop @fri // 2%`. See the quick-add syntax in the README. The fields above go on top of it. |
| `save` | `save=1` adds the to-do right away and shows a short "Added" notice. In the desktop app it saves in the background: the window isn't shown or focused, and when it's hidden a native "Added to Inbox" notification appears instead (a link that starts the app is held until it has loaded). Without it, quick add opens with everything filled in, for you to check and press Enter. |

A to-do with no `list` and no `when` goes to the Inbox. With `save=1` and no `title` or `text`
nothing is added. A `when` or `deadline` the app doesn't understand is left out.

## Open a list or a to-do

| Link | Opens |
| --- | --- |
| `openthings://inbox`, `today`, `upcoming`, `anytime`, `someday`, `logbook`, `dump`, `habits`, `matrix` | That list |
| `openthings://task/<id>` | That to-do. Ids are in the REST API and MCP results (`docs/api.md`). |
| `openthings://pair?server=<url>` | Settings → Sync with that server filled in (the pairing QR code, see `docs/sync.md`) |
| `openthings://show` | Desktop: the main window |

## Examples

**macOS Terminal or a shell script**

```sh
open 'openthings://add?title=Renew%20passport&deadline=2026-12-01&list=Admin&save=1'
open 'openthings://today'
```

On Linux, use `xdg-open` instead of `open`.

**Automator / AppleScript**: a *Run AppleScript* action with

```applescript
open location "openthings://add?title=Review%20PR&tags=work&save=1"
```

To pass text from an earlier Automator step, encode it first, for example with a *Run Shell Script*
action: `python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read().strip()))'`.

**Shortcuts (iPhone, iPad, Mac)**: the *Open URLs* action with a URL built from *Text*. Use the
*URL Encode* action on any text you insert.

## Notes

- Any app or web page can open these links, so `save=1` lets them add to-dos without asking.
  Browsers ask before they open an app from a page. Links can only add and open things; they can't
  change, complete or delete to-dos.
- Desktop: `openthings --add "…"` and `openthings --quick-add "…"` do the same from a command line;
  see `docs/desktop.md`.
