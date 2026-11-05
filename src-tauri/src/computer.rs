//! Desktop computer use for agents: screenshots, mouse and keyboard, separate from the
//! browser pane's DOM automation (`browser_agent.rs`). Everything here is deliberately
//! opt-in and permission-gated:
//!
//! - Settings → Advanced & Labs → Computer use must be on. control.ts refuses the tool, and
//!   these commands read the saved pref themselves, so no other caller gets around it;
//! - AureliaCode's own windows are off limits: no clicks or scrolls on them and no keys while
//!   one is focused, so an agent can't approve its own requests or flip its own settings;
//! - macOS Accessibility is required for events and Screen Recording for screenshots; both
//!   are reported, never granted silently;
//! - typing is refused while secure input is active (password fields, login dialogs);
//! - quit and force-quit combinations are blocked;
//! - every action is appended to `computer-audit.jsonl` (never the typed text) with its
//!   screenshot; only the newest 100 screenshots are kept.
//!
//! The visual verification is the screenshot returned after the action, not a guess.

use serde_json::{json, Value};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_TEXT: usize = 4000;
const AUDIT_KEEP: usize = 500;
/// Screenshots show whatever was on screen: keep only the recent ones.
const SHOTS_KEEP: usize = 100;
const OFF: &str = "Computer use is off. Turn it on in Settings → Advanced & Labs → Computer use.";

/// The saved Settings switch (ui.json `prefs.computerUse`), read here so the gate isn't only in the UI.
fn enabled_in(ui: Option<&Value>) -> bool {
    ui.and_then(|v| v["prefs"]["computerUse"].as_bool()).unwrap_or(false)
}

fn enabled() -> bool {
    enabled_in(crate::config::load_state("ui".into()).ok().flatten().as_ref())
}

/// Screenshot files beyond the newest `keep`, oldest first (names carry a millisecond stamp).
fn stale_shots(mut names: Vec<String>, keep: usize) -> Vec<String> {
    let stamp = |n: &str| n.trim_start_matches("shot-").trim_end_matches(".png").parse::<u128>().unwrap_or(0);
    names.retain(|n| n.starts_with("shot-") && n.ends_with(".png"));
    names.sort_by_key(|n| stamp(n));
    let extra = names.len().saturating_sub(keep);
    names.truncate(extra);
    names
}

fn prune_shots() {
    let dir = app_path("dir");
    let Ok(entries) = std::fs::read_dir(&dir) else { return };
    let names = entries.filter_map(|e| e.ok()).filter_map(|e| e.file_name().into_string().ok()).collect();
    for name in stale_shots(names, SHOTS_KEEP) {
        let _ = std::fs::remove_file(dir.join(name));
    }
}

/// A window frame in screen points: x, y, width, height.
type Frame = (f64, f64, f64, f64);

fn inside(frames: &[Frame], x: f64, y: f64) -> bool {
    frames.iter().any(|&(fx, fy, fw, fh)| x >= fx && y >= fy && x < fx + fw && y < fy + fh)
}

/// AureliaCode's visible windows in screen points, and whether one of them has focus.
fn own_windows(app: &tauri::AppHandle) -> (Vec<Frame>, bool) {
    use tauri::Manager;
    let mut frames = Vec::new();
    let mut focused = false;
    for w in app.webview_windows().values() {
        if !w.is_visible().unwrap_or(false) || w.is_minimized().unwrap_or(false) {
            continue;
        }
        focused |= w.is_focused().unwrap_or(false);
        let scale = w.scale_factor().unwrap_or(1.0);
        if let (Ok(p), Ok(sz)) = (w.outer_position(), w.outer_size()) {
            frames.push((p.x as f64 / scale, p.y as f64 / scale, sz.width as f64 / scale, sz.height as f64 / scale));
        }
    }
    (frames, focused)
}

/// Refuses an action aimed at AureliaCode itself.
fn guard_self(action: &str, args: &Value, frames: &[Frame], focused: bool) -> Result<(), String> {
    let at = || match (args["x"].as_f64(), args["y"].as_f64()) {
        (Some(x), Some(y)) => inside(frames, x, y),
        _ => false,
    };
    match action {
        "click" | "doubleClick" | "rightClick" if at() => Err("That point is on an AureliaCode window. Computer use can't operate AureliaCode itself; use its own tools.".into()),
        "scroll" if at() => Err("That point is on an AureliaCode window. Computer use can't scroll AureliaCode itself.".into()),
        "type" | "key" if focused => Err("AureliaCode has the keyboard focus. Click the app you want to type into first.".into()),
        _ => Ok(()),
    }
}

fn app_dir() -> PathBuf {
    crate::config::app_dir()
}

fn now_ms() -> u128 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)
}

fn app_path(kind: &str) -> PathBuf {
    let dir = app_dir().join("computer");
    let _ = std::fs::create_dir_all(&dir);
    match kind {
        "shot" => dir.join(format!("shot-{}.png", now_ms())),
        _ => dir,
    }
}

fn audit(line: Value) {
    let dir = app_dir();
    let _ = std::fs::create_dir_all(&dir);
    let path = dir.join("computer-audit.jsonl");
    let _ = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut f| writeln!(f, "{}", line));
    // Keep the log bounded: the newest 500 lines are plenty for an audit trail.
    if let Ok(text) = std::fs::read_to_string(&path) {
        let lines: Vec<&str> = text.lines().collect();
        if lines.len() > AUDIT_KEEP {
            let keep = lines[lines.len() - AUDIT_KEEP..].join("\n") + "\n";
            let _ = std::fs::write(&path, keep);
        }
    }
}

#[tauri::command]
pub fn computer_status() -> Value {
    #[cfg(target_os = "macos")]
    {
        json!({
            "platform": "macos",
            "accessibility": accessibility_trusted(),
            "screenRecording": screen_recording(),
            "secureInput": secure_input(),
            "screen": screen_size(),
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        json!({ "platform": std::env::consts::OS, "accessibility": false, "screenRecording": false, "secureInput": false, "screen": null })
    }
}

/// Opens the Privacy & Security pane an agent needs. The user grants it; the app never does.
#[tauri::command]
pub fn computer_open_settings(kind: String) -> Result<(), String> {
    let pane = match kind.as_str() {
        "accessibility" => "Privacy_Accessibility",
        "screen" => "Privacy_ScreenCapture",
        _ => return Err("kind must be accessibility or screen".into()),
    };
    let url = format!("x-apple.systempreferences:com.apple.preference.security?{pane}");
    std::process::Command::new("open")
        .arg(url)
        .status()
        .map_err(|e| e.to_string())
        .and_then(|s| if s.success() { Ok(()) } else { Err("System Settings did not open".into()) })
}

/// A full-screen PNG, one pixel per screen point so its coordinates are the ones to click.
/// Runs off the main thread: screencapture takes up to a second.
#[tauri::command]
pub async fn computer_screenshot() -> Result<Value, String> {
    if !enabled() {
        return Err(OFF.into());
    }
    tauri::async_runtime::spawn_blocking(screenshot_blocking).await.map_err(|e| e.to_string())?
}

/// Refuses to hand back a blank image when Screen Recording is off.
fn screenshot_blocking() -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        if !screen_recording() {
            return Err("Screen Recording is off for AureliaCode. Turn it on in System Settings → Privacy & Security → Screen Recording, then reopen the app.".into());
        }
        let path = app_path("shot");
        let out = std::process::Command::new("screencapture")
            .args(["-x", "-D", "1", &path.to_string_lossy()])
            .output()
            .map_err(|e| format!("screencapture: {e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
        if size < 1024 {
            let _ = std::fs::remove_file(&path);
            return Err("The screenshot came back empty. Check Screen Recording permission for AureliaCode.".into());
        }
        let (w, h) = screen_size().map(|s| (s["w"].as_i64().unwrap_or(0), s["h"].as_i64().unwrap_or(0))).unwrap_or((0, 0));
        // A Retina capture is 2x the point grid: scale it to points, so a pixel in the image is
        // the point to click, and the image is a quarter of the size.
        if w > 0 {
            let p = path.to_string_lossy();
            let _ = std::process::Command::new("sips").args(["--resampleWidth", &w.to_string(), &p, "--out", &p]).output();
        }
        prune_shots();
        let result = json!({ "image": path.to_string_lossy(), "width": w, "height": h });
        audit(json!({ "at": now_ms(), "action": "screenshot", "result": result }));
        Ok(result)
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("Desktop computer use is implemented for macOS only".into())
    }
}

#[tauri::command]
pub async fn computer_action(app: tauri::AppHandle, action: String, args: Option<Value>) -> Result<Value, String> {
    if !enabled() {
        return Err(OFF.into());
    }
    tauri::async_runtime::spawn_blocking(move || action_blocking(&app, action, args)).await.map_err(|e| e.to_string())?
}

fn action_blocking(app: &tauri::AppHandle, action: String, args: Option<Value>) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    {
        let mut args = args.unwrap_or(Value::Null);
        // A scroll without a point lands under the pointer: guard that point, not none.
        if action == "scroll" && (args["x"].as_f64().is_none() || args["y"].as_f64().is_none()) {
            if let (Ok((x, y)), Some(obj)) = (current_mouse(), args.as_object_mut()) {
                obj.insert("x".into(), json!(x));
                obj.insert("y".into(), json!(y));
            } else if let Ok((x, y)) = current_mouse() {
                args = json!({ "x": x, "y": y });
            }
        }
        let (frames, focused) = own_windows(app);
        // Refused and failed attempts are logged too, never only the ones that ran.
        let result = match guard_self(&action, &args, &frames, focused).and_then(|_| perform(&action, &args)) {
            Ok(r) => r,
            Err(e) => {
                audit(json!({ "at": now_ms(), "action": action, "summary": summary(&action, &args), "refused": e }));
                return Err(e);
            }
        };
        let mut out = json!({ "ok": true, "action": action, "at": now_ms(), "result": result });
        if args["verify"].as_bool().unwrap_or(true) {
            // The screenshot is the evidence, but a failed capture must not undo an action
            // that already happened: say so in the result instead.
            match screenshot_blocking() {
                Ok(shot) => out["screen"] = shot,
                Err(e) => out["screenError"] = json!(e),
            }
        }
        audit(json!({
            "at": now_ms(),
            "action": action,
            "summary": summary(&action, &args),
            "screen": out.get("screen").cloned().unwrap_or(Value::Null),
        }));
        Ok(out)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, action, args);
        Err("Desktop computer use is implemented for macOS only".into())
    }
}

fn summary(action: &str, args: &Value) -> String {
    match action {
        "type" => {
            let text = args["text"].as_str().unwrap_or("");
            format!("type {} characters", text.chars().count())
        }
        "key" => {
            let names: Vec<&str> = args["modifiers"].as_array().map(|a| a.iter().filter_map(|v| v.as_str()).collect()).unwrap_or_default();
            let mods = names.join("+");
            let key = args["key"].as_str().unwrap_or("");
            // A plain letter or digit pressed one at a time could spell a password: log that
            // a character was pressed, not which. Shortcuts (Cmd or Ctrl) and named keys stay.
            let shortcut = names.iter().any(|m| ["meta", "command", "cmd", "control", "ctrl"].contains(&m.to_ascii_lowercase().as_str()));
            let shown = if key.chars().count() == 1 && !shortcut { "(1 character)" } else { key };
            format!("key {}{}", if mods.is_empty() { String::new() } else { format!("{mods}+") }, shown)
        }
        other => {
            let x = args["x"].as_f64();
            let y = args["y"].as_f64();
            match (x, y) {
                (Some(x), Some(y)) => format!("{other} at {x:.0},{y:.0}"),
                _ => other.to_string(),
            }
        }
    }
}

#[cfg(target_os = "macos")]
fn perform(action: &str, args: &Value) -> Result<Value, String> {
    use core_graphics::display::CGDisplay;

    if !accessibility_trusted() {
        return Err("Accessibility is off for AureliaCode. Turn it on in System Settings → Privacy & Security → Accessibility, then reopen the app.".into());
    }
    let bounds = CGDisplay::main().bounds();
    let (w, h) = (bounds.size.width, bounds.size.height);

    match action {
        "move" | "click" | "doubleClick" | "rightClick" => {
            let (x, y) = point(args, w, h)?;
            let clicks = if action == "doubleClick" { 2 } else { args["clickCount"].as_u64().unwrap_or(1).clamp(1, 3) as usize };
            match action {
                "move" => mouse_move(x, y)?,
                "rightClick" => click_at(x, y, true, 1)?,
                _ => click_at(x, y, false, clicks)?,
            }
            Ok(json!({ "x": x.round(), "y": y.round(), "clicks": clicks }))
        }
        "scroll" => {
            let (x, y) = match (args["x"].as_f64(), args["y"].as_f64()) {
                (Some(_), Some(_)) => point(args, w, h)?,
                _ => current_mouse()?,
            };
            let dy = args["dy"].as_f64().unwrap_or(0.0).clamp(-50.0, 50.0);
            let dx = args["dx"].as_f64().unwrap_or(0.0).clamp(-50.0, 50.0);
            scroll_at(x, y, dx, dy)?;
            Ok(json!({ "dx": dx, "dy": dy, "x": x.round(), "y": y.round() }))
        }
        "type" => {
            if secure_input() {
                return Err("Secure input is active (a password field or login dialog). Typing is refused.".into());
            }
            let text = args["text"].as_str().ok_or("type needs text")?;
            if text.chars().count() > MAX_TEXT {
                return Err(format!("text is limited to {MAX_TEXT} characters"));
            }
            type_text(text)?;
            Ok(json!({ "characters": text.chars().count() }))
        }
        "key" => {
            if secure_input() {
                return Err("Secure input is active (a password field or login dialog). Keys are refused.".into());
            }
            let key = args["key"].as_str().ok_or("key needs a key name")?;
            let mods: Vec<String> = args["modifiers"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default();
            if let Some(why) = blocked_key(key, &mods) {
                return Err(why.into());
            }
            press_key(key, &mods)?;
            Ok(json!({ "key": key, "modifiers": mods }))
        }
        other => Err(format!("unknown computer action {other:?} (status, screenshot, move, click, doubleClick, rightClick, type, key, scroll)")),
    }
}

#[cfg(target_os = "macos")]
fn screen_size() -> Option<Value> {
    use core_graphics::display::CGDisplay;
    let b = CGDisplay::main().bounds();
    Some(json!({ "w": b.size.width.round(), "h": b.size.height.round() }))
}

#[cfg(target_os = "macos")]
fn point(args: &Value, w: f64, h: f64) -> Result<(f64, f64), String> {
    let x = args["x"].as_f64().ok_or("x is required (screen points)")?;
    let y = args["y"].as_f64().ok_or("y is required (screen points)")?;
    if !x.is_finite() || !y.is_finite() || x < 0.0 || y < 0.0 || x >= w || y >= h {
        return Err(format!("({x}, {y}) is outside the main screen ({w}×{h} points)"));
    }
    Ok((x, y))
}

#[cfg(target_os = "macos")]
fn current_mouse() -> Result<(f64, f64), String> {
    use core_graphics::event::CGEvent;
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    let source = CGEventSource::new(CGEventSourceStateID::HIDSystemState).map_err(|_| "could not read the mouse")?;
    let event = CGEvent::new(source).map_err(|_| "could not read the mouse")?;
    let p = event.location();
    Ok((p.x, p.y))
}

#[cfg(target_os = "macos")]
fn source() -> Result<core_graphics::event_source::CGEventSource, String> {
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};
    CGEventSource::new(CGEventSourceStateID::HIDSystemState).map_err(|_| "CoreGraphics refused an event source".into())
}

#[cfg(target_os = "macos")]
fn mouse_move(x: f64, y: f64) -> Result<(), String> {
    use core_graphics::event::{CGEvent, CGEventTapLocation, CGEventType, CGMouseButton};
    use core_graphics::geometry::CGPoint;
    let e = CGEvent::new_mouse_event(source()?, CGEventType::MouseMoved, CGPoint::new(x, y), CGMouseButton::Left).map_err(|_| "could not create a mouse event")?;
    e.post(CGEventTapLocation::HID);
    Ok(())
}

#[cfg(target_os = "macos")]
fn click_at(x: f64, y: f64, right: bool, clicks: usize) -> Result<(), String> {
    use core_graphics::event::{CGEvent, CGEventTapLocation, CGEventType, CGMouseButton, EventField};
    use core_graphics::geometry::CGPoint;
    mouse_move(x, y)?;
    let (down, up, button) = if right {
        (CGEventType::RightMouseDown, CGEventType::RightMouseUp, CGMouseButton::Right)
    } else {
        (CGEventType::LeftMouseDown, CGEventType::LeftMouseUp, CGMouseButton::Left)
    };
    for n in 1..=clicks {
        for kind in [down, up] {
            let e = CGEvent::new_mouse_event(source()?, kind, CGPoint::new(x, y), button).map_err(|_| "could not create a click")?;
            e.set_integer_value_field(EventField::MOUSE_EVENT_CLICK_STATE, n as i64);
            e.post(CGEventTapLocation::HID);
        }
        if clicks > 1 {
            std::thread::sleep(std::time::Duration::from_millis(60));
        }
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn scroll_at(x: f64, y: f64, dx: f64, dy: f64) -> Result<(), String> {
    use core_graphics::event::{CGEvent, CGEventTapLocation, ScrollEventUnit};
    use core_graphics::event_source::CGEventSource;
    mouse_move(x, y)?;
    // `new_scroll_event` is behind the highsierra feature in core-graphics; wheel1 is
    // vertical, wheel2 is horizontal.
    let e = CGEvent::new_scroll_event(CGEventSource::new(core_graphics::event_source::CGEventSourceStateID::HIDSystemState).map_err(|_| "no event source")?, ScrollEventUnit::LINE, 2, dy.round() as i32, dx.round() as i32, 0)
        .map_err(|_| "could not create a scroll event")?;
    e.post(CGEventTapLocation::HID);
    Ok(())
}

#[cfg(target_os = "macos")]
fn type_text(text: &str) -> Result<(), String> {
    use core_graphics::event::{CGEvent, CGEventTapLocation, KeyCode};
    for ch in text.chars() {
        if ch == '\n' {
            press_code(KeyCode::RETURN, Default::default())?;
            continue;
        }
        if ch == '\t' {
            press_code(KeyCode::TAB, Default::default())?;
            continue;
        }
        // The string carries the character; the key code is its real key where there is one,
        // so apps that read key codes (terminals, games) don't all see the "a" key.
        let code = if ch.is_ascii_alphanumeric() { keycode(&ch.to_ascii_lowercase().to_string()).unwrap_or(0) } else { 0 };
        let down = CGEvent::new_keyboard_event(source()?, code, true).map_err(|_| "could not create a key event")?;
        down.set_string(&ch.to_string());
        down.post(CGEventTapLocation::HID);
        let up = CGEvent::new_keyboard_event(source()?, code, false).map_err(|_| "could not create a key event")?;
        up.set_string(&ch.to_string());
        up.post(CGEventTapLocation::HID);
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn press_key(key: &str, mods: &[String]) -> Result<(), String> {
    use core_graphics::event::CGEventFlags;
    let code = keycode(key).ok_or_else(|| format!("unknown key {key:?}; use a letter, digit, or Return, Tab, Escape, Delete, arrows, Home, End, PageUp, PageDown"))?;
    let mut flags = CGEventFlags::CGEventFlagNull;
    for m in mods {
        match m.to_ascii_lowercase().as_str() {
            "shift" => flags |= CGEventFlags::CGEventFlagShift,
            "control" | "ctrl" => flags |= CGEventFlags::CGEventFlagControl,
            "alt" | "option" => flags |= CGEventFlags::CGEventFlagAlternate,
            "meta" | "command" | "cmd" => flags |= CGEventFlags::CGEventFlagCommand,
            other => return Err(format!("unknown modifier {other:?} (Shift, Control, Alt, Meta)")),
        }
    }
    press_code(code, flags)
}

#[cfg(target_os = "macos")]
fn press_code(code: u16, flags: core_graphics::event::CGEventFlags) -> Result<(), String> {
    use core_graphics::event::{CGEvent, CGEventTapLocation};
    let down = CGEvent::new_keyboard_event(source()?, code, true).map_err(|_| "could not create a key event")?;
    down.set_flags(flags);
    down.post(CGEventTapLocation::HID);
    let up = CGEvent::new_keyboard_event(source()?, code, false).map_err(|_| "could not create a key event")?;
    up.set_flags(flags);
    up.post(CGEventTapLocation::HID);
    Ok(())
}

/// ANSI key codes for the keys an agent is likely to name. Layout-independent keys use
/// `KeyCode`; letters and digits use the US ANSI positions, as CoreGraphics expects.
#[cfg(target_os = "macos")]
fn keycode(key: &str) -> Option<u16> {
    use core_graphics::event::KeyCode;
    let lower = key.to_ascii_lowercase();
    let letter = match lower.as_str() {
        "a" => 0, "s" => 1, "d" => 2, "f" => 3, "h" => 4, "g" => 5, "z" => 6, "x" => 7, "c" => 8, "v" => 9,
        "b" => 11, "q" => 12, "w" => 13, "e" => 14, "r" => 15, "y" => 16, "t" => 17, "o" => 31, "u" => 32, "i" => 34,
        "p" => 35, "l" => 37, "j" => 38, "k" => 40, "n" => 45, "m" => 46,
        "0" => 29, "1" => 18, "2" => 19, "3" => 20, "4" => 21, "5" => 23, "6" => 22, "7" => 26, "8" => 28, "9" => 25,
        "return" | "enter" => KeyCode::RETURN, "tab" => KeyCode::TAB, "space" => KeyCode::SPACE,
        "delete" | "backspace" => KeyCode::DELETE, "escape" | "esc" => KeyCode::ESCAPE,
        "home" => KeyCode::HOME, "end" => KeyCode::END, "pageup" | "page_up" => KeyCode::PAGE_UP,
        "pagedown" | "page_down" => KeyCode::PAGE_DOWN, "left" => KeyCode::LEFT_ARROW, "right" => KeyCode::RIGHT_ARROW,
        "up" => KeyCode::UP_ARROW, "down" => KeyCode::DOWN_ARROW,
        "f1" => KeyCode::F1, "f2" => KeyCode::F2, "f3" => KeyCode::F3, "f4" => KeyCode::F4, "f5" => KeyCode::F5, "f6" => KeyCode::F6,
        _ => return None,
    };
    Some(letter)
}

/// Quit and force-quit combinations are never what an agent should do on its own.
fn blocked_key(key: &str, mods: &[String]) -> Option<&'static str> {
    let has = |name: &str| mods.iter().any(|m| m.eq_ignore_ascii_case(name));
    let cmd = has("meta") || has("command") || has("cmd");
    let ctrl = has("control") || has("ctrl");
    let alt = has("alt") || has("option");
    let shift = has("shift");
    // Same names keycode() accepts: "esc" is Escape too.
    let k = match key.to_ascii_lowercase().as_str() {
        "esc" => "escape".to_string(),
        other => other.to_string(),
    };
    // Most specific first: every one of these also matches plain Cmd+Q.
    if cmd && shift && k == "q" {
        return Some("Cmd+Shift+Q logs out and is blocked for computer use");
    }
    if ctrl && cmd && k == "q" {
        return Some("Ctrl+Cmd+Q locks the screen and is blocked for computer use");
    }
    if cmd && k == "q" {
        return Some("Cmd+Q quits AureliaCode and is blocked for computer use");
    }
    if cmd && alt && k == "escape" {
        return Some("Cmd+Option+Escape opens Force Quit and is blocked for computer use");
    }
    None
}

#[cfg(target_os = "macos")]
fn accessibility_trusted() -> bool {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> u8;
    }
    // SAFETY: a C boolean; no pointers cross.
    unsafe { AXIsProcessTrusted() != 0 }
}

#[cfg(target_os = "macos")]
fn screen_recording() -> bool {
    core_graphics::access::ScreenCaptureAccess.preflight()
}

#[cfg(target_os = "macos")]
fn secure_input() -> bool {
    #[link(name = "Carbon", kind = "framework")]
    extern "C" {
        fn IsSecureEventInputEnabled() -> u8;
    }
    // SAFETY: a C boolean; no pointers cross.
    unsafe { IsSecureEventInputEnabled() != 0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_names_map_to_ansi_codes() {
        #[cfg(target_os = "macos")]
        {
            assert_eq!(keycode("a"), Some(0));
            assert_eq!(keycode("["), None);
            assert_eq!(keycode("Return"), Some(0x24));
            assert_eq!(keycode("esc"), Some(0x35));
            assert_eq!(keycode("PageDown"), Some(0x79));
            assert_eq!(keycode("nope"), None);
        }
    }

    #[test]
    fn quit_combinations_are_refused() {
        assert!(blocked_key("q", &["Meta".into()]).is_some());
        assert!(blocked_key("q", &["cmd".into()]).is_some());
        assert!(blocked_key("q", &["Shift".into()]).is_none());
        assert!(blocked_key("Escape", &["Meta".into(), "Alt".into()]).is_some());
        assert!(blocked_key("esc", &["Meta".into(), "Alt".into()]).is_some(), "keycode() accepts esc too");
        assert!(blocked_key("a", &["Meta".into()]).is_none());
    }

    #[test]
    fn summaries_do_not_put_typed_text_in_the_audit_log() {
        assert_eq!(summary("type", &json!({ "text": "secret" })), "type 6 characters");
        assert_eq!(summary("key", &json!({ "key": "a", "modifiers": ["Meta", "Shift"] })), "key Meta+Shift+a");
        assert_eq!(summary("click", &json!({ "x": 10.4, "y": 20.6 })), "click at 10,21");
        // Letters pressed one by one could spell a password.
        assert_eq!(summary("key", &json!({ "key": "p" })), "key (1 character)");
        assert_eq!(summary("key", &json!({ "key": "P", "modifiers": ["Shift"] })), "key Shift+(1 character)");
        assert_eq!(summary("key", &json!({ "key": "Return" })), "key Return");
    }

    #[test]
    fn each_quit_combination_names_itself() {
        assert!(blocked_key("q", &["Meta".into(), "Shift".into()]).unwrap().contains("logs out"));
        assert!(blocked_key("q", &["Meta".into(), "Control".into()]).unwrap().contains("locks"));
        assert!(blocked_key("q", &["Meta".into()]).unwrap().contains("quits"));
    }

    #[test]
    fn the_saved_switch_gates_the_commands_not_only_the_ui() {
        assert!(!enabled_in(None));
        assert!(!enabled_in(Some(&json!({ "prefs": {} }))));
        assert!(!enabled_in(Some(&json!({ "prefs": { "computerUse": "yes" } }))));
        assert!(enabled_in(Some(&json!({ "prefs": { "computerUse": true } }))));
    }

    #[test]
    fn only_the_newest_screenshots_are_kept() {
        let names = vec!["shot-30.png".into(), "shot-100.png".into(), "shot-20.png".into(), "notes.txt".into()];
        assert_eq!(stale_shots(names, 2), vec!["shot-20.png".to_string()]);
        assert!(stale_shots(vec!["shot-1.png".into()], 2).is_empty());
    }

    #[test]
    fn aureliacode_windows_are_off_limits() {
        let frames = [(100.0, 100.0, 800.0, 600.0)];
        assert!(guard_self("click", &json!({ "x": 150, "y": 150 }), &frames, false).is_err());
        assert!(guard_self("scroll", &json!({ "x": 899, "y": 699 }), &frames, false).is_err());
        assert!(guard_self("click", &json!({ "x": 900, "y": 150 }), &frames, false).is_ok(), "just outside the window");
        assert!(guard_self("move", &json!({ "x": 150, "y": 150 }), &frames, false).is_ok());
        assert!(guard_self("type", &json!({ "text": "x" }), &frames, true).is_err());
        assert!(guard_self("key", &json!({ "key": "a" }), &frames, false).is_ok());
    }
}
