//! Writes every panic to ~/Library/Logs/Aurelia/panic.log before the default hook runs.
//! A panic on the main thread inside an AppKit callback aborts the app (Rust can't unwind
//! through tao's `sendEvent:`), and a Finder-launched app's stderr goes nowhere, so this
//! file is the only place the message and backtrace survive.

use std::any::Any;
use std::backtrace::Backtrace;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

fn log_path() -> Option<PathBuf> {
    let home = std::env::var_os("HOME")?;
    Some(PathBuf::from(home).join("Library/Logs/Aurelia/panic.log"))
}

fn message(payload: &(dyn Any + Send)) -> &str {
    if let Some(s) = payload.downcast_ref::<&str>() {
        s
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s
    } else {
        "<non-string panic payload>"
    }
}

fn entry(unix_secs: u64, mode: &str, thread: &str, msg: &str, location: &str, backtrace: &str) -> String {
    format!(
        "=== panic at unix {unix_secs} (mode {mode}, pid {pid}, v{ver})\nthread '{thread}' panicked at {location}:\n{msg}\n{backtrace}\n\n",
        pid = std::process::id(),
        ver = env!("CARGO_PKG_VERSION"),
    )
}

/// `mode` is "app", "mcp" or "pty-host", so entries from the helper processes can be told apart.
pub fn install(mode: &'static str) {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let location = info.location().map(|l| l.to_string()).unwrap_or_else(|| "<unknown>".into());
        let thread = std::thread::current();
        let text = entry(
            now,
            mode,
            thread.name().unwrap_or("<unnamed>"),
            message(info.payload()),
            &location,
            &Backtrace::force_capture().to_string(),
        );
        if let Some(path) = log_path() {
            if let Some(dir) = path.parent() {
                let _ = fs::create_dir_all(dir);
            }
            if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(&path) {
                let _ = f.write_all(text.as_bytes());
            }
        }
        previous(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_has_everything_needed_to_find_the_panic() {
        let e = entry(1_761_930_046, "app", "main", "already borrowed", "src/hud.rs:12:5", "0: frame");
        assert!(e.contains("unix 1761930046"));
        assert!(e.contains("mode app"));
        assert!(e.contains("thread 'main' panicked at src/hud.rs:12:5"));
        assert!(e.contains("already borrowed"));
        assert!(e.contains("0: frame"));
    }

    #[test]
    fn message_reads_str_and_string_payloads() {
        let a: Box<dyn Any + Send> = Box::new("static msg");
        let b: Box<dyn Any + Send> = Box::new(String::from("owned msg"));
        let c: Box<dyn Any + Send> = Box::new(42u32);
        assert_eq!(message(a.as_ref()), "static msg");
        assert_eq!(message(b.as_ref()), "owned msg");
        assert_eq!(message(c.as_ref()), "<non-string panic payload>");
    }
}
