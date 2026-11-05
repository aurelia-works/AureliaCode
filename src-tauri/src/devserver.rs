//! Per-thread dev servers (Theo, 2026-11-04 02:00: every thread's worktree runs its own dev server). A thread starts
//! the repo's `dev` (or `start`) script on a free port, so two threads in worktrees of the same repo don't fight
//! over 5173 or 3000. One server per thread; the app stops them all when it quits.

use crate::config::expand_path;
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, VecDeque};
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};

/// Lines of output kept per server, for "it didn't start" messages.
const LOG_LINES: usize = 200;

#[derive(Debug, Clone, PartialEq)]
pub struct Plan {
    /// Package manager binary name: npm, pnpm, yarn or bun.
    pub runner: String,
    pub args: Vec<String>,
    /// What a person would type, for the UI.
    pub shown: String,
}

/// How to run `dir`'s dev script on `port`, from its package.json scripts and lockfiles. None when there is no
/// `dev` or `start` script. Vite, Next, Astro and Nuxt take a port flag; anything else gets only `PORT`.
pub fn plan_for(scripts: &Value, lockfiles: &[&str], port: u16) -> Option<Plan> {
    let name = ["dev", "start"].into_iter().find(|n| scripts.get(n).and_then(Value::as_str).is_some())?;
    let script = scripts[name].as_str().unwrap_or_default();
    let runner = if lockfiles.contains(&"pnpm-lock.yaml") {
        "pnpm"
    } else if lockfiles.contains(&"yarn.lock") {
        "yarn"
    } else if lockfiles.contains(&"bun.lockb") || lockfiles.contains(&"bun.lock") {
        "bun"
    } else {
        "npm"
    };
    let p = port.to_string();
    let flags: Vec<String> = if script.contains("vite") {
        vec!["--port".into(), p, "--strictPort".into(), "--host".into(), "127.0.0.1".into()]
    } else if script.contains("next") || script.contains("astro") || script.contains("nuxt") {
        vec!["--port".into(), p]
    } else {
        vec![]
    };
    let mut args = vec!["run".to_string(), name.to_string()];
    if !flags.is_empty() {
        // npm needs `--` before the script's own flags; pnpm, yarn and bun pass them through.
        if runner == "npm" {
            args.push("--".into());
        }
        args.extend(flags);
    }
    let shown = format!("{runner} {}", args.join(" "));
    Some(Plan { runner: runner.into(), args, shown })
}

fn free_port() -> Result<u16, String> {
    let l = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("no free port: {e}"))?;
    l.local_addr().map(|a| a.port()).map_err(|e| e.to_string())
}

struct Proc {
    child: Child,
    info: DevInfo,
    log: Arc<Mutex<VecDeque<String>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevInfo {
    pub pane: String,
    pub cwd: String,
    pub port: u16,
    pub url: String,
    pub command: String,
    pub running: bool,
}

fn procs() -> &'static Mutex<HashMap<String, Proc>> {
    static P: OnceLock<Mutex<HashMap<String, Proc>>> = OnceLock::new();
    P.get_or_init(Default::default)
}

/// Stops the whole process group: `npm run dev` forks the real server, which a plain kill would orphan.
/// A server that ignores SIGTERM for 3 s gets SIGKILL, so a stop never hangs the lock.
fn stop(p: &mut Proc) {
    if p.child.try_wait().ok().flatten().is_some() {
        return;
    }
    let group = p.child.id() as i32;
    unsafe {
        libc::killpg(group, libc::SIGTERM);
    }
    for _ in 0..30 {
        if p.child.try_wait().ok().flatten().is_some() {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    }
    unsafe {
        libc::killpg(group, libc::SIGKILL);
    }
    let _ = p.child.wait();
}

fn lockfiles(dir: &Path) -> Vec<&'static str> {
    ["pnpm-lock.yaml", "yarn.lock", "bun.lockb", "bun.lock"].into_iter().filter(|f| dir.join(f).exists()).collect()
}

pub fn start(pane: &str, cwd: &str) -> Result<DevInfo, String> {
    let dir = PathBuf::from(expand_path(cwd));
    let pkg: Value = std::fs::read_to_string(dir.join("package.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .ok_or("No package.json in this thread's folder")?;
    let port = free_port()?;
    let plan = plan_for(&pkg["scripts"], &lockfiles(&dir), port).ok_or("package.json has no dev or start script")?;
    let bin = crate::which::locate(&plan.runner).ok_or(format!("{} isn't installed", plan.runner))?;
    // GUI apps get a minimal PATH; the runner's own folder holds node too.
    let mut path = bin.parent().map(|p| p.as_os_str().to_owned()).unwrap_or_default();
    if let Some(old) = std::env::var_os("PATH") {
        path.push(":");
        path.push(old);
    }
    let mut map = procs().lock().unwrap();
    if let Some(mut old) = map.remove(pane) {
        stop(&mut old);
    }
    let mut child = Command::new(&bin)
        .args(&plan.args)
        .current_dir(&dir)
        .env("PATH", path)
        .env("PORT", port.to_string())
        .env("BROWSER", "none")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0)
        .spawn()
        .map_err(|e| format!("{}: {e}", plan.shown))?;
    let log = Arc::new(Mutex::new(VecDeque::new()));
    for out in [child.stdout.take().map(|o| Box::new(o) as Box<dyn std::io::Read + Send>), child.stderr.take().map(|e| Box::new(e) as Box<dyn std::io::Read + Send>)].into_iter().flatten() {
        let log = log.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                let mut l = log.lock().unwrap();
                if l.len() == LOG_LINES {
                    l.pop_front();
                }
                l.push_back(line);
            }
        });
    }
    let info = DevInfo { pane: pane.into(), cwd: cwd.into(), port, url: format!("http://127.0.0.1:{port}"), command: plan.shown, running: true };
    map.insert(pane.into(), Proc { child, info: info.clone(), log });
    Ok(info)
}

pub fn list() -> Vec<DevInfo> {
    let mut map = procs().lock().unwrap();
    map.values_mut()
        .map(|p| DevInfo { running: p.child.try_wait().ok().flatten().is_none(), ..p.info.clone() })
        .collect()
}

pub fn kill_all() {
    for (_, mut p) in procs().lock().unwrap().drain() {
        stop(&mut p);
    }
}

#[tauri::command]
pub async fn dev_server_start(pane: String, cwd: String) -> Result<DevInfo, String> {
    tauri::async_runtime::spawn_blocking(move || start(&pane, &cwd)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn dev_server_stop(pane: String) {
    if let Some(mut p) = procs().lock().unwrap().remove(&pane) {
        stop(&mut p);
    }
}

#[tauri::command]
pub fn dev_server_list() -> Vec<DevInfo> {
    list()
}

/// The server's last lines of output.
#[tauri::command]
pub fn dev_server_log(pane: String) -> Vec<String> {
    procs().lock().unwrap().get(&pane).map(|p| p.log.lock().unwrap().iter().cloned().collect()).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn vite_gets_its_port_after_npms_double_dash() {
        let p = plan_for(&json!({ "dev": "vite", "build": "vite build" }), &["package-lock.json"], 5199).unwrap();
        assert_eq!(p.runner, "npm");
        assert_eq!(p.args, ["run", "dev", "--", "--port", "5199", "--strictPort", "--host", "127.0.0.1"]);
    }

    #[test]
    fn lockfile_picks_the_runner_and_others_pass_flags_through() {
        let p = plan_for(&json!({ "dev": "next dev" }), &["pnpm-lock.yaml"], 4000).unwrap();
        assert_eq!(p.shown, "pnpm run dev --port 4000");
        assert_eq!(plan_for(&json!({ "dev": "next dev" }), &["yarn.lock"], 1).unwrap().runner, "yarn");
    }

    #[test]
    fn unknown_servers_get_only_port_and_start_is_the_fallback() {
        let p = plan_for(&json!({ "start": "node server.js" }), &[], 3001).unwrap();
        assert_eq!(p.args, ["run", "start"]);
        assert!(plan_for(&json!({ "build": "tsc" }), &[], 1).is_none());
        assert!(plan_for(&Value::Null, &[], 1).is_none());
    }

    /// This repo's own `npm run dev` (Vite) comes up on the port it was given and serves the app.
    /// Run with `cargo test devserver -- --ignored`.
    #[test]
    #[ignore]
    fn this_repos_vite_runs_on_its_own_port() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().to_str().unwrap().to_string();
        let info = start("live-pane", &repo).unwrap();
        assert!(info.command.starts_with("npm run dev -- --port"), "{}", info.command);
        let up = (0..300).any(|_| {
            std::thread::sleep(std::time::Duration::from_millis(100));
            std::net::TcpStream::connect(("127.0.0.1", info.port)).is_ok()
        });
        let log = dev_server_log("live-pane".into());
        dev_server_stop("live-pane".into());
        assert!(up, "vite never listened on {}: {log:?}", info.port);
        assert!(log.iter().any(|l| l.contains(&info.port.to_string())), "vite's own output should name port {}: {log:?}", info.port);
    }

    /// Starts a real server on a free port through npm and stops its whole process group. The script forks the server
    /// under a shell (like `concurrently` does), so killing only npm and its direct child would leave it running.
    #[test]
    fn starts_on_its_own_port_and_stop_kills_the_group() {
        if crate::which::locate("npm").is_none() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("aurelia-dev-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("package.json"), r#"{"scripts":{"dev":"sh -c 'node server.js & wait'"}}"#).unwrap();
        std::fs::write(dir.join("server.js"), "require('http').createServer((q,s)=>s.end('ok')).listen(+process.env.PORT,'127.0.0.1')").unwrap();
        let info = start("test-pane", dir.to_str().unwrap()).unwrap();
        let up = (0..100).any(|_| {
            std::thread::sleep(std::time::Duration::from_millis(100));
            std::net::TcpStream::connect(("127.0.0.1", info.port)).is_ok()
        });
        assert!(up, "server never listened on {}: {:?}", info.port, dev_server_log("test-pane".into()));
        dev_server_stop("test-pane".into());
        let down = (0..50).any(|_| {
            std::thread::sleep(std::time::Duration::from_millis(100));
            std::net::TcpStream::connect(("127.0.0.1", info.port)).is_err()
        });
        let _ = std::fs::remove_dir_all(&dir);
        assert!(down, "the node child kept port {} after stop", info.port);
    }
}
