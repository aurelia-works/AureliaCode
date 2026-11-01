//! Built-in browser panes: each is a native child webview of the main window, positioned
//! by the frontend over the pane's DOM rect. External pages get no IPC: the capability
//! file only grants permissions to local app URLs. External browser webviews use
//! labels like `browser-<pane>`; those labels are deliberately absent from
//! capabilities/default.json, so they never receive the app IPC bridge.

use serde::Serialize;
use std::path::Path;
use tauri::webview::{PageLoadEvent, WebviewBuilder};
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Rect, WebviewUrl};

#[derive(Clone, Serialize)]
struct NavEvent {
    pane: String,
    url: String,
    loading: bool,
}

#[derive(Clone, Serialize)]
struct PickEvent {
    pane: String,
    url: String,
}

fn label(pane: &str) -> String {
    format!("browser-{pane}")
}

const MAX_SNAPS: usize = 50;

/// Pick screenshots are evidence, not history: keep the newest 50 and drop the rest.
fn prune_snaps(dir: &Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut files: Vec<(std::time::SystemTime, std::path::PathBuf)> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x == "png"))
        .filter_map(|e| {
            let path = e.path();
            let time = e.metadata().ok()?.modified().ok()?;
            Some((time, path))
        })
        .collect();
    // Keep a week of evidence: a recent chat can still reference its screenshot.
    let cutoff = std::time::SystemTime::now().checked_sub(std::time::Duration::from_secs(7 * 24 * 3600));
    files.retain(|(time, _)| cutoff.is_some_and(|c| *time < c));
    if files.len() <= MAX_SNAPS {
        return;
    }
    files.sort_by_key(|(time, _)| *time);
    for (_, path) in files.iter().take(files.len() - MAX_SNAPS) {
        let _ = std::fs::remove_file(path);
    }
}

fn parse(url: &str) -> Result<tauri::Url, String> {
    let u: tauri::Url = url.parse().map_err(|e| format!("invalid url: {e}"))?;
    match u.scheme() {
        "http" | "https" => Ok(u),
        s => Err(format!("unsupported scheme: {s}")),
    }
}

fn rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
    Rect {
        position: LogicalPosition::new(x, y).into(),
        size: LogicalSize::new(w.max(1.0), h.max(1.0)).into(),
    }
}

/// Creates the pane's webview if needed (hidden until the frontend has measured it).
#[tauri::command]
pub fn browser_open(app: AppHandle, pane: String, url: String, x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    let lbl = label(&pane);
    if app.get_webview(&lbl).is_some() {
        return Ok(());
    }
    let url = parse(&url)?;
    let window = app.get_window("main").ok_or("main window missing")?;
    let (nav_app, nav_pane) = (app.clone(), pane.clone());
    let (load_app, load_pane) = (app.clone(), pane.clone());
    let builder = WebviewBuilder::new(&lbl, WebviewUrl::External(url))
        .on_navigation(move |u| {
            // Element picker: the injected script sends one payload through a custom
            // scheme. Never navigate there; hand it to the app and stay on the page.
            if u.scheme() == "aurelia-pick" {
                let _ = nav_app.emit("browser-pick", PickEvent { pane: nav_pane.clone(), url: u.to_string() });
                return false;
            }
            let _ = nav_app.emit("browser-nav", NavEvent { pane: nav_pane.clone(), url: u.to_string(), loading: true });
            true
        })
        .on_page_load(move |wv, payload| {
            let loading = payload.event() == PageLoadEvent::Started;
            let _ = load_app.emit(
                "browser-nav",
                NavEvent { pane: load_pane.clone(), url: payload.url().to_string(), loading },
            );
            let _ = wv;
        });
    let r = rect(x, y, w, h);
    window.add_child(builder, r.position, r.size).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn browser_bounds(app: AppHandle, pane: String, x: f64, y: f64, w: f64, h: f64) {
    if let Some(wv) = app.get_webview(&label(&pane)) {
        let _ = wv.set_bounds(rect(x, y, w, h));
    }
}

#[tauri::command]
pub fn browser_visible(app: AppHandle, pane: String, visible: bool) {
    if let Some(wv) = app.get_webview(&label(&pane)) {
        let _ = if visible { wv.show() } else { wv.hide() };
    }
}

#[tauri::command]
pub fn browser_navigate(app: AppHandle, pane: String, url: String) -> Result<(), String> {
    let url = parse(&url)?;
    match app.get_webview(&label(&pane)) {
        Some(wv) => wv.navigate(url).map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// action: "back" | "forward" | "reload"
#[tauri::command]
pub fn browser_action(app: AppHandle, pane: String, action: String) {
    let Some(wv) = app.get_webview(&label(&pane)) else { return };
    let _ = match action.as_str() {
        "back" => wv.eval("history.back()"),
        "forward" => wv.eval("history.forward()"),
        "reload" => wv.reload(),
        _ => Ok(()),
    };
}

/// Runs a script in a browser pane. Only the app's own frontend calls this; external
/// pages never get IPC. Used for the element picker and page-level inspection.
#[tauri::command]
pub fn browser_eval(app: AppHandle, pane: String, script: String) -> Result<(), String> {
    let wv = app.get_webview(&label(&pane)).ok_or_else(|| format!("no browser pane {pane}"))?;
    wv.eval(&script).map_err(|e| e.to_string())
}

/// Captures the visible page area to a PNG under the app folder and returns its path.
/// `screencapture -R` uses screen points; the caller passes the webview's logical rect.
#[tauri::command]
pub fn browser_screenshot(app: AppHandle, pane: String, x: f64, y: f64, w: f64, h: f64) -> Result<String, String> {
    let wv = app.get_webview(&label(&pane)).ok_or_else(|| format!("no browser pane {pane}"))?;
    let window = app.get_window("main").ok_or("main window missing")?;
    let origin = window.inner_position().map_err(|e| e.to_string())?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    // The webview reports its own physical position relative to the window, so a stale
    // frontend rect can never offset the capture.
    let pos = wv.position().map_err(|e| e.to_string())?;
    let size = wv.size().map_err(|e| e.to_string())?;
    let gx = origin.x as f64 / scale + pos.x as f64 / scale + x;
    let gy = origin.y as f64 / scale + pos.y as f64 / scale + y;
    let width = size.width as f64 / scale;
    let height = size.height as f64 / scale;
    let _ = (w, h);
    let dir = crate::config::app_dir().join("snaps");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = dir.join(format!("browser-{stamp}.png"));
    let region = format!("{},{},{},{}", gx.round() as i64, gy.round() as i64, width.max(1.0).round() as i64, height.max(1.0).round() as i64);
    let out = std::process::Command::new("screencapture")
        .args(["-x", "-R", &region, &path.to_string_lossy()])
        .output()
        .map_err(|e| format!("screencapture: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    prune_snaps(&dir);
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    #[test]
    fn browser_webviews_are_not_in_the_capability_list() {
        let caps = include_str!("../capabilities/default.json");
        assert!(!caps.contains("browser-"), "external browser webviews must never get app IPC");
    }
}

#[tauri::command]
pub fn browser_close(app: AppHandle, pane: String) {
    if let Some(wv) = app.get_webview(&label(&pane)) {
        let _ = wv.close();
    }
}
