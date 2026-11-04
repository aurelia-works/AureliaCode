//! Menu bar squid: a tray icon and the popover it opens (`tray.html`). The icon's look comes
//! from the main window (lib/trayIcon.ts), which knows the settings and what's running.

use crate::config;
use serde::Serialize;
use serde_json::Value;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Rect, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const ID: &str = "squid";
const WIDTH: f64 = 320.0;
const GAP: f64 = 6.0;
const MAX_H: f64 = 640.0;

/// When the popover last hid. Clicking the icon while it's open blurs it first, and that same
/// click must close it, not reopen it.
static HIDDEN_AT: Mutex<Option<Instant>> = Mutex::new(None);

fn popover(app: &AppHandle) -> Result<WebviewWindow, String> {
    if let Some(w) = app.get_webview_window("tray") {
        return Ok(w);
    }
    WebviewWindowBuilder::new(app, "tray", WebviewUrl::App("tray.html".into()))
        .title("AureliaCode")
        .inner_size(WIDTH, 300.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible_on_all_workspaces(true)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())
}

fn toggle(app: &AppHandle, rect: Rect) {
    let Ok(w) = popover(app) else { return };
    if w.is_visible().unwrap_or(false) {
        let _ = w.hide();
        return;
    }
    if HIDDEN_AT.lock().unwrap().is_some_and(|t| t.elapsed() < Duration::from_millis(250)) {
        return;
    }
    let scale = w.scale_factor().unwrap_or(1.0);
    let pos = rect.position.to_physical::<f64>(scale);
    let size = rect.size.to_physical::<f64>(scale);
    let width = WIDTH * scale;
    let mut x = pos.x + size.width / 2.0 - width / 2.0;
    if let Ok(Some(m)) = app.monitor_from_point(pos.x, pos.y) {
        let left = m.position().x as f64;
        x = x.clamp(left + GAP * scale, left + m.size().width as f64 - width - GAP * scale);
    }
    let _ = w.set_position(PhysicalPosition::new(x.round() as i32, (pos.y + size.height + GAP * scale).round() as i32));
    let _ = w.show();
    let _ = w.set_focus();
    let _ = w.emit("tray-opened", ());
}

/// The popover closes when you click anywhere else.
pub fn on_blur(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("tray") {
        let _ = w.hide();
        *HIDDEN_AT.lock().unwrap() = Some(Instant::now());
    }
}

fn open_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn setup(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "tray-open", "Open AureliaCode", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "tray-quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    TrayIconBuilder::with_id(ID)
        .icon(Image::from_bytes(include_bytes!("../icons/tray-squid.png"))?)
        .icon_as_template(true)
        .tooltip("AureliaCode")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, e| match e.id().as_ref() {
            "tray-open" => open_main(app),
            "tray-quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, e| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = e {
                toggle(tray.app_handle(), rect);
            }
        })
        .build(app)?;
    if let Some(t) = app.tray_by_id(ID) {
        let _ = t.set_visible(config::load().tray.enabled);
    }
    Ok(())
}

/// A frame from lib/trayIcon.ts. `template`: black and alpha, macOS tints it for the menu bar.
#[tauri::command]
pub fn tray_set_icon(app: AppHandle, rgba: Vec<u8>, width: u32, height: u32, template: bool) -> Result<(), String> {
    let t = app.tray_by_id(ID).ok_or("no tray icon")?;
    if rgba.len() != (width * height * 4) as usize {
        return Err("bad icon size".into());
    }
    t.set_icon_with_as_template(Some(Image::new_owned(rgba, width, height)), template).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn tray_visible(app: AppHandle, on: bool) -> Result<(), String> {
    if !on {
        on_blur(&app);
    }
    app.tray_by_id(ID).ok_or("no tray icon")?.set_visible(on).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn tray_resize(app: AppHandle, height: f64) {
    if let Some(w) = app.get_webview_window("tray") {
        let _ = w.set_size(tauri::LogicalSize::new(WIDTH, height.clamp(120.0, MAX_H)));
    }
}

#[tauri::command]
pub fn tray_open_main(app: AppHandle) {
    open_main(&app);
    on_blur(&app);
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    name: String,
    email: Option<String>,
    plan: Option<String>,
}

/// The rate-limit tier, read the way people say it.
fn plan_label(tier: &str) -> Option<String> {
    let t = tier.to_lowercase();
    if t.contains("max") {
        let n = t.rsplit('_').next().filter(|s| s.ends_with('x')).map(|s| format!(" {s}"));
        return Some(format!("Max{}", n.unwrap_or_default()));
    }
    ["team", "enterprise", "pro"].iter().find(|p| t.contains(**p)).map(|p| p[..1].to_uppercase() + &p[1..])
}

fn identity(name: &str, profile: &Value) -> Identity {
    let o = &profile["oauthAccount"];
    Identity {
        name: name.to_string(),
        email: o["emailAddress"].as_str().map(String::from),
        plan: o["organizationRateLimitTier"].as_str().and_then(plan_label),
    }
}

/// Who each account is, from the profile Claude Code keeps beside its config. No credentials.
#[tauri::command]
pub fn tray_accounts() -> Vec<Identity> {
    config::load()
        .accounts
        .iter()
        .map(|a| {
            let path = if a.is_default() { config::home_dir().join(".claude.json") } else { std::path::Path::new(&a.resolved_dir()).join(".claude.json") };
            let profile = std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or(Value::Null);
            identity(&a.name, &profile)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn plans_read_the_way_people_say_them() {
        assert_eq!(plan_label("default_claude_max_5x").as_deref(), Some("Max 5x"));
        assert_eq!(plan_label("default_claude_max_20x").as_deref(), Some("Max 20x"));
        assert_eq!(plan_label("default_claude_pro").as_deref(), Some("Pro"));
        assert_eq!(plan_label("something_else"), None);
    }

    #[test]
    fn an_account_without_a_profile_keeps_its_name() {
        assert_eq!(identity("b", &Value::Null), Identity { name: "b".into(), email: None, plan: None });
        let p = json!({ "oauthAccount": { "emailAddress": "a@b.c", "organizationRateLimitTier": "default_claude_max_5x" } });
        assert_eq!(identity("b", &p).email.as_deref(), Some("a@b.c"));
    }
}
