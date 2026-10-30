//! OpenThings desktop shell (Tauri v2).
//!
//! The UI is the unchanged web app (`../src`), loaded from the bundled `dist/`. This crate only adds
//! what a browser can't do:
//!
//! - a global quick-add hotkey and a small floating quick-add window (`quickadd`);
//! - `openthings://add?text=…` deep links and `openthings --quick-add` (single instance), for
//!   Wayland compositors where global key grabs from apps don't work; on Hyprland the shortcut
//!   from Settings is written into its config instead (`hyprland`);
//! - a tray / menu-bar icon that shows sync status, and keeps the app running when the window closes;
//! - native notifications for reminders (and a backstop timer, so they fire on time even if the
//!   hidden webview is throttled);
//! - a native macOS menu bar wired to the web app's command registry;
//! - window-state memory and launch at login;
//! - on Omarchy, the desktop theme's colors, kept in step as it changes (`omarchy`).
//!
//! The web app talks to this crate through the commands below and the `ot://…` events; see
//! `src/lib/native/desktop.ts` and `docs/desktop.md`.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem, MenuItemBuilder, PredefinedMenuItem, Submenu, SubmenuBuilder},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, RunEvent, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_autostart::ManagerExt as _;
use tauri_plugin_deep_link::DeepLinkExt as _;
use tauri_plugin_notification::NotificationExt as _;

mod hyprland;
mod omarchy;

const MAIN: &str = "main";
const QUICK_ADD: &str = "quickadd";
/// Window title of the quick-add window. Hyprland/sway window rules match on it; keep it stable.
const QUICK_ADD_TITLE: &str = "OpenThings Quick Add";
/// ⌃Space on macOS, the usual quick-entry key there. Elsewhere Ctrl+Space is often taken by input
/// methods and editors' autocomplete.
#[cfg(target_os = "macos")]
const DEFAULT_HOTKEY: &str = "Control+Space";
#[cfg(not(target_os = "macos"))]
const DEFAULT_HOTKEY: &str = "Control+Alt+Space";
/// Super+Space is Omarchy's launcher.
const HYPRLAND_DEFAULT_HOTKEY: &str = "Super+Alt+Space";

fn default_hotkey() -> &'static str {
    if hyprland::session() { HYPRLAND_DEFAULT_HOTKEY } else { DEFAULT_HOTKEY }
}
const TRAY_ID: &str = "openthings-tray";

/// Tray icons, one per sync state (drawn for this project, see `scripts/make-tray-icons.py`).
const TRAY_LOCAL: &[u8] = include_bytes!("../icons/tray/local.png");
const TRAY_SYNCED: &[u8] = include_bytes!("../icons/tray/synced.png");
const TRAY_PENDING: &[u8] = include_bytes!("../icons/tray/pending.png");
const TRAY_OFFLINE: &[u8] = include_bytes!("../icons/tray/offline.png");
const TRAY_ERROR: &[u8] = include_bytes!("../icons/tray/error.png");

// ---------- settings persisted by the shell ----------

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct DesktopSettings {
    /// Global quick-add shortcut, in Tauri accelerator syntax. Empty = off.
    hotkey: String,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self { hotkey: default_hotkey().into() }
    }
}

fn settings_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    app.path().app_config_dir().ok().map(|d| d.join("desktop.json"))
}

fn load_settings<R: Runtime>(app: &AppHandle<R>) -> DesktopSettings {
    settings_path(app)
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_settings<R: Runtime>(app: &AppHandle<R>, s: &DesktopSettings) -> Result<(), String> {
    let path = settings_path(app).ok_or("no config directory")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, serde_json::to_string_pretty(s).unwrap()).map_err(|e| e.to_string())
}

// ---------- shared state ----------

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Reminder {
    task_id: String,
    title: String,
    /// ISO timestamp, UTC.
    at: String,
}

#[derive(Default)]
struct Shell {
    settings: Mutex<DesktopSettings>,
    /// Pending reminders as last reported by the web app.
    reminders: Mutex<Vec<Reminder>>,
    /// Reminders this shell already showed natively: task id -> when. Used to drop the duplicate
    /// the web scheduler sends a moment later.
    shown: Mutex<HashMap<String, Instant>>,
    /// Wakes the reminder thread when the list changes.
    wake: std::sync::Condvar,
    wake_lock: Mutex<bool>,
    /// Set once the web app saved its database; the next exit request goes through.
    quitting: AtomicBool,
    /// Whether the global shortcut plugin is active (X11 / macOS / Windows, not Wayland).
    hotkeys_available: AtomicBool,
    hotkey_error: Mutex<Option<String>>,
    tray_status: Mutex<Option<MenuItem<tauri::Wry>>>,
    /// Links that arrived before the main window's store was loaded (a cold start by a link).
    links: Mutex<LinkQueue>,
}

/// Holds `openthings://` links until the main window says it's ready (`main_ready`): an event
/// emitted before its listener exists is dropped, which lost the to-do of a link that started the app.
#[derive(Default)]
struct LinkQueue {
    ready: bool,
    held: Vec<String>,
}

impl LinkQueue {
    /// Some(link): send it now. None: held until `take`.
    fn offer(&mut self, link: String) -> Option<String> {
        if self.ready {
            return Some(link);
        }
        self.held.push(link);
        None
    }
    /// The window is ready: later links go straight through; returns the held ones in order.
    fn take(&mut self) -> Vec<String> {
        self.ready = true;
        std::mem::take(&mut self.held)
    }
}

/// Send an `openthings://` link to the main window, or hold it until the window is ready.
fn send_link<R: Runtime>(app: &AppHandle<R>, link: String) {
    let now = app.state::<Arc<Shell>>().links.lock().unwrap().offer(link);
    if let Some(link) = now {
        let _ = app.emit_to(MAIN, "ot://open-url", link);
    }
}

/// From the main window once its store is loaded: the links that arrived before.
#[tauri::command]
fn main_ready(shell: tauri::State<Arc<Shell>>) -> Vec<String> {
    shell.links.lock().unwrap().take()
}

// ---------- windows ----------

fn main_window<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(MAIN)
}

fn show_main<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = main_window(app) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn quick_add_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
    if let Some(w) = app.get_webview_window(QUICK_ADD) {
        return Ok(w);
    }
    let b = WebviewWindowBuilder::new(app, QUICK_ADD, WebviewUrl::App("index.html".into()))
        .title(QUICK_ADD_TITLE)
        .inner_size(640.0, 132.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .center();
    // A frameless window on macOS has square corners; a transparent one lets the page draw a rounded
    // panel (QuickAddWindow.svelte), and the system shadow follows its shape. Needs the
    // `macos-private-api` feature. Linux compositors such as Hyprland round windows themselves.
    #[cfg(target_os = "macos")]
    let b = b.transparent(true);
    let w = b.build()?;
    let handle = app.clone();
    w.on_window_event(move |e| match e {
        // Behaves like a launcher: clicking elsewhere dismisses it.
        WindowEvent::Focused(false) => {
            if let Some(w) = handle.get_webview_window(QUICK_ADD) {
                let _ = w.hide();
            }
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            if let Some(w) = handle.get_webview_window(QUICK_ADD) {
                let _ = w.hide();
            }
        }
        _ => {}
    });
    Ok(w)
}

/// Hide the quick-add window after Esc, adding, or a second hotkey press. On macOS, when the main
/// window isn't open either, also hide the app so focus goes back to the app the user came from.
fn dismiss_quick_add<R: Runtime>(app: &AppHandle<R>) {
    if let Some(w) = app.get_webview_window(QUICK_ADD) {
        let _ = w.hide();
    }
    #[cfg(target_os = "macos")]
    if !main_window(app).and_then(|w| w.is_visible().ok()).unwrap_or(false) {
        let _ = app.hide();
    }
}

#[derive(Serialize, Clone)]
struct QuickAddOpen {
    text: String,
    /// An `openthings://add?…` link; the window turns its fields into quick-add text.
    url: Option<String>,
}

/// Show the floating quick-add window, optionally prefilled.
fn open_quick_add<R: Runtime>(app: &AppHandle<R>, text: Option<String>) {
    show_quick_add(app, QuickAddOpen { text: text.unwrap_or_default(), url: None });
}

fn show_quick_add<R: Runtime>(app: &AppHandle<R>, payload: QuickAddOpen) {
    // Undo a previous `dismiss_quick_add` app hide, or the window can't come forward.
    #[cfg(target_os = "macos")]
    let _ = app.show();
    match quick_add_window(app) {
        Ok(w) => {
            let _ = w.emit_to(QUICK_ADD, "ot://quick-add-open", payload);
            let _ = w.center();
            let _ = w.show();
            let _ = w.set_focus();
        }
        Err(_) => {
            // Fall back to the in-app quick add.
            show_main(app);
            let _ = app.emit_to(MAIN, "ot://command", "create.quickadd");
        }
    }
}

/// Run a command from `src/lib/commands.ts` in the main window.
fn run_command<R: Runtime>(app: &AppHandle<R>, id: &str) {
    show_main(app);
    let _ = app.emit_to(MAIN, "ot://command", id.to_string());
}

// ---------- deep links and CLI arguments ----------

/// Handles `openthings://` links (docs/url-scheme.md). The web app parses them (`parseRoute` in
/// `src/lib/native/snapshot.ts`); this only decides which window they go to.
fn handle_url<R: Runtime>(app: &AppHandle<R>, url: &url::Url) {
    if url.scheme() != "openthings" {
        return;
    }
    let (action, link, save) = link_parts(url);
    match action.as_str() {
        // Saved in the background: the main window adds it without being shown or focused (it
        // shows a native notification when it's hidden). Browser extensions send these.
        "add" if save => send_link(app, link),
        "add" => show_quick_add(app, QuickAddOpen { text: String::new(), url: Some(link) }),
        "" | "show" => show_main(app),
        // Lists, tasks, pairing: the main window opens them.
        _ => {
            show_main(app);
            send_link(app, link);
        }
    }
}

/// The action of an `openthings:` link (`add`, `today`, `task`…), the link rebuilt as
/// `openthings://<action>…` (the one form the web app's parser takes), and whether it asks to save
/// without showing quick add. `openthings://add?…` has host "add"; `openthings:add?…` and
/// `openthings:///add?…` have it as the first path segment. `quick-add` is an alias of `add`.
fn link_parts(url: &url::Url) -> (String, String, bool) {
    let first = url.host_str().filter(|h| !h.is_empty()).unwrap_or_else(|| url.path().trim_start_matches('/').split('/').next().unwrap_or(""));
    let after = url.as_str().get("openthings:".len()..).unwrap_or("").trim_start_matches('/');
    let rest = after.get(first.len()..).unwrap_or("");
    let action = match first.to_ascii_lowercase().as_str() {
        "quick-add" => "add".to_string(),
        a => a.to_string(),
    };
    let save = url
        .query_pairs()
        .find(|(k, _)| k == "save")
        .map(|(_, v)| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes"))
        .unwrap_or(false);
    (action.clone(), format!("openthings://{action}{rest}"), save)
}

/// Arguments of a launch (first or forwarded by single-instance). Returns true when they asked for
/// something specific, so a plain launch can show the main window. `urls`: also act on an
/// `openthings://` argument (on a second launch the deep-link plugin already handles it).
fn handle_args<R: Runtime>(app: &AppHandle<R>, args: &[String], urls: bool) -> bool {
    let mut handled = false;
    let mut i = 1;
    while i < args.len() {
        let a = &args[i];
        match a.as_str() {
            "--quick-add" | "-q" => {
                let text = args.get(i + 1).filter(|t| !t.starts_with("--")).cloned();
                if text.is_some() {
                    i += 1;
                }
                open_quick_add(app, text);
                handled = true;
            }
            "--add" => {
                if let Some(text) = args.get(i + 1) {
                    let _ = app.emit_to(MAIN, "ot://add", text.clone());
                    i += 1;
                }
                handled = true;
            }
            "--hidden" => handled = true,
            "--show" => {
                show_main(app);
                handled = true;
            }
            s if s.starts_with("openthings:") => {
                if let Some(u) = url::Url::parse(s).ok().filter(|_| urls) {
                    handle_url(app, &u);
                }
                handled = true;
            }
            _ => {}
        }
        i += 1;
    }
    handled
}

// ---------- global shortcut ----------

fn wayland_session() -> bool {
    cfg!(target_os = "linux") && std::env::var_os("WAYLAND_DISPLAY").is_some()
}

fn apply_hotkey<R: Runtime>(app: &AppHandle<R>, accel: &str) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let shell = app.state::<Arc<Shell>>();
    if !shell.hotkeys_available.load(Ordering::SeqCst) {
        return Err("Global shortcuts aren't available in this session (Wayland). Bind `openthings --quick-add` in your compositor instead.".into());
    }
    let gs = app.global_shortcut();
    gs.unregister_all().map_err(|e| e.to_string())?;
    if accel.trim().is_empty() {
        return Ok(());
    }
    gs.on_shortcut(accel, |app, _shortcut, event| {
        if event.state == tauri_plugin_global_shortcut::ShortcutState::Pressed {
            // Toggle: a second press hides it again.
            if let Some(w) = app.get_webview_window(QUICK_ADD) {
                if w.is_visible().unwrap_or(false) && w.is_focused().unwrap_or(false) {
                    dismiss_quick_add(app);
                    return;
                }
            }
            open_quick_add(app, None);
        }
    })
    .map_err(|e| e.to_string())
}

// ---------- notifications ----------

fn notify<R: Runtime>(app: &AppHandle<R>, title: &str, body: &str, task_id: Option<&str>) {
    let mut n = app.notification().builder().title(title).body(body);
    if let Some(id) = task_id {
        n = n.extra("taskId", id);
    }
    let _ = n.show();
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Parse the ISO timestamps the web app sends (`2026-10-18T15:30:00.000Z`) to epoch ms.
fn parse_iso_ms(s: &str) -> Option<i64> {
    // Minimal RFC 3339 UTC parser, enough for `Date.toISOString()` output.
    let s = s.trim().trim_end_matches('Z');
    let (date, time) = s.split_once('T')?;
    let mut d = date.split('-').map(|p| p.parse::<i64>());
    let (y, m, day) = (d.next()?.ok()?, d.next()?.ok()?, d.next()?.ok()?);
    let mut t = time.split(':');
    let (hh, mm) = (t.next()?.parse::<i64>().ok()?, t.next()?.parse::<i64>().ok()?);
    let sec: f64 = t.next().unwrap_or("0").parse().ok()?;
    // Days from civil (Howard Hinnant's algorithm).
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = if y2 >= 0 { y2 } else { y2 - 399 } / 400;
    let yoe = y2 - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    Some(((days * 86400 + hh * 3600 + mm * 60) as f64 * 1000.0 + sec * 1000.0) as i64)
}

/// Backstop scheduler. The web app's own 1 s timer normally fires reminders; this thread makes sure
/// a native notification still appears on time when the hidden webview's timers are throttled.
fn spawn_reminder_thread<R: Runtime>(app: AppHandle<R>, shell: Arc<Shell>) {
    std::thread::Builder::new()
        .name("reminders".into())
        .spawn(move || loop {
            let now = now_ms();
            let mut next_wait = Duration::from_secs(60);
            let due: Vec<Reminder> = {
                let list = shell.reminders.lock().unwrap();
                let mut due = vec![];
                for r in list.iter() {
                    let Some(at) = parse_iso_ms(&r.at) else { continue };
                    if at <= now {
                        // Only catch up on ones that came due recently; older ones are the web app's.
                        if now - at < 5 * 60_000 {
                            due.push(r.clone());
                        }
                    } else {
                        next_wait = next_wait.min(Duration::from_millis((at - now) as u64));
                    }
                }
                due
            };
            for r in due {
                let mut shown = shell.shown.lock().unwrap();
                if shown.contains_key(&r.task_id) {
                    continue;
                }
                shown.insert(r.task_id.clone(), Instant::now());
                drop(shown);
                notify(&app, &r.title, "Reminder", Some(&r.task_id));
            }
            shell.shown.lock().unwrap().retain(|_, t| t.elapsed() < Duration::from_secs(30 * 60));
            let guard = shell.wake_lock.lock().unwrap();
            let (mut g, _) = shell
                .wake
                .wait_timeout_while(guard, next_wait.max(Duration::from_millis(250)), |woken| !*woken)
                .unwrap();
            *g = false;
        })
        .expect("spawn reminder thread");
}

// ---------- tray ----------

/// The last sync status shown in the tray, so a theme change can redraw the same icon.
static TRAY_STATUS: Mutex<String> = Mutex::new(String::new());

/// The tray icon for a status; on Omarchy, recolored to the current desktop theme.
fn tray_image(status: &str) -> Option<Image<'static>> {
    *TRAY_STATUS.lock().unwrap() = status.to_string();
    let img = stock_tray_image(status)?;
    match omarchy::current_tray_tint() {
        Some(tint) => {
            let mut rgba = img.rgba().to_vec();
            omarchy::tint_rgba(&mut rgba, tint);
            Some(Image::new_owned(rgba, img.width(), img.height()))
        }
        None => Some(img),
    }
}

/// Redraw the tray icon after an Omarchy theme switch.
///
/// Only the icon changes: the tray keeps its id, and so its StatusNotifierItem `Id`
/// ("tray-icon tray app openthings-tray"), which omarchy-bar pins tray items by. The bar restarts
/// on a theme switch, so the icon is set once the new bar is likely up (and again later in case it
/// was slow), rather than while the StatusNotifierWatcher is going away.
fn retint_tray(app: &AppHandle) {
    let app = app.clone();
    let _ = std::thread::Builder::new().name("omarchy-tray".into()).spawn(move || {
        for delay in [2, 4] {
            std::thread::sleep(std::time::Duration::from_secs(delay));
            let status = TRAY_STATUS.lock().unwrap().clone();
            if let Some(tray) = app.tray_by_id(TRAY_ID) {
                // TrayIcon::set_icon already runs on the main thread.
                let _ = tray.set_icon(tray_image(if status.is_empty() { "local" } else { &status }));
            }
        }
    });
}

fn stock_tray_image(status: &str) -> Option<Image<'static>> {
    let bytes = match status {
        "idle" | "syncing" => TRAY_SYNCED,
        "pending" => TRAY_PENDING,
        "offline" => TRAY_OFFLINE,
        "error" => TRAY_ERROR,
        _ => TRAY_LOCAL,
    };
    Image::from_bytes(bytes).ok()
}

fn build_tray(app: &AppHandle, shell: &Arc<Shell>) -> tauri::Result<TrayIcon> {
    let status = MenuItemBuilder::with_id("tray:status", "Sync: local only").enabled(false).build(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &MenuItemBuilder::with_id("tray:show", "Show OpenThings").build(app)?,
            &MenuItemBuilder::with_id("tray:quickadd", "Quick Add…").build(app)?,
            &PredefinedMenuItem::separator(app)?,
            &status,
            &MenuItemBuilder::with_id("tray:sync", "Sync Now").build(app)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItemBuilder::with_id("tray:quit", "Quit OpenThings").build(app)?,
        ],
    )?;
    *shell.tray_status.lock().unwrap() = Some(status);
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(tray_image("local").expect("tray icon"))
        .tooltip("OpenThings")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            // Left click opens the window (macOS / Windows; Linux trays always show the menu).
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        })
        .build(app)
}

// ---------- macOS menu bar ----------

/// Items are `cmd:<command id>` and run that command from `src/lib/commands.ts`. Accelerators are
/// only given where they can't swallow typing (⌘ chords, ⌥ digits); single-key shortcuts like `Q`
/// stay in the web app, and the menu shows them in the title instead.
fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, text: &str, accel: Option<&str>| -> tauri::Result<MenuItem<R>> {
        let mut b = MenuItemBuilder::with_id(format!("cmd:{id}"), text);
        if let Some(a) = accel {
            b = b.accelerator(a);
        }
        b.build(app)
    };
    let sep = || PredefinedMenuItem::separator(app);

    let app_menu: Submenu<R> = SubmenuBuilder::new(app, "OpenThings")
        .item(&PredefinedMenuItem::about(app, Some("About OpenThings"), None)?)
        .item(&sep()?)
        .item(&item("go.settings", "Settings…", Some("CmdOrCtrl+,"))?)
        .item(&sep()?)
        .item(&PredefinedMenuItem::services(app, None)?)
        .item(&sep()?)
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .item(&sep()?)
        // Our own Quit (not the predefined one) so ⌘Q goes through the save-then-exit path below.
        .item(&MenuItemBuilder::with_id("app:quit", "Quit OpenThings").accelerator("CmdOrCtrl+Q").build(app)?)
        .build()?;

    let file = SubmenuBuilder::new(app, "File")
        .item(&item("create.quickadd", "New To-Do", Some("CmdOrCtrl+N"))?)
        .item(&item("create.dump", "New Brain Dump Item          B", None)?)
        .item(&item("create.project", "New Project          ⇧N", None)?)
        .item(&item("create.area", "New Area          ⇧A", None)?)
        .item(&sep()?)
        .item(&MenuItemBuilder::with_id("app:quickadd-window", "Quick Add Window").build(app)?)
        .item(&sep()?)
        .item(&item("app.export", "Export JSON Backup…", Some("CmdOrCtrl+Shift+E"))?)
        .item(&sep()?)
        .item(&PredefinedMenuItem::close_window(app, Some("Close Window"))?)
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .item(&sep()?)
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .item(&sep()?)
        .item(&item("app.find", "Find…", Some("CmdOrCtrl+F"))?)
        .item(&item("app.palette", "Command Palette…", Some("CmdOrCtrl+K"))?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&item("go.inbox", "Inbox", Some("Alt+1"))?)
        .item(&item("go.today", "Today", Some("Alt+2"))?)
        .item(&item("go.upcoming", "Upcoming", Some("Alt+3"))?)
        .item(&item("go.anytime", "Anytime", Some("Alt+4"))?)
        .item(&item("go.someday", "Someday", Some("Alt+5"))?)
        .item(&item("go.logbook", "Logbook", Some("Alt+6"))?)
        .item(&item("go.dump", "Brain Dump", Some("Alt+7"))?)
        .item(&item("go.habits", "Habits", Some("Alt+8"))?)
        .item(&item("go.matrix", "Matrix", Some("Alt+9"))?)
        .item(&item("go.trash", "Trash", Some("Alt+0"))?)
        .item(&sep()?)
        .item(&item("app.sidebar", "Show / Hide Sidebar", Some("CmdOrCtrl+/"))?)
        .item(&item("app.theme", "Toggle Dark Mode          ⇧D", None)?)
        .item(&sep()?)
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, Some("Zoom"))?)
        .item(&sep()?)
        .item(&MenuItemBuilder::with_id("app:show", "OpenThings").build(app)?)
        .build()?;

    let help = SubmenuBuilder::new(app, "Help")
        .item(&item("app.help", "Keyboard Shortcuts          ?", None)?)
        .build()?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &view, &window, &help])
}

// ---------- commands called by the web app ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopInfo {
    platform: &'static str,
    wayland: bool,
    hotkey: String,
    default_hotkey: &'static str,
    hotkeys_available: bool,
    hotkey_error: Option<String>,
    /// Hyprland session: the shortcut is a bind in this config file instead of a key grab.
    hyprland_config: Option<String>,
    /// Hyprland: whether that file is in place and sourced.
    hyprland_bound: bool,
    autostart: bool,
    version: String,
}

#[tauri::command]
fn desktop_info(app: AppHandle, shell: tauri::State<Arc<Shell>>) -> DesktopInfo {
    DesktopInfo {
        platform: std::env::consts::OS,
        wayland: wayland_session(),
        hotkey: shell.settings.lock().unwrap().hotkey.clone(),
        default_hotkey: default_hotkey(),
        hotkeys_available: shell.hotkeys_available.load(Ordering::SeqCst),
        hotkey_error: shell.hotkey_error.lock().unwrap().clone(),
        hyprland_config: hyprland::session()
            .then(hyprland::config_file)
            .flatten()
            .map(|p| p.display().to_string()),
        hyprland_bound: hyprland::session() && hyprland::bound(),
        autostart: app.autolaunch().is_enabled().unwrap_or(false),
        version: app.package_info().version.to_string(),
    }
}

#[tauri::command]
fn set_hotkey(app: AppHandle, shell: tauri::State<Arc<Shell>>, hotkey: String) -> Result<(), String> {
    if hyprland::session() {
        if let Err(e) = hyprland::apply(&hotkey) {
            hyprland::pause(&shell.settings.lock().unwrap().hotkey, false);
            return Err(e);
        }
        let mut s = shell.settings.lock().unwrap();
        s.hotkey = hotkey;
        return save_settings(&app, &s);
    }
    let previous = shell.settings.lock().unwrap().hotkey.clone();
    if let Err(e) = apply_hotkey(&app, &hotkey) {
        // Put the old one back so the user isn't left without a shortcut.
        let _ = apply_hotkey(&app, &previous);
        return Err(e);
    }
    let mut s = shell.settings.lock().unwrap();
    s.hotkey = hotkey;
    *shell.hotkey_error.lock().unwrap() = None;
    save_settings(&app, &s)
}

/// Settings is recording a shortcut: release the current one so its keys reach the recorder.
/// `set_hotkey` turns it back on; this is for a cancelled recording.
#[tauri::command]
fn pause_hotkey(app: AppHandle, shell: tauri::State<Arc<Shell>>, paused: bool) -> Result<(), String> {
    let current = shell.settings.lock().unwrap().hotkey.clone();
    if hyprland::session() {
        hyprland::pause(&current, paused);
        return Ok(());
    }
    if !shell.hotkeys_available.load(Ordering::SeqCst) {
        return Ok(());
    }
    apply_hotkey(&app, if paused { "" } else { &current })
}

#[tauri::command]
fn set_autostart(app: AppHandle, enabled: bool) -> Result<bool, String> {
    let al = app.autolaunch();
    if enabled { al.enable() } else { al.disable() }.map_err(|e| e.to_string())?;
    al.is_enabled().map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SyncInfo {
    status: String,
    label: String,
}

#[tauri::command]
fn set_sync_status(app: AppHandle, shell: tauri::State<Arc<Shell>>, info: SyncInfo) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_icon(tray_image(&info.status));
        let _ = tray.set_tooltip(Some(format!("OpenThings · {}", info.label)));
    }
    if let Some(item) = shell.tray_status.lock().unwrap().as_ref() {
        let _ = item.set_text(format!("Sync: {}", info.label));
    }
}

#[tauri::command]
fn set_reminders(shell: tauri::State<Arc<Shell>>, reminders: Vec<Reminder>) {
    *shell.reminders.lock().unwrap() = reminders;
    *shell.wake_lock.lock().unwrap() = true;
    shell.wake.notify_all();
}

/// Show a native notification. Reminders the backstop thread already showed are skipped.
#[tauri::command]
fn show_notification(app: AppHandle, shell: tauri::State<Arc<Shell>>, title: String, body: String, task_id: Option<String>) {
    if let Some(id) = &task_id {
        let mut shown = shell.shown.lock().unwrap();
        if shown.get(id).is_some_and(|t| t.elapsed() < Duration::from_secs(15 * 60)) {
            return;
        }
        shown.insert(id.clone(), Instant::now());
    }
    notify(&app, &title, &body, task_id.as_deref());
}

/// From the quick-add window: add the to-do in the main window (one database, one op log).
#[tauri::command]
fn submit_quick_add(app: AppHandle, text: String, keep_open: bool) {
    let _ = app.emit_to(MAIN, "ot://add", text);
    if !keep_open {
        hide_quick_add(app);
    }
}

#[tauri::command]
fn hide_quick_add(app: AppHandle) {
    dismiss_quick_add(&app);
}

#[tauri::command]
fn show_main_window(app: AppHandle) {
    show_main(&app);
}

/// Settings → Sync links here so people know sync needs the server (the Docker image).
const SELF_HOSTING_DOCS: &str = "https://github.com/spuder/OpenThings#self-hosting";

/// Open the self-hosting docs in the default browser. The URL is fixed, so pages can't open others.
#[tauri::command]
fn open_self_hosting_docs() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(not(target_os = "macos"))]
    let opener = "xdg-open";
    std::process::Command::new(opener)
        .arg(SELF_HOSTING_DOCS)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// The Omarchy desktop theme to follow, or null when this isn't an Omarchy desktop.
#[tauri::command]
fn omarchy_theme() -> Option<omarchy::Current> {
    omarchy::read()
}

/// The web app saved its database; exit now.
#[tauri::command]
fn quit_now(app: AppHandle, shell: tauri::State<Arc<Shell>>) {
    shell.quitting.store(true, Ordering::SeqCst);
    app.exit(0);
}

// ---------- entry point ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let shell = Arc::new(Shell::default());
    let hotkeys = !wayland_session();
    shell.hotkeys_available.store(hotkeys, Ordering::SeqCst);

    let mut builder = tauri::Builder::default()
        // Must be first: a second launch forwards its arguments here and exits.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !handle_args(app, &args, false) {
                show_main(app);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_denylist(&[QUICK_ADD])
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::all() - tauri_plugin_window_state::StateFlags::VISIBLE,
                )
                .build(),
        )
        .plugin(tauri_plugin_autostart::Builder::new().arg("--hidden").build());

    // On Wayland, apps can't grab global keys; the compositor binds `openthings --quick-add`.
    if hotkeys {
        builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());
    }

    builder
        .manage(shell.clone())
        .invoke_handler(tauri::generate_handler![
            desktop_info,
            set_hotkey,
            pause_hotkey,
            set_autostart,
            set_sync_status,
            set_reminders,
            show_notification,
            submit_quick_add,
            hide_quick_add,
            show_main_window,
            main_ready,
            open_self_hosting_docs,
            omarchy_theme,
            quit_now,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();

            // Settings and the global shortcut.
            let settings = load_settings(&handle);
            *shell.settings.lock().unwrap() = settings.clone();
            if hotkeys {
                if let Err(e) = apply_hotkey(&handle, &settings.hotkey) {
                    *shell.hotkey_error.lock().unwrap() = Some(e);
                }
            }

            // Main window: hide instead of close, so reminders and sync keep running.
            if let Some(w) = main_window(&handle) {
                let h = handle.clone();
                w.on_window_event(move |e| {
                    if let WindowEvent::CloseRequested { api, .. } = e {
                        api.prevent_close();
                        if let Some(w) = main_window(&h) {
                            let _ = w.hide();
                        }
                    }
                });
            }
            // Create the quick-add window up front so the hotkey opens it instantly.
            let _ = quick_add_window(&handle);

            #[cfg(target_os = "macos")]
            {
                let menu = build_app_menu(&handle)?;
                app.set_menu(menu)?;
            }
            #[cfg(not(target_os = "macos"))]
            let _ = build_app_menu::<tauri::Wry>; // the menu bar is macOS only; elsewhere keys go to the web app

            app.on_menu_event(|app, event| {
                let id = event.id().as_ref();
                match id {
                    "tray:show" | "app:show" => show_main(app),
                    "tray:quickadd" | "app:quickadd-window" => open_quick_add(app, None),
                    "tray:sync" => {
                        let _ = app.emit_to(MAIN, "ot://sync-now", ());
                    }
                    "tray:quit" | "app:quit" => app.exit(0),
                    _ => {
                        if let Some(cmd) = id.strip_prefix("cmd:") {
                            run_command(app, cmd);
                        }
                    }
                }
            });

            if let Err(e) = build_tray(&handle, &shell) {
                eprintln!("openthings: tray icon unavailable: {e}");
            }

            // Notification clicks open the task.
            {
                let h = handle.clone();
                let _ = handle.notification().on_action(move |performed| {
                    if performed.action_id() != "tap" {
                        return;
                    }
                    show_main(&h);
                    let task = performed
                        .notification()
                        .and_then(|n| n.extra().get("taskId").and_then(|v| v.as_str().map(str::to_owned)));
                    if let Some(id) = task {
                        let _ = h.emit_to(MAIN, "ot://reveal", id);
                    }
                });
            }

            spawn_reminder_thread(handle.clone(), shell.clone());
            omarchy::watch(handle.clone(), retint_tray);

            // Deep links: register the scheme for AppImages (packages ship it in their .desktop file).
            #[cfg(target_os = "linux")]
            if std::env::var_os("APPIMAGE").is_some() {
                let _ = handle.deep_link().register_all();
            }
            {
                let h = handle.clone();
                handle.deep_link().on_open_url(move |event| {
                    for u in event.urls() {
                        handle_url(&h, &u);
                    }
                });
            }
            // First launch: show the window unless started at login (--hidden), for quick add, or by
            // a link (Linux passes it as an argument; macOS delivers it through `on_open_url`).
            let args: Vec<String> = std::env::args().collect();
            if !handle_args(&handle, &args, true) {
                show_main(&handle);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building OpenThings")
        .run(move |app, event| match event {
            // Dock icon clicked with no visible window.
            #[cfg(target_os = "macos")]
            RunEvent::Reopen { .. } => show_main(app),
            // Give the web app a moment to flush its database to IndexedDB before quitting.
            RunEvent::ExitRequested { api, code, .. } => {
                let shell = app.state::<Arc<Shell>>();
                if code.is_none() {
                    // Last window closed: we keep running in the tray.
                    api.prevent_exit();
                    return;
                }
                if !shell.quitting.swap(true, Ordering::SeqCst) {
                    api.prevent_exit();
                    let _ = app.emit_to(MAIN, "ot://will-quit", ());
                    let h = app.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(1500));
                        h.exit(0);
                    });
                }
            }
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::{link_parts, parse_iso_ms, LinkQueue};

    fn parts(s: &str) -> (String, String, bool) {
        link_parts(&url::Url::parse(s).unwrap())
    }

    #[test]
    fn link_forms() {
        let add = |save| ("add".to_string(), "openthings://add?title=Milk&save=1".to_string(), save);
        assert_eq!(parts("openthings://add?title=Milk&save=1"), add(true));
        assert_eq!(parts("openthings:///add?title=Milk&save=1"), add(true));
        assert_eq!(parts("openthings:add?title=Milk&save=1"), add(true));
        assert_eq!(parts("openthings://quick-add?text=Hi").1, "openthings://add?text=Hi");
        assert_eq!(parts("openthings://add?text=Hi&save=no").2, false);
        assert_eq!(parts("openthings://today"), ("today".into(), "openthings://today".into(), false));
        assert_eq!(parts("openthings:///task/abc-1"), ("task".into(), "openthings://task/abc-1".into(), false));
        assert_eq!(parts("openthings://show").0, "show");
    }

    #[test]
    fn links_wait_for_the_main_window() {
        let mut q = LinkQueue::default();
        assert_eq!(q.offer("openthings://add?title=A&save=1".into()), None);
        assert_eq!(q.offer("openthings://today".into()), None);
        assert_eq!(q.take(), vec!["openthings://add?title=A&save=1".to_string(), "openthings://today".into()]);
        assert_eq!(q.offer("openthings://add?title=B&save=1".into()).as_deref(), Some("openthings://add?title=B&save=1"));
        assert!(q.take().is_empty());
    }

    #[test]
    fn save_flag_only_for_yes_values() {
        assert!(parts("openthings://add?title=A&save=true").2);
        assert!(parts("openthings://add?title=A&save=YES").2);
        assert!(!parts("openthings://add?title=A").2);
        assert!(!parts("openthings://add?title=A&save=0").2);
        assert!(!parts("openthings://today?save=1").0.eq("add"));
    }

    #[test]
    fn parses_js_iso_strings() {
        assert_eq!(parse_iso_ms("1970-01-01T00:00:00.000Z"), Some(0));
        assert_eq!(parse_iso_ms("2026-10-18T15:30:00.000Z"), Some(1_792_337_400_000));
        assert_eq!(parse_iso_ms("2000-02-29T12:00:01.500Z"), Some(951_825_601_500));
        assert_eq!(parse_iso_ms("nonsense"), None);
    }
}
