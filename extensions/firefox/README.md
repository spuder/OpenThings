# OpenThings Quick Add for Firefox

A toolbar button (and **Alt+Shift+T**) that opens a small quick-add popup. Type a to-do, pick **Inbox** or **Brain Dump**, and press **Add** (or Enter). **Open OpenThings** brings up the app.

- **Inbox:** the text is sent as quick add, so `@fri`, `%9am`, `#tag` and `+Project` work and can place it somewhere else (see the README's quick-add syntax).
- **Brain Dump:** the text is kept as written, like quick add in the Brain Dump.
- **Attach this page's link:** puts the page title and URL in the notes.
- **Right-click → Add to OpenThings:** opens the popup with the selected text (or the link, or the page title) filled in. Nothing is added until you press Add.

## Where to-dos go (Settings)

| Mode | How | Needs |
| --- | --- | --- |
| **App** (default) | Opens an `openthings://add?…&save=1` link ([url-scheme.md](../../docs/url-scheme.md)). Firefox asks once which app to use, then the desktop app adds it and shows "Added". | The OpenThings desktop app (macOS, Linux). |
| **Server** | `POST /api/v1/tasks` to your server ([api.md](../../docs/api.md)). **Open OpenThings** opens the web app. | Your server URL, and the extension's origin (shown in Settings, `moz-extension://…`) in `OPENTHINGS_ALLOWED_ORIGINS` on the server. |

The link opens in the current tab (a web page stays where it is), or in a small *Opening OpenThings…* tab on pages extensions can't use, such as about: pages and the new tab page. It never opens inside the popup, so Firefox's "open with OpenThings?" prompt has room to show. In App mode Firefox can't tell the extension whether an app opened the link. If nothing happens, install the desktop app or switch to Server mode.

## Try it (about:debugging)

1. In Firefox 140 or later, or a browser built on it such as Zen, open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and choose `extensions/firefox/manifest.json`, or a `.zip` from `npx web-ext build` (see Development).
3. Pin the OpenThings button: Extensions (puzzle piece) → gear icon → *Pin to Toolbar*.
4. **App mode:** with the desktop app installed, click the button, type `Test from Firefox @today`, and press Add. Allow `openthings` links when Firefox asks. The to-do appears in Today. Then switch to Brain Dump, add `random thought`, and check that it's in the Brain Dump.
5. **Server mode:** in the extension's Settings (the popup's footer, or about:addons → OpenThings Quick Add → Options), choose *My OpenThings server* and enter the URL. Allow access when Firefox asks. Add the `moz-extension://…` origin shown there to `OPENTHINGS_ALLOWED_ORIGINS` and restart the container, then click **Test connection**.
6. Select text on a page, right-click → **Add to OpenThings**, check the prefilled popup, and press Add.

A temporary add-on is removed when Firefox quits. Its `moz-extension://` origin is the same each time (it comes from the add-on id on this Firefox profile), but it differs between Firefox profiles.

## Development

- `lib.js` holds the link and request building. `lib.test.ts` checks it against the app's own link parser (`npx vitest run extensions`).
- Lint: `cd extensions/firefox && npx web-ext lint --self-hosted`.
- Run in a fresh profile: `npx web-ext run`.
- Package: `npx web-ext build -s extensions/firefox --ignore-files '*.test.ts' README.md` (from the repo root) writes `web-ext-artifacts/openthings_quick_add-<version>.zip`.
- Not published on addons.mozilla.org yet. Release Firefox and Zen only install signed add-ons for good, so an unsigned build has to be loaded as a temporary add-on (about:debugging).
