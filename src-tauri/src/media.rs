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
}
