//! Follow the Omarchy desktop theme.
//!
//! `omarchy-theme-set` copies the chosen theme to `~/.local/state/omarchy/current/theme` (older
//! releases: a symlink at `~/.config/omarchy/current/theme`) and writes its name to `theme.name`
//! next to it. We send the theme's `colors.toml` to the web app, which maps it onto its own color
//! tokens, and poll for changes: the theme directory is replaced on every switch, so a file watch
//! would need re-arming anyway, and a stat a second costs nothing.

use std::{
    path::PathBuf,
    time::{Duration, SystemTime},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Runtime};

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct Current {
    /// Theme id as Omarchy names it, e.g. "tokyo-night".
    pub id: String,
    /// Contents of the theme's colors.toml.
    pub colors: String,
}

fn home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from).filter(|p| p.is_absolute())
}

/// The `current` directories, newest layout first.
fn current_dirs() -> Vec<PathBuf> {
    let Some(h) = home() else { return vec![] };
    vec![h.join(".local/state/omarchy/current"), h.join(".config/omarchy/current")]
}

/// The current theme's directory and its colors.toml, if this is an Omarchy desktop.
fn colors_file() -> Option<(PathBuf, PathBuf)> {
    if !cfg!(target_os = "linux") {
        return None;
    }
    current_dirs().into_iter().find_map(|dir| {
        let file = dir.join("theme/colors.toml");
        file.is_file().then_some((dir, file))
    })
}

/// Whether the desktop has an Omarchy theme to follow.
pub fn active() -> bool {
    colors_file().is_some()
}

pub fn read() -> Option<Current> {
    let (dir, file) = colors_file()?;
    let colors = std::fs::read_to_string(&file).ok()?;
    let id = std::fs::read_to_string(dir.join("theme.name"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        // Older Omarchy: `theme` is a symlink to the theme's own directory.
        .or_else(|| {
            std::fs::read_link(dir.join("theme"))
                .ok()
                .and_then(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        })
        .unwrap_or_else(|| "omarchy".into());
    Some(Current { id, colors })
}

/// What changes when the theme does: the colors file's identity and the theme name.
fn fingerprint() -> Option<(SystemTime, u64, String)> {
    let (dir, file) = colors_file()?;
    let meta = std::fs::metadata(&file).ok()?;
    let name = std::fs::read_to_string(dir.join("theme.name")).unwrap_or_default();
    Some((meta.modified().ok()?, meta.len(), name))
}

/// Emit `ot://omarchy-theme` to every window whenever the desktop theme changes.
pub fn watch<R: Runtime>(app: AppHandle<R>) {
    if !active() {
        return;
    }
    let _ = std::thread::Builder::new().name("omarchy-theme".into()).spawn(move || {
        let mut last = fingerprint();
        loop {
            std::thread::sleep(Duration::from_secs(1));
            let now = fingerprint();
            // Mid-switch the directory is briefly missing; keep the old theme until the new one lands.
            if now.is_none() || now == last {
                continue;
            }
            if let Some(cur) = read() {
                last = now;
                let _ = app.emit("ot://omarchy-theme", cur);
            }
        }
    });
}
