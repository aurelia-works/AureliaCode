//! The agent's browser loop (`aurelia_browser`): snapshot, act, wait, inspect, resize and
//! screenshot a browser pane. Calls the pane's WKWebView directly from Rust:
//! - scripts run with `callAsyncJavaScript` in a client content world, so they await
//!   promises and return a value, while page scripts can't see or patch them
//!   (`browser_agent.js`);
//! - screenshots use `takeSnapshot`, so they show the page alone, never whatever window sits
//!   on top of it (the old `screencapture -R` path).
//!
//! The page never gets IPC: results flow WebKit → Rust → the control socket reply.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, Webview};

const SCRIPT: &str = include_str!("browser_agent.js");
/// How long to wait for a new pane's webview to appear.
const APPEAR: Duration = Duration::from_secs(5);
const MAX_WAIT_MS: u64 = 15_000;

pub const ACTIONS: [&str; 7] = ["open", "snapshot", "act", "wait", "resize", "inspect", "screenshot"];

/// Page loads in flight, per pane (set from browser.rs navigation callbacks).
static LOADING: LazyLock<Mutex<HashMap<String, bool>>> = LazyLock::new(Default::default);
/// Emulated viewport per pane (CSS px), set by `resize`.
static VIEWPORT: LazyLock<Mutex<HashMap<String, (f64, f64)>>> = LazyLock::new(Default::default);
/// The pane's real rect (logical px), as last placed by the frontend.
static PLACED: LazyLock<Mutex<HashMap<String, (f64, f64, f64, f64)>>> = LazyLock::new(Default::default);

pub fn set_loading(pane: &str, loading: bool) {
    LOADING.lock().unwrap().insert(pane.to_string(), loading);
}

fn loading(pane: &str) -> bool {
    LOADING.lock().unwrap().get(pane).copied().unwrap_or(false)
}

/// Frame size and page zoom that show a `vw`x`vh` CSS viewport inside a `pw`x`ph` pane.
/// Smaller than the pane: the frame shrinks (top-left). Larger: the page zooms out to fit.
pub fn fit(pw: f64, ph: f64, viewport: Option<(f64, f64)>) -> (f64, f64, f64) {
    let Some((vw, vh)) = viewport else { return (pw, ph, 1.0) };
    let zoom = (pw / vw).min(ph / vh).min(1.0);
    (vw * zoom, vh * zoom, zoom)
}

/// Where browser.rs places the webview: the pane rect, narrowed by any emulated viewport.
pub fn placed(pane: &str, x: f64, y: f64, w: f64, h: f64) -> (f64, f64, f64, f64, f64) {
    PLACED.lock().unwrap().insert(pane.to_string(), (x, y, w, h));
    let (fw, fh, zoom) = fit(w, h, VIEWPORT.lock().unwrap().get(pane).copied());
    (x, y, fw, fh, zoom)
}

pub fn forget(pane: &str) {
    LOADING.lock().unwrap().remove(pane);
    VIEWPORT.lock().unwrap().remove(pane);
    PLACED.lock().unwrap().remove(pane);
}

/// The JS request for one action: validated and clamped. Rust-only actions return None.
pub fn request(action: &str, args: &Value) -> Result<Option<Value>, String> {
    if !ACTIONS.contains(&action) {
        return Err(format!("unknown action {action} ({})", ACTIONS.join(", ")));
    }
    if !matches!(action, "snapshot" | "act" | "wait" | "inspect") {
        return Ok(None);
    }
    let mut req = match args {
        Value::Object(m) => Value::Object(m.clone()),
        Value::Null => json!({}),
        _ => return Err("args must be an object".into()),
    };
    if action == "act" && req.get("kind").is_none() {
        req["kind"] = json!("click");
    }
    if action == "wait" {
        let ms = req["timeoutMs"].as_u64().unwrap_or(5000).min(MAX_WAIT_MS);
        req["timeoutMs"] = json!(ms);
    }
    if action == "inspect" && req.get("ref").is_none() && req.get("selector").is_none() {
        return Err("inspect needs ref (from snapshot) or selector".into());
    }
    req["action"] = json!(action);
    Ok(Some(req))
}

/// Turns the script's JSON string (or WebKit's error) into the tool result.
pub fn reply(raw: Result<Option<String>, String>) -> Result<Value, String> {
    let text = raw?.ok_or("the page returned nothing")?;
    let v: Value = serde_json::from_str(&text).map_err(|e| format!("bad page reply: {e}"))?;
    match v.get("error").and_then(|e| e.as_str()) {
        Some(e) => Err(e.to_string()),
        None => Ok(v),
    }
}

async fn webview(app: &AppHandle, pane: &str) -> Result<Webview, String> {
    let start = Instant::now();
    loop {
        if let Some(wv) = app.get_webview(&crate::browser::label(pane)) {
            return Ok(wv);
        }
        if start.elapsed() > APPEAR {
            return Err(format!("browser pane {pane} has no page yet; open a url first"));
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Waits for a page load in flight to finish, and for the url when one is named.
async fn wait_load(wv: &Webview, pane: &str, url: Option<&str>, budget: Duration) -> Result<(), String> {
    let start = Instant::now();
    // A navigation the frontend just asked for may not have started yet: give it 3 s to.
    let want = url.map(|u| u.trim_end_matches('/').to_string());
    loop {
        let at = wv.url().map(|u| u.to_string()).unwrap_or_default();
        let on_url = want.as_ref().is_none_or(|w| at.trim_end_matches('/') == w) || start.elapsed() > Duration::from_secs(3);
        if on_url && !loading(pane) {
            return Ok(());
        }
        if start.elapsed() > budget {
            // A failed load may never report "finished": clear the flag so the next call
            // doesn't wait again, and let the script report what the page is doing.
            set_loading(pane, false);
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

/// Runs one agent browser action against a pane. Async: WebKit answers on the main thread,
/// so the command must not hold it.
#[tauri::command]
pub async fn browser_agent(app: AppHandle, pane: String, action: String, args: Option<Value>) -> Result<Value, String> {
    let args = args.unwrap_or(Value::Null);
    let req = request(&action, &args)?;
    let wv = webview(&app, &pane).await?;
    let budget = Duration::from_millis(args["timeoutMs"].as_u64().unwrap_or(10_000).min(MAX_WAIT_MS));
    // The url the pane should be on (open's target, else what the frontend last sent it to).
    let expect = args["url"].as_str().or(args["expect"].as_str()).map(str::to_string);
    let expect = expect.as_deref();
    match action.as_str() {
        "open" => {
            let idle = json!({ "action": "wait", "timeoutMs": 3000 }).to_string();
            // A new pane's first document can be replaced while the script runs on it
            // ("completion handler no longer reachable"): wait for the load again and retry.
            let mut tries = 0;
            let r = loop {
                wait_load(&wv, &pane, expect, budget).await?;
                match native::call_js(&wv, SCRIPT, &idle, Duration::from_secs(5)).await {
                    Err(e) if e.starts_with("webkit:") && tries < 3 => {
                        tries += 1;
                        tokio::time::sleep(Duration::from_millis(200)).await;
                    }
                    raw => break reply(raw)?,
                }
            };
            Ok(json!({ "pane": pane, "url": r["url"], "title": r["title"] }))
        }
        "resize" => resize(&wv, &pane, &args),
        "screenshot" => {
            wait_load(&wv, &pane, expect, budget).await?;
            let crop = if args.get("ref").is_some() || args.get("selector").is_some() {
                let mut q = args.clone();
                q["action"] = json!("rect");
                Some(reply(native::call_js(&wv, SCRIPT, &q.to_string(), Duration::from_secs(5)).await)?)
            } else {
                None
            };
            screenshot(&app, &wv, &pane, crop).await
        }
        _ => {
            let mut req = req.expect("JS action");
            if let Some(m) = req.as_object_mut() {
                m.remove("expect");
            }
            wait_load(&wv, &pane, expect, budget).await?;
            let limit = Duration::from_millis(req["timeoutMs"].as_u64().unwrap_or(5000) + 5000);
            let raw = native::call_js(&wv, SCRIPT, &req.to_string(), limit).await;
            match (action.as_str(), raw) {
                // The action itself runs before the script's first await; losing the context
                // after that means the page navigated because of it.
                ("act", Err(e)) if e.starts_with("webkit:") => Ok(json!({
                    "ok": true,
                    "note": format!("the page navigated after the action ({e}); wait, then snapshot")
                })),
                (_, raw) => reply(raw),
            }
        }
    }
}

fn resize(wv: &Webview, pane: &str, args: &Value) -> Result<Value, String> {
    let reset = args["reset"].as_bool().unwrap_or(false) || (args.get("width").is_none() && args.get("height").is_none());
    let (px, py, pw, ph) = PLACED.lock().unwrap().get(pane).copied().ok_or("the pane hasn't been placed yet")?;
    if reset {
        VIEWPORT.lock().unwrap().remove(pane);
    } else {
        let w = args["width"].as_f64().unwrap_or(pw).clamp(200.0, 4000.0);
        let h = args["height"].as_f64().unwrap_or(ph).clamp(200.0, 4000.0);
        VIEWPORT.lock().unwrap().insert(pane.to_string(), (w, h));
    }
    let (x, y, fw, fh, zoom) = placed(pane, px, py, pw, ph);
    crate::browser::place(wv, x, y, fw, fh, zoom);
    Ok(json!({
        "viewport": { "w": (fw / zoom).round(), "h": (fh / zoom).round() },
        "zoom": (zoom * 1000.0).round() / 1000.0,
        "pane": { "w": pw.round(), "h": ph.round() },
        "note": if reset { "back to the pane's own size" } else if zoom < 1.0 { "wider than the pane: the page is zoomed out to fit" } else { "smaller than the pane: the page sits top-left" }
    }))
}

async fn screenshot(app: &AppHandle, wv: &Webview, pane: &str, crop: Option<Value>) -> Result<Value, String> {
    let scale = wv.window().scale_factor().map_err(|e| e.to_string())?;
    let size = wv.size().map_err(|e| e.to_string())?;
    let zoom = PLACED.lock().unwrap().get(pane).copied().map(|(_, _, w, h)| fit(w, h, VIEWPORT.lock().unwrap().get(pane).copied()).2).unwrap_or(1.0);
    // Points inside the webview. A crop rect comes in CSS px, which page zoom scales.
    let (rect, target) = match &crop {
        Some(c) => (
            Some((c["x"].as_f64().unwrap_or(0.0) * zoom, c["y"].as_f64().unwrap_or(0.0) * zoom, c["w"].as_f64().unwrap_or(1.0).max(1.0) * zoom, c["h"].as_f64().unwrap_or(1.0).max(1.0) * zoom)),
            c["target"].clone(),
        ),
        None => (None, Value::Null),
    };
    let width_pt = rect.map(|r| r.2).unwrap_or(size.width as f64 / scale);
    // One image pixel per point: readable, and a quarter of a Retina capture's size.
    let png = native::snapshot_png(wv, rect, width_pt / scale).await?;
    let dir = crate::config::app_dir().join("snaps");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let path = dir.join(format!("agent-{stamp}.png"));
    std::fs::write(&path, &png.bytes).map_err(|e| e.to_string())?;
    crate::browser::prune_snaps(&dir);
    let _ = app;
    Ok(json!({
        "image": path.to_string_lossy(),
        "width": png.width,
        "height": png.height,
        "url": wv.url().map(|u| u.to_string()).unwrap_or_default(),
        "target": target,
    }))
}

pub struct Png {
    pub bytes: Vec<u8>,
    pub width: i64,
    pub height: i64,
}

#[cfg(target_os = "macos")]
mod native {
    use super::Png;
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_foundation::{NSDictionary, NSError, NSNumber, NSString};
    use objc2_web_kit::{WKContentWorld, WKSnapshotConfiguration, WKWebView};
    use std::sync::Mutex;
    use std::time::Duration;
    use tauri::Webview;
    use tokio::sync::oneshot;

    fn err_text(err: *mut NSError) -> String {
        // SAFETY: WebKit hands us a valid NSError or null.
        match unsafe { err.as_ref() } {
            Some(e) => {
                let info = e.userInfo();
                let msg = info
                    .objectForKey(&NSString::from_str("WKJavaScriptExceptionMessage"))
                    .and_then(|m| m.downcast::<NSString>().ok())
                    .map(|m| m.to_string());
                format!("webkit: {}", msg.unwrap_or_else(|| e.localizedDescription().to_string()))
            }
            None => "webkit: unknown error".into(),
        }
    }

    async fn finish<T>(rx: oneshot::Receiver<Result<T, String>>, limit: Duration) -> Result<T, String> {
        match tokio::time::timeout(limit, rx).await {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => Err("the browser pane closed".into()),
            Err(_) => Err(format!("the page didn't answer within {} s", limit.as_secs())),
        }
    }

    /// Runs `body` as an async function with `a` = `arg`, in WebKit's client world.
    pub async fn call_js(wv: &Webview, body: &str, arg: &str, limit: Duration) -> Result<Option<String>, String> {
        let (tx, rx) = oneshot::channel();
        let (body, arg) = (body.to_string(), arg.to_string());
        wv.with_webview(move |p| {
            let tx = Mutex::new(Some(tx));
            // SAFETY: on macOS `inner` is the pane's WKWebView, and with_webview runs on the main thread.
            unsafe {
                let view: &WKWebView = &*(p.inner() as *const WKWebView);
                let mtm = MainThreadMarker::new_unchecked();
                let key = NSString::from_str("a");
                let val = NSString::from_str(&arg);
                let args = NSDictionary::<NSString, AnyObject>::from_slices(&[&*key], &[val.as_ref()]);
                let world = WKContentWorld::defaultClientWorld(mtm);
                let done = RcBlock::new(move |res: *mut AnyObject, err: *mut NSError| {
                    let out = if !err.is_null() {
                        Err(err_text(err))
                    } else {
                        Ok(res.as_ref().and_then(|r| r.downcast_ref::<NSString>()).map(|s| s.to_string()))
                    };
                    if let Some(tx) = tx.lock().unwrap().take() {
                        let _ = tx.send(out);
                    }
                });
                view.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(&NSString::from_str(&body), Some(&args), None, &world, Some(&done));
            }
        })
        .map_err(|e| e.to_string())?;
        finish(rx, limit).await
    }

    /// The webview's own rendering as PNG. `rect` is in webview points; `width` is the
    /// image width in points (WebKit renders it at the screen's backing scale).
    pub async fn snapshot_png(wv: &Webview, rect: Option<(f64, f64, f64, f64)>, width: f64) -> Result<Png, String> {
        let (tx, rx) = oneshot::channel();
        wv.with_webview(move |p| {
            let tx = Mutex::new(Some(tx));
            // SAFETY: as in call_js.
            unsafe {
                let view: &WKWebView = &*(p.inner() as *const WKWebView);
                let mtm = MainThreadMarker::new_unchecked();
                let config = WKSnapshotConfiguration::new(mtm);
                if let Some((x, y, w, h)) = rect {
                    config.setRect(CGRect { origin: CGPoint { x, y }, size: CGSize { width: w, height: h } });
                }
                config.setSnapshotWidth(Some(&NSNumber::new_f64(width.max(1.0))));
                let done = RcBlock::new(move |img: *mut NSImage, err: *mut NSError| {
                    let out = match img.as_ref() {
                        Some(img) if err.is_null() => encode(img),
                        _ => Err(err_text(err)),
                    };
                    if let Some(tx) = tx.lock().unwrap().take() {
                        let _ = tx.send(out);
                    }
                });
                view.takeSnapshotWithConfiguration_completionHandler(Some(&config), &done);
            }
        })
        .map_err(|e| e.to_string())?;
        finish(rx, Duration::from_secs(10)).await
    }

    fn encode(img: &NSImage) -> Result<Png, String> {
        let tiff = img.TIFFRepresentation().ok_or("snapshot has no bitmap")?;
        let rep: Retained<NSBitmapImageRep> = NSBitmapImageRep::imageRepWithData(&tiff).ok_or("snapshot bitmap unreadable")?;
        // SAFETY: an empty properties dictionary is valid for PNG.
        let data = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }.ok_or("PNG encode failed")?;
        Ok(Png { bytes: data.to_vec(), width: rep.pixelsWide() as i64, height: rep.pixelsHigh() as i64 })
    }

    /// Frame zoom for an emulated viewport.
    pub fn set_zoom(wv: &Webview, zoom: f64) {
        let _ = wv.with_webview(move |p| unsafe {
            let view: &WKWebView = &*(p.inner() as *const WKWebView);
            if (view.pageZoom() - zoom).abs() > 0.0001 {
                view.setPageZoom(zoom);
            }
        });
    }
}

#[cfg(not(target_os = "macos"))]
mod native {
    use super::Png;
    use std::time::Duration;
    use tauri::Webview;
    pub async fn call_js(_: &Webview, _: &str, _: &str, _: Duration) -> Result<Option<String>, String> {
        Err("the agent browser needs macOS".into())
    }
    pub async fn snapshot_png(_: &Webview, _: Option<(f64, f64, f64, f64)>, _: f64) -> Result<Png, String> {
        Err("the agent browser needs macOS".into())
    }
    pub fn set_zoom(_: &Webview, _: f64) {}
}

pub use native::set_zoom;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requests_are_validated_and_clamped() {
        assert!(request("drive", &json!({})).unwrap_err().contains("unknown action"));
        assert_eq!(request("screenshot", &json!({})).unwrap(), None);
        assert_eq!(request("resize", &json!({ "width": 390 })).unwrap(), None);
        let act = request("act", &json!({ "ref": "e3" })).unwrap().unwrap();
        assert_eq!(act, json!({ "action": "act", "kind": "click", "ref": "e3" }));
        let wait = request("wait", &json!({ "text": "Done", "timeoutMs": 999_999 })).unwrap().unwrap();
        assert_eq!(wait["timeoutMs"], json!(15_000));
        assert!(request("inspect", &json!({})).is_err());
        assert!(request("snapshot", &json!("x")).is_err());
        assert_eq!(request("snapshot", &Value::Null).unwrap().unwrap(), json!({ "action": "snapshot" }));
    }

    #[test]
    fn page_replies_round_trip() {
        let ok = reply(Ok(Some(r#"{"ok":true,"url":"http://x/"}"#.into()))).unwrap();
        assert_eq!(ok["url"], "http://x/");
        assert_eq!(reply(Ok(Some(r#"{"error":"ref e9 is gone"}"#.into()))).unwrap_err(), "ref e9 is gone");
        assert!(reply(Ok(None)).unwrap_err().contains("nothing"));
        assert!(reply(Ok(Some("not json".into()))).unwrap_err().contains("bad page reply"));
        assert_eq!(reply(Err("webkit: boom".into())).unwrap_err(), "webkit: boom");
    }

    #[test]
    fn emulated_viewports_fit_the_pane() {
        assert_eq!(fit(800.0, 600.0, None), (800.0, 600.0, 1.0));
        // A phone inside a wide pane: smaller frame, no zoom.
        assert_eq!(fit(800.0, 900.0, Some((390.0, 844.0))), (390.0, 844.0, 1.0));
        // A desktop wider than the pane: zoomed out, CSS viewport kept.
        let (w, h, z) = fit(720.0, 900.0, Some((1440.0, 900.0)));
        assert_eq!((w, h, z), (720.0, 450.0, 0.5));
        assert_eq!((w / z, h / z), (1440.0, 900.0));
    }

    #[test]
    fn the_script_handles_every_js_action() {
        // request() forwards these four (plus the internal rect); the script must run each.
        assert!(SCRIPT.contains("const RUN = { snapshot, act, wait, inspect, rect };"));
    }
}
