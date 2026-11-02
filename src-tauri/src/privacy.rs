//! macOS privacy grants. A terminal runs arbitrary commands that touch Downloads,
//! Documents, other apps' data and so on; each of those is a separate prompt (and the
//! "data from other apps" one never sticks). Full Disk Access covers them all.

use std::process::Command;

/// The system TCC folder is readable only by processes with Full Disk Access, and the attempt
/// never prompts. Only "not permitted" counts as missing: macOS 27 dropped the per-user TCC.db,
/// so a missing file says nothing about the grant.
#[tauri::command]
pub fn has_full_disk_access() -> bool {
    match std::fs::read_dir("/Library/Application Support/com.apple.TCC") {
        Err(e) => e.kind() != std::io::ErrorKind::PermissionDenied,
        Ok(_) => true,
    }
}

#[tauri::command]
pub fn open_full_disk_access_settings() -> Result<(), String> {
    Command::new("open")
        .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles")
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

/// The running `.app` bundle, for dragging the app into a System Settings privacy list.
/// None when not running from a bundle (`tauri dev`).
#[tauri::command]
pub fn app_bundle_path() -> Option<String> {
    let exe = std::env::current_exe().ok()?;
    bundle_of(&exe).map(|p| p.to_string_lossy().into_owned())
}

fn bundle_of(exe: &std::path::Path) -> Option<std::path::PathBuf> {
    exe.ancestors().find(|p| p.extension().is_some_and(|e| e == "app")).map(|p| p.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn finds_the_bundle_around_the_binary() {
        assert_eq!(bundle_of(Path::new("/Applications/AureliaCode.app/Contents/MacOS/aurelia-space")).unwrap(), Path::new("/Applications/AureliaCode.app"));
        assert_eq!(bundle_of(Path::new("/x/target/debug/aurelia-space")), None);
    }
}
