//! Images for the chat composer's + menu: a macOS screenshot (crosshair) or the clipboard's image.
//! Both go through a temp PNG that is deleted after reading; nothing is kept.

use base64::Engine;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PickedImage {
    media_type: String,
    data: String,
}

fn temp_png(kind: &str) -> PathBuf {
    std::env::temp_dir().join(format!("aurelia-{kind}-{}-{}.png", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_nanos())))
}

/// Reads and deletes the PNG; None when the file is missing or empty (cancelled, no image).
fn take_png(path: &Path) -> Option<PickedImage> {
    let bytes = std::fs::read(path).ok();
    let _ = std::fs::remove_file(path);
    let bytes = bytes.filter(|b| !b.is_empty())?;
    Some(PickedImage { media_type: "image/png".into(), data: base64::engine::general_purpose::STANDARD.encode(bytes) })
}

/// macOS's own crosshair (`screencapture -i`): drag an area, Space for a window, Esc to cancel.
/// Needs Screen Recording for anything beyond the desktop; macOS asks the first time.
#[tauri::command]
pub async fn capture_screenshot() -> Result<Option<PickedImage>, String> {
    // screencapture waits for the user; keep it off the async workers.
    tauri::async_runtime::spawn_blocking(screenshot_blocking).await.map_err(|e| e.to_string())?
}

fn screenshot_blocking() -> Result<Option<PickedImage>, String> {
    let path = temp_png("shot");
    let status = Command::new("screencapture").args(["-i", "-x"]).arg(&path).status().map_err(|e| e.to_string())?;
    if !status.success() {
        let _ = std::fs::remove_file(&path);
        return Ok(None);
    }
    Ok(take_png(&path))
}

/// The clipboard's image as PNG, or None when the clipboard holds no image.
#[tauri::command]
pub async fn clipboard_image() -> Result<Option<PickedImage>, String> {
    tauri::async_runtime::spawn_blocking(clipboard_blocking).await.map_err(|e| e.to_string())?
}

/// Reads a screenshot the app itself wrote (browser or computer use) as a data URL, so a
/// thumbnail needs no asset-protocol scope. Only PNGs in the app's screenshot folders
/// (`snaps`, `computer`) or the app's own `aurelia-*` temp files are accepted, never other
/// app data such as config or tokens. Runs off the main thread: a desktop shot is megabytes.
#[tauri::command]
pub async fn read_image(path: String) -> Result<PickedImage, String> {
    tauri::async_runtime::spawn_blocking(move || read_image_blocking(&path)).await.map_err(|e| e.to_string())?
}

fn read_image_blocking(path: &str) -> Result<PickedImage, String> {
    let p = std::fs::canonicalize(path).map_err(|e| format!("{path}: {e}"))?;
    let app = std::fs::canonicalize(crate::config::app_dir()).ok();
    let temp = std::fs::canonicalize(std::env::temp_dir()).ok();
    let in_app = app.as_ref().is_some_and(|root| ["snaps", "computer"].iter().any(|d| p.parent() == Some(root.join(d).as_path())));
    let in_temp = temp.as_ref().is_some_and(|root| p.parent() == Some(root.as_path()) && p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("aurelia-")));
    if !(in_app || in_temp) {
        return Err("only screenshots written by AureliaCode can be read".into());
    }
    let bytes = std::fs::read(&p).map_err(|e| e.to_string())?;
    if bytes.is_empty() {
        return Err("the image is empty".into());
    }
    if !bytes.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Err("not a PNG".into());
    }
    Ok(PickedImage { media_type: "image/png".into(), data: base64::engine::general_purpose::STANDARD.encode(bytes) })
}

fn clipboard_blocking() -> Result<Option<PickedImage>, String> {
    let path = temp_png("clip");
    let p = path.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        "set f to open for access POSIX file \"{p}\" with write permission\n\
         try\n  write (the clipboard as «class PNGf») to f\nend try\nclose access f"
    );
    Command::new("osascript").arg("-e").arg(script).output().map_err(|e| e.to_string())?;
    Ok(take_png(&path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_then_deletes_the_png() {
        let path = temp_png("test");
        std::fs::write(&path, [137, 80, 78, 71]).unwrap();
        assert_eq!(take_png(&path), Some(PickedImage { media_type: "image/png".into(), data: "iVBORw==".into() }));
        assert!(!path.exists());
    }

    #[test]
    fn missing_or_empty_is_none() {
        let path = temp_png("none");
        assert_eq!(take_png(&path), None);
        std::fs::write(&path, []).unwrap();
        assert_eq!(take_png(&path), None);
        assert!(!path.exists());
    }

    #[test]
    fn screenshots_read_as_data_urls_but_other_files_do_not() {
        let path = temp_png("read");
        std::fs::write(&path, [137, 80, 78, 71]).unwrap();
        let img = read_image_blocking(&path.to_string_lossy()).unwrap();
        assert_eq!(img.media_type, "image/png");
        assert_eq!(img.data, "iVBORw==");
        let _ = std::fs::remove_file(&path);
        assert!(read_image_blocking("/etc/hosts").is_err());
        // An aurelia-* temp file that isn't a PNG, and any other temp file, are refused.
        let text = temp_png("notpng");
        std::fs::write(&text, b"token=abc").unwrap();
        assert!(read_image_blocking(&text.to_string_lossy()).is_err());
        let _ = std::fs::remove_file(&text);
        let other = std::env::temp_dir().join(format!("someone-else-{}.png", std::process::id()));
        std::fs::write(&other, [137, 80, 78, 71]).unwrap();
        assert!(read_image_blocking(&other.to_string_lossy()).is_err());
        let _ = std::fs::remove_file(&other);
    }
}
