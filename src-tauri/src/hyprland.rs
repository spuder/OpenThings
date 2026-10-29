//! Global quick-add shortcut on Hyprland (Omarchy).
//!
//! Wayland apps can't grab global keys, so instead of registering the shortcut we write it into a
//! small config file that Hyprland sources: `~/.config/hypr/openthings.conf` holds the `bind` (exec
//! `openthings --quick-add`) and the window rules that float the quick-add window. Hyprland reloads
//! its config when a file changes, so a new shortcut works right away. We only touch the user's
//! `hyprland.conf` once, to append a `source = …` line, and only when they pick a shortcut in
//! Settings → Desktop.

use std::{
    path::{Path, PathBuf},
    process::Command,
};

/// File name of the config we manage, next to `hyprland.conf`.
const FILE: &str = "openthings.conf";

pub fn session() -> bool {
    cfg!(target_os = "linux") && std::env::var_os("HYPRLAND_INSTANCE_SIGNATURE").is_some()
}

fn config_dir() -> Option<PathBuf> {
    let base = std::env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))?;
    Some(base.join("hypr"))
}

/// Path of our managed config file.
pub fn config_file() -> Option<PathBuf> {
    config_dir().map(|d| d.join(FILE))
}

/// Whether `hyprland.conf` sources our file and the file has a bind in it.
pub fn bound() -> bool {
    let (Some(dir), Some(file)) = (config_dir(), config_file()) else { return false };
    let main = std::fs::read_to_string(dir.join("hyprland.conf")).unwrap_or_default();
    let ours = std::fs::read_to_string(file).unwrap_or_default();
    sources_us(&main) && ours.lines().any(|l| l.trim_start().starts_with("bind"))
}

/// Write `accel` (Tauri accelerator syntax, "" = off) into our config and make sure Hyprland
/// sources it.
pub fn apply(accel: &str) -> Result<(), String> {
    let dir = config_dir().ok_or("Couldn't find ~/.config/hypr")?;
    let main = dir.join("hyprland.conf");
    let main_text = std::fs::read_to_string(&main)
        .map_err(|_| format!("Couldn't read {}. Add the bind to your Hyprland config by hand.", main.display()))?;

    let bind = if accel.trim().is_empty() {
        None
    } else {
        let (mods, key) = to_hyprland(accel).ok_or_else(|| format!("Hyprland can't bind {accel}"))?;
        if let Some(other) = conflict(&mods, &key) {
            return Err(format!("{} is already bound in Hyprland ({other}). Pick another shortcut.", pretty(accel)));
        }
        Some((mods, key))
    };

    let file = dir.join(FILE);
    let text = render(bind.as_ref().map(|(m, k)| (m.as_str(), k.as_str())), &exec_command(), new_window_rules());
    std::fs::write(&file, text).map_err(|e| format!("Couldn't write {}: {e}", file.display()))?;

    if !sources_us(&main_text) {
        let mut t = main_text;
        if !t.ends_with('\n') && !t.is_empty() {
            t.push('\n');
        }
        t.push_str(&format!("\n# OpenThings quick add (managed in OpenThings → Settings → Desktop)\nsource = {}\n", file.display()));
        std::fs::write(&main, t).map_err(|e| format!("Couldn't update {}: {e}", main.display()))?;
    }

    // Hyprland reloads changed config files by itself unless that's turned off.
    if hyprctl(&["getoption", "misc:disable_autoreload", "-j"])
        .and_then(|j| serde_json::from_str::<serde_json::Value>(&j).ok())
        .and_then(|v| v["int"].as_i64())
        == Some(1)
    {
        let _ = hyprctl(&["reload"]);
    }
    Ok(())
}

/// Take our bind out of Hyprland while Settings records a new shortcut (so pressing the current
/// one reaches the recorder), or put it back. Runtime only; the config file is unchanged.
pub fn pause(accel: &str, paused: bool) {
    let Some((mods, key)) = to_hyprland(accel) else { return };
    if paused {
        let _ = hyprctl(&["keyword", "unbind", &format!("{mods}, {key}")]);
    } else if bound() {
        let _ = hyprctl(&["keyword", "bind", &format!("{mods}, {key}, exec, {}", exec_command())]);
    }
}

fn sources_us(main: &str) -> bool {
    main.lines().map(str::trim).any(|l| l.starts_with("source") && l.contains(FILE))
}

fn hyprctl(args: &[&str]) -> Option<String> {
    let out = Command::new("hyprctl").args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// How Hyprland should start us: the AppImage when running from one, else this binary.
fn exec_command() -> String {
    let path = std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .or_else(|| std::env::current_exe().ok())
        .unwrap_or_else(|| PathBuf::from("openthings"));
    format!("{} --quick-add", shell_quote(&path))
}

fn shell_quote(p: &Path) -> String {
    let s = p.to_string_lossy();
    if s.chars().all(|c| c.is_ascii_alphanumeric() || "/._-+".contains(c)) {
        s.into_owned()
    } else {
        format!("'{}'", s.replace('\'', r"'\''"))
    }
}

/// Hyprland 0.53 replaced `windowrulev2` with `windowrule { … }` blocks. Unknown version: new syntax.
fn new_window_rules() -> bool {
    hyprctl(&["version", "-j"])
        .and_then(|j| serde_json::from_str::<serde_json::Value>(&j).ok())
        .and_then(|v| v["tag"].as_str().and_then(parse_version))
        .map_or(true, |v| v >= (0, 53))
}

fn parse_version(tag: &str) -> Option<(u32, u32)> {
    let mut parts = tag.trim_start_matches('v').split(['.', '-']);
    Some((parts.next()?.parse().ok()?, parts.next()?.parse().ok()?))
}

/// Another bind on the same keys, from `hyprctl binds -j`; None if free or it's ours.
fn conflict(mods: &str, key: &str) -> Option<String> {
    let binds: serde_json::Value = serde_json::from_str(&hyprctl(&["binds", "-j"])?).ok()?;
    let mask = modmask(mods);
    binds.as_array()?.iter().find_map(|b| {
        let same = b["modmask"].as_u64() == Some(mask) && b["key"].as_str().is_some_and(|k| k.eq_ignore_ascii_case(key));
        let arg = b["arg"].as_str().unwrap_or_default();
        (same && !arg.contains("--quick-add")).then(|| format!("{} {arg}", b["dispatcher"].as_str().unwrap_or_default()).trim().to_string())
    })
}

fn modmask(mods: &str) -> u64 {
    mods.split_whitespace()
        .map(|m| match m {
            "SHIFT" => 1,
            "CTRL" => 4,
            "ALT" => 8,
            "SUPER" => 64,
            _ => 0,
        })
        .sum()
}

/// "Control+Alt+Space" -> ("CTRL ALT", "SPACE"). Key names are xkb keysyms.
pub fn to_hyprland(accel: &str) -> Option<(String, String)> {
    let parts: Vec<&str> = accel.split('+').map(str::trim).collect();
    let (key, mods) = parts.split_last()?;
    let mods = mods
        .iter()
        .map(|m| match *m {
            "Control" | "Ctrl" => Some("CTRL"),
            "Alt" | "Option" => Some("ALT"),
            "Shift" => Some("SHIFT"),
            "Super" | "Meta" | "Command" | "Cmd" => Some("SUPER"),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    if mods.is_empty() {
        return None;
    }
    let key = match *key {
        "Space" => "SPACE".to_string(),
        "Enter" => "Return".into(),
        "Tab" => "Tab".into(),
        "Escape" => "Escape".into(),
        "Backspace" => "BackSpace".into(),
        "Delete" => "Delete".into(),
        "Home" => "Home".into(),
        "End" => "End".into(),
        "Up" | "Down" | "Left" | "Right" => key.to_lowercase(),
        "`" => "grave".into(),
        "-" => "minus".into(),
        "=" => "equal".into(),
        "[" => "bracketleft".into(),
        "]" => "bracketright".into(),
        "\\" => "backslash".into(),
        ";" => "semicolon".into(),
        "'" => "apostrophe".into(),
        "," => "comma".into(),
        "." => "period".into(),
        "/" => "slash".into(),
        k if k.len() == 1 && k.chars().all(|c| c.is_ascii_alphanumeric()) => k.to_uppercase(),
        k if k.starts_with('F') && k[1..].parse::<u8>().is_ok() => k.to_string(),
        _ => return None,
    };
    Some((mods.join(" "), key))
}

fn pretty(accel: &str) -> String {
    accel.replace("Control", "Ctrl")
}

/// Contents of `openthings.conf`. `bind`: (mods, key), None = shortcut off (window rules stay).
fn render(bind: Option<(&str, &str)>, exec: &str, new_rules: bool) -> String {
    let mut s = String::from(
        "# Written by OpenThings (Settings → Desktop). Changes here are overwritten when you pick a\n\
         # new shortcut there; to stop using it, choose \"Turn off\" or remove the `source` line.\n\n",
    );
    match bind {
        Some((mods, key)) => s.push_str(&format!("bind = {mods}, {key}, exec, {exec}\n\n")),
        None => s.push_str("# Global quick-add shortcut: off\n\n"),
    }
    let title = "^(OpenThings Quick Add)$";
    if new_rules {
        s.push_str(&format!(
            "windowrule {{\n  name = openthings-quick-add\n  match:title = {title}\n  float = on\n  center = on\n  pin = on\n}}\n"
        ));
    } else {
        for rule in ["float", "center", "pin"] {
            s.push_str(&format!("windowrulev2 = {rule}, title:{title}\n"));
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_accelerators() {
        assert_eq!(to_hyprland("Super+Alt+Space"), Some(("SUPER ALT".into(), "SPACE".into())));
        assert_eq!(to_hyprland("Control+Shift+t"), Some(("CTRL SHIFT".into(), "T".into())));
        assert_eq!(to_hyprland("Alt+F12"), Some(("ALT".into(), "F12".into())));
        assert_eq!(to_hyprland("Super+/"), Some(("SUPER".into(), "slash".into())));
        assert_eq!(to_hyprland("Control+Up"), Some(("CTRL".into(), "up".into())));
        assert_eq!(to_hyprland("Space"), None);
        assert_eq!(to_hyprland("Hyper+Space"), None);
        assert_eq!(to_hyprland("Alt+Nope"), None);
    }

    #[test]
    fn modmask_matches_hyprctl() {
        assert_eq!(modmask("SUPER ALT"), 72);
        assert_eq!(modmask("CTRL SHIFT"), 5);
    }

    #[test]
    fn parses_versions() {
        assert_eq!(parse_version("v0.53.1"), Some((0, 53)));
        assert_eq!(parse_version("v0.52.0-b"), Some((0, 52)));
        assert_eq!(parse_version("git"), None);
    }

    #[test]
    fn finds_source_line() {
        assert!(sources_us("source = ~/.config/hypr/bindings.conf\nsource = /home/a/.config/hypr/openthings.conf\n"));
        assert!(!sources_us("source = ~/.config/hypr/bindings.conf\n"));
        assert!(!sources_us("# openthings.conf\n"));
    }

    #[test]
    fn renders_config() {
        let on = render(Some(("SUPER ALT", "SPACE")), "/usr/bin/openthings --quick-add", true);
        assert!(on.contains("bind = SUPER ALT, SPACE, exec, /usr/bin/openthings --quick-add\n"));
        assert!(on.contains("match:title = ^(OpenThings Quick Add)$"));
        let off = render(None, "x", false);
        assert!(!off.lines().any(|l| l.starts_with("bind")));
        assert!(off.contains("windowrulev2 = pin, title:^(OpenThings Quick Add)$"));
    }

    #[test]
    fn quotes_paths() {
        assert_eq!(shell_quote(Path::new("/usr/bin/openthings")), "/usr/bin/openthings");
        assert_eq!(shell_quote(Path::new("/home/a/My Apps/OpenThings.AppImage")), "'/home/a/My Apps/OpenThings.AppImage'");
    }
}
