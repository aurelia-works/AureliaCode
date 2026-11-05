//! What closing the main window does. Like T3 Code, closing it quits the app: nothing is
//! left running behind it. The app exits once its last window is gone, so the windows that
//! only serve the main one (the menubar popover, the HUD) close with it; a hidden one would
//! otherwise keep AureliaCode alive in the background with no window to show.

use crate::config::Config;
use tauri::{AppHandle, Manager};

/// Every window besides "main". Each one built anywhere must be listed here (a test checks).
pub const COMPANIONS: &[&str] = &["tray", "hud"];

#[derive(Debug, PartialEq)]
pub enum OnClose {
    /// Close the window; with it go the companions, and the app exits.
    Quit,
    /// Hide it and keep running: only when the phone remote is on and set to keep running.
    Hide,
}

pub fn on_close(cfg: &Config) -> OnClose {
    if cfg.remote.enabled && cfg.remote.keep_running {
        OnClose::Hide
    } else {
        OnClose::Quit
    }
}

/// The main window is gone: close the rest so the app exits.
pub fn close_companions(app: &AppHandle) {
    for label in COMPANIONS {
        if let Some(w) = app.get_webview_window(label) {
            let _ = w.destroy();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn closing_main_quits_unless_the_remote_keeps_it_running() {
        let mut cfg = Config::default();
        assert_eq!(on_close(&cfg), OnClose::Quit);
        cfg.remote.keep_running = true;
        assert_eq!(on_close(&cfg), OnClose::Quit, "keep_running alone does nothing while the remote is off");
        cfg.remote.enabled = true;
        assert_eq!(on_close(&cfg), OnClose::Hide);
    }

    /// A window not listed in COMPANIONS would stay open after main closes and keep the app running.
    #[test]
    fn every_other_window_closes_with_main() {
        fn rs_files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
            for e in std::fs::read_dir(dir).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() {
                    rs_files(&p, out);
                } else if p.extension().is_some_and(|x| x == "rs") {
                    out.push(p);
                }
            }
        }
        let mut files = Vec::new();
        rs_files(std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/src")), &mut files);
        let mut labels = Vec::new();
        for path in files {
            if path.ends_with("lifecycle.rs") {
                continue; // this test names the builder in a string
            }
            let src = std::fs::read_to_string(&path).unwrap_or_default();
            for (i, _) in src.match_indices("WebviewWindowBuilder::new(") {
                let rest = &src[i..];
                if let Some(label) = rest.split('"').nth(1) {
                    labels.push(label.to_string());
                }
            }
        }
        assert!(labels.contains(&"tray".to_string()), "scan found no windows: {labels:?}");
        for l in labels {
            assert!(COMPANIONS.contains(&l.as_str()), "window \"{l}\" isn't closed with main");
        }
    }

    #[test]
    fn terminals_end_with_the_app_by_default() {
        assert!(!Config::default().terminal.keep_alive);
    }
}
