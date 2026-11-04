//! Runs a thread goal's check (src/lib/goalLoop.ts): a shell command in the thread's folder,
//! its exit code and the end of its output. Bounded in time, and the whole process group is
//! killed on timeout so a hung test runner can't hold the loop.

use crate::config::expand_path;
use serde::Serialize;
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// The loop only sends the agent the last few KB; this keeps a chatty suite from filling memory.
const KEEP_BYTES: usize = 64 * 1024;

/// The process group of the check running for each thread, so Stop can kill it and a new goal's
/// check doesn't run beside the old one.
static RUNNING: LazyLock<Mutex<HashMap<String, i32>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// Kills the thread's running check, if any; its run then returns what it printed so far.
fn stop(key: &str) {
    if let Some(pid) = RUNNING.lock().unwrap().remove(key) {
        unsafe { libc::killpg(pid, libc::SIGKILL) };
    }
}

/// `run`, registered under `key` for `stop`; a check already running for the key is stopped first.
fn run_keyed(key: &str, cwd: &str, command: &str, timeout: Duration) -> Result<CheckRun, String> {
    stop(key);
    let mine = std::cell::Cell::new(None);
    let r = run_with(cwd, command, timeout, |pid| {
        mine.set(Some(pid));
        RUNNING.lock().unwrap().insert(key.to_string(), pid);
    });
    let mut running = RUNNING.lock().unwrap();
    if mine.get().is_some() && running.get(key).copied() == mine.get() {
        running.remove(key);
    }
    r
}

#[derive(Serialize, Debug)]
pub struct CheckRun {
    code: i32,
    output: String,
    #[serde(rename = "timedOut")]
    timed_out: bool,
    #[serde(rename = "durationMs")]
    duration_ms: u64,
}

fn run(cwd: &str, command: &str, timeout: Duration) -> Result<CheckRun, String> {
    run_with(cwd, command, timeout, |_| {})
}

fn run_with(cwd: &str, command: &str, timeout: Duration, started_as: impl FnOnce(i32)) -> Result<CheckRun, String> {
    let started = Instant::now();
    let mut child = Command::new("/bin/zsh")
        .args(["-lc", &format!("exec 2>&1\n{command}")])
        .current_dir(expand_path(cwd))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .process_group(0)
        .spawn()
        .map_err(|e| format!("couldn't start the check: {e}"))?;
    let pid = child.id() as i32;
    started_as(pid);
    let mut out = child.stdout.take().expect("piped");
    let reader = std::thread::spawn(move || {
        let mut kept: Vec<u8> = Vec::new();
        let mut buf = [0u8; 8192];
        while let Ok(n) = out.read(&mut buf) {
            if n == 0 {
                break;
            }
            kept.extend_from_slice(&buf[..n]);
            if kept.len() > 2 * KEEP_BYTES {
                kept.drain(..kept.len() - KEEP_BYTES);
            }
        }
        kept
    });
    let mut timed_out = false;
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) => {}
            Err(e) => {
                unsafe { libc::killpg(pid, libc::SIGKILL) };
                return Err(e.to_string());
            }
        }
        if started.elapsed() >= timeout {
            timed_out = true;
            unsafe { libc::killpg(pid, libc::SIGKILL) };
            break child.wait().ok();
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    // A background child left holding the pipe would block the read forever. While it holds the
    // pipe its group still exists, so the id can't belong to anyone else yet.
    let grace = Instant::now();
    while !timed_out && !reader.is_finished() && grace.elapsed() < Duration::from_secs(2) {
        std::thread::sleep(Duration::from_millis(20));
    }
    if !reader.is_finished() {
        unsafe { libc::killpg(pid, libc::SIGKILL) };
    }
    let mut kept = reader.join().unwrap_or_default();
    if kept.len() > KEEP_BYTES {
        kept.drain(..kept.len() - KEEP_BYTES);
    }
    let mut output = String::from_utf8_lossy(&kept).into_owned();
    if timed_out {
        output.push_str(&format!("\n[stopped after {} min without finishing]", timeout.as_secs() / 60));
    }
    Ok(CheckRun { code: status.and_then(|s| s.code()).unwrap_or(-1), output, timed_out, duration_ms: started.elapsed().as_millis() as u64 })
}

/// Runs `command` with zsh in `cwd` for thread `key` and reports how it went.
#[tauri::command]
pub async fn run_check(key: String, cwd: String, command: String) -> Result<CheckRun, String> {
    if command.trim().is_empty() {
        return Err("The goal has no check command".into());
    }
    tauri::async_runtime::spawn_blocking(move || run_keyed(&key, &cwd, &command, TIMEOUT)).await.map_err(|e| e.to_string())?
}

/// Kills thread `key`'s running check (the goal was stopped, dismissed or replaced).
#[tauri::command]
pub fn stop_check(key: String) {
    stop(&key);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_the_exit_code_and_both_streams() {
        let r = run("/tmp", "echo out; echo err >&2; exit 3", TIMEOUT).unwrap();
        assert_eq!(r.code, 3);
        assert!(r.output.contains("out") && r.output.contains("err"), "{}", r.output);
        assert!(!r.timed_out);
    }

    #[test]
    fn runs_in_the_threads_folder() {
        let dir = std::env::temp_dir().join(format!("goal-cwd-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let r = run(dir.to_str().unwrap(), "pwd -P", TIMEOUT).unwrap();
        assert_eq!(r.code, 0);
        assert!(r.output.trim().ends_with(dir.file_name().unwrap().to_str().unwrap()), "{}", r.output);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_hung_check_is_killed_with_its_children() {
        let t = Instant::now();
        let r = run("/tmp", "sleep 30 & sleep 30; echo never", Duration::from_millis(400)).unwrap();
        assert!(r.timed_out);
        assert_ne!(r.code, 0);
        assert!(!r.output.contains("never"));
        // The background sleep held the pipe too; killing the group lets the read finish.
        assert!(t.elapsed() < Duration::from_secs(5), "{:?}", t.elapsed());
    }

    #[test]
    fn long_output_keeps_its_end() {
        let r = run("/tmp", "for i in $(seq 1 30000); do echo line-$i; done", TIMEOUT).unwrap();
        assert!(r.output.len() <= KEEP_BYTES);
        assert!(r.output.trim_end().ends_with("line-30000"));
    }

    #[test]
    fn stopping_a_check_kills_it_and_its_children() {
        let key = format!("stop-{}", std::process::id());
        let k = key.clone();
        let t = Instant::now();
        let h = std::thread::spawn(move || run_keyed(&k, "/tmp", "sleep 30 & sleep 30; echo never", TIMEOUT));
        while !RUNNING.lock().unwrap().contains_key(&key) {
            std::thread::sleep(Duration::from_millis(10));
        }
        stop(&key);
        let r = h.join().unwrap().unwrap();
        assert_ne!(r.code, 0);
        assert!(!r.output.contains("never"));
        assert!(t.elapsed() < Duration::from_secs(5), "{:?}", t.elapsed());
        assert!(!RUNNING.lock().unwrap().contains_key(&key));
    }

    #[test]
    fn a_missing_folder_is_an_error_not_a_failed_check() {
        assert!(run("/nonexistent/goal-folder", "true", TIMEOUT).is_err());
    }
}
