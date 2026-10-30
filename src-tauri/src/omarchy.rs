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
/// `on_change` runs on the watcher thread after each switch (the tray retints there).
pub fn watch<R: Runtime>(app: AppHandle<R>, on_change: impl Fn(&AppHandle<R>) + Send + 'static) {
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
                on_change(&app);
            }
        }
    });
}

// ---------- tray icon tint ----------

/// The colors the tray icon is drawn in: the badge takes the theme's accent, the glyph its background,
/// so the icon reads like the rest of Waybar on light and dark themes alike.
#[derive(Clone, Copy, PartialEq, Debug)]
pub struct TrayTint {
    pub badge: [u8; 3],
    pub glyph: [u8; 3],
}

fn hex(s: &str) -> Option<[u8; 3]> {
    let h = s.trim().trim_matches(|c| c == '"' || c == '\'').trim_start_matches('#');
    if h.len() != 6 || !h.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let p = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
    Some([p(0)?, p(2)?, p(4)?])
}

/// Read `key = "#rrggbb"` lines from a colors.toml (the flat format Omarchy themes use).
pub fn color(toml: &str, key: &str) -> Option<[u8; 3]> {
    toml.lines().find_map(|line| {
        if line.trim_start().starts_with('#') {
            return None;
        }
        let (k, v) = line.split_once('=')?;
        if k.trim() != key {
            return None;
        }
        // Strip a trailing comment after the quoted value.
        let v = v.trim();
        let v = match v.strip_prefix('"') {
            Some(rest) => rest.split('"').next()?,
            None => v.split_whitespace().next()?,
        };
        hex(v)
    })
}

/// The tray tint for a theme, or None when it lacks a background and foreground (like the web app).
pub fn tray_tint(toml: &str) -> Option<TrayTint> {
    let background = color(toml, "background")?;
    let foreground = color(toml, "foreground")?;
    let badge = color(toml, "accent").or_else(|| color(toml, "blue")).unwrap_or(foreground);
    // A badge too close to the background would vanish into the bar; fall back to the foreground.
    let badge = if distance(badge, background) < 60.0 { foreground } else { badge };
    Some(TrayTint { badge, glyph: background })
}

/// The tint for the current desktop theme, if this is Omarchy.
pub fn current_tray_tint() -> Option<TrayTint> {
    read().and_then(|c| tray_tint(&c.colors))
}

fn distance(a: [u8; 3], b: [u8; 3]) -> f32 {
    (0..3).map(|i| (a[i] as f32 - b[i] as f32).powi(2)).sum::<f32>().sqrt()
}

/// The stock tray icons: a blue badge with a white glyph (antialiased between them), plus a status dot.
const BRAND: [f32; 3] = [47.0, 111.0, 237.0];
const WHITE: [f32; 3] = [255.0, 255.0, 255.0];

/// Recolor RGBA pixels of a stock tray icon: brand blue → badge, white → glyph, blends in between.
/// Status-dot colors (red, amber, grey) sit far from the blue–white line and are left alone.
pub fn tint_rgba(rgba: &mut [u8], tint: TrayTint) {
    let d: [f32; 3] = [WHITE[0] - BRAND[0], WHITE[1] - BRAND[1], WHITE[2] - BRAND[2]];
    let dd: f32 = d.iter().map(|x| x * x).sum();
    for px in rgba.chunks_exact_mut(4) {
        if px[3] == 0 {
            continue;
        }
        let v = [px[0] as f32 - BRAND[0], px[1] as f32 - BRAND[1], px[2] as f32 - BRAND[2]];
        let t = ((v[0] * d[0] + v[1] * d[1] + v[2] * d[2]) / dd).clamp(0.0, 1.0);
        let off: f32 = (0..3).map(|i| (v[i] - t * d[i]).powi(2)).sum::<f32>().sqrt();
        if off > 40.0 {
            continue;
        }
        for i in 0..3 {
            px[i] = (tint.badge[i] as f32 * (1.0 - t) + tint.glyph[i] as f32 * t).round() as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DARK: &str = "accent = \"#7aa2f7\"\nbackground = \"#1a1b26\" # bg\nforeground = \"#a9b1d6\"\n# accent = \"#000000\"\n";
    const LIGHT: &str = "background = '#eff1f5'\nforeground = \"#4c4f69\"\naccent = \"#1e66f5\"\n";

    #[test]
    fn parses_colors() {
        assert_eq!(color(DARK, "accent"), Some([0x7a, 0xa2, 0xf7]));
        assert_eq!(color(DARK, "background"), Some([0x1a, 0x1b, 0x26]));
        assert_eq!(color(LIGHT, "background"), Some([0xef, 0xf1, 0xf5]));
        assert_eq!(color(DARK, "red"), None);
        assert_eq!(color("accent = \"#zzzzzz\"", "accent"), None);
    }

    #[test]
    fn tint_follows_light_and_dark() {
        let d = tray_tint(DARK).unwrap();
        assert_eq!(d, TrayTint { badge: [0x7a, 0xa2, 0xf7], glyph: [0x1a, 0x1b, 0x26] });
        let l = tray_tint(LIGHT).unwrap();
        assert_eq!(l.glyph, [0xef, 0xf1, 0xf5]);
        assert_eq!(tray_tint("accent = \"#ffffff\""), None);
    }

    #[test]
    fn badge_falls_back_when_invisible() {
        let t = tray_tint("background = \"#111111\"\nforeground = \"#eeeeee\"\naccent = \"#121212\"").unwrap();
        assert_eq!(t.badge, [0xee, 0xee, 0xee]);
    }

    #[test]
    fn recolors_brand_and_glyph_but_not_status_dot() {
        let tint = TrayTint { badge: [10, 20, 30], glyph: [200, 210, 220] };
        let mut px = vec![47, 111, 237, 255, 255, 255, 255, 255, 224, 69, 60, 255, 140, 140, 148, 255, 0, 0, 0, 0];
        tint_rgba(&mut px, tint);
        assert_eq!(&px[0..4], &[10, 20, 30, 255]);
        assert_eq!(&px[4..8], &[200, 210, 220, 255]);
        assert_eq!(&px[8..12], &[224, 69, 60, 255]);
        assert_eq!(&px[12..16], &[140, 140, 148, 255]);
        assert_eq!(&px[16..20], &[0, 0, 0, 0]);
    }

    #[test]
    fn tints_real_icons() {
        let tint = TrayTint { badge: [10, 20, 30], glyph: [200, 210, 220] };
        for bytes in [&include_bytes!("../icons/tray/error.png")[..], &include_bytes!("../icons/tray/local.png")[..]] {
            let img = tauri::image::Image::from_bytes(bytes).unwrap();
            let mut rgba = img.rgba().to_vec();
            tint_rgba(&mut rgba, tint);
            assert!(!rgba.chunks_exact(4).any(|p| p[3] == 255 && p[..3] == [47, 111, 237]));
        }
    }
}
