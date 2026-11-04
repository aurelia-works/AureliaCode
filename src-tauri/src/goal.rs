//! Runs a thread goal's check (src/lib/goalLoop.ts): a shell command in the thread's folder,
//! its exit code and the end of its output. Bounded in time, and the whole process group is
//! killed on timeout so a hung test runner can't hold the loop.

use crate::config::expand_path;
use serde::Serialize;
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(15 * 60);
/// The loop only sends the agent the last few KB; this keeps a chatty suite from filling memory.
const KEEP_BYTES: usize = 64 * 1024;

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
        if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
            break Some(s);
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

/// Runs `command` with zsh in `cwd` and reports how it went.
#[tauri::command]
pub async fn run_check(cwd: String, command: String) -> Result<CheckRun, String> {
    if command.trim().is_empty() {
        return Err("The goal has no check command".into());
    }
    tauri::async_runtime::spawn_blocking(move || run(&cwd, &command, TIMEOUT)).await.map_err(|e| e.to_string())?
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
}
