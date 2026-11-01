//! Talks to the `tailscale` CLI: what state Tailscale is in (for Settings → Remote) and
//! `tailscale serve`, which gives the phone remote an HTTPS address on the tailnet
//! (https://<mac>.<tailnet>.ts.net) with a real certificate. Every call has a timeout:
//! a stuck daemon must never hang Settings.

use serde::Serialize;
use serde_json::Value;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

const CLIS: [&str; 3] = ["/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/opt/homebrew/bin/tailscale", "/usr/local/bin/tailscale"];
const STATUS_TIMEOUT: Duration = Duration::from_millis(3500);
const SERVE_TIMEOUT: Duration = Duration::from_secs(10);
const CACHE_FOR: Duration = Duration::from_secs(10);

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum State {
    #[default]
    NotInstalled,
    NotRunning,
    LoggedOut,
    Stopped,
    Ready,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    pub state: State,
    /// This Mac's Tailscale IPv4 address.
    pub ip: Option<String>,
    /// MagicDNS name, e.g. `mac.tail1234.ts.net`.
    pub dns_name: Option<String>,
    /// The tailnet has HTTPS certificates turned on (needed for `tailscale serve --https`).
    pub https_available: bool,
    /// The CLI's own words when something is off.
    pub detail: Option<String>,
}

fn cli() -> Option<&'static str> {
    CLIS.into_iter().find(|p| std::path::Path::new(p).exists())
}

/// Runs the CLI; Ok(stdout) on success, Err(stderr + stdout) on failure or timeout.
fn run(args: &[&str], timeout: Duration) -> Result<String, String> {
    let cli = cli().ok_or("Tailscale isn't installed")?;
    let child = Command::new(cli)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let pid = child.id();
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    match rx.recv_timeout(timeout) {
        Ok(Ok(out)) => {
            let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
            if out.status.success() {
                Ok(stdout)
            } else {
                Err(format!("{}\n{}", String::from_utf8_lossy(&out.stderr).trim(), stdout.trim()).trim().to_string())
            }
        }
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => {
            // SAFETY: pid is our own child, still running (its waiter hasn't returned).
            unsafe { libc::kill(pid as i32, libc::SIGKILL) };
            Err(format!("tailscale {} timed out", args.first().unwrap_or(&"")))
        }
    }
}

pub fn parse_status(v: &Value) -> Info {
    let state = match v["BackendState"].as_str().unwrap_or("") {
        "Running" => State::Ready,
        "NeedsLogin" | "NeedsMachineAuth" | "NoState" => State::LoggedOut,
        "Stopped" => State::Stopped,
        _ => State::NotRunning,
    };
    let ip = v["Self"]["TailscaleIPs"].as_array().and_then(|ips| ips.iter().filter_map(Value::as_str).find(|s| s.contains('.')).map(String::from));
    let dns_name = v["Self"]["DNSName"].as_str().map(|n| n.trim_end_matches('.').to_string()).filter(|n| !n.is_empty());
    let https_available = v["CertDomains"].as_array().is_some_and(|d| !d.is_empty());
    Info { state, ip, dns_name, https_available, detail: None }
}

/// What a failed `tailscale status` means.
pub fn classify_error(err: &str) -> State {
    let e = err.to_lowercase();
    if e.contains("logged out") || e.contains("needslogin") || e.contains("not logged in") {
        State::LoggedOut
    } else if e.contains("isn't installed") {
        State::NotInstalled
    } else {
        State::NotRunning
    }
}

fn fetch() -> Info {
    if cli().is_none() {
        return Info::default();
    }
    match run(&["status", "--json"], STATUS_TIMEOUT) {
        Ok(out) => match serde_json::from_str::<Value>(&out) {
            Ok(v) => parse_status(&v),
            Err(e) => Info { state: State::NotRunning, detail: Some(format!("unreadable status: {e}")), ..Default::default() },
        },
        Err(e) => {
            // `status --json` exits non-zero when logged out but still prints the JSON.
            let json_start = e.find('{');
            if let Some(v) = json_start.and_then(|i| serde_json::from_str::<Value>(&e[i..]).ok()) {
                let mut info = parse_status(&v);
                if info.state == State::Ready {
                    info.state = State::NotRunning;
                }
                return info;
            }
            Info { state: classify_error(&e), detail: e.lines().next().map(String::from), ..Default::default() }
        }
    }
}

static CACHE: LazyLock<Mutex<Option<(Instant, Info)>>> = LazyLock::new(Default::default);

/// Tailscale's state, cached briefly (Settings polls every few seconds).
pub fn info() -> Info {
    if let Some((at, info)) = CACHE.lock().unwrap().as_ref() {
        if at.elapsed() < CACHE_FOR {
            return info.clone();
        }
    }
    let info = fetch();
    *CACHE.lock().unwrap() = Some((Instant::now(), info.clone()));
    info
}

pub fn invalidate() {
    *CACHE.lock().unwrap() = None;
}

/// Another Serve handler already on `https_port` that isn't `target`.
pub fn serve_conflict(v: &Value, https_port: u16, target: &str) -> Option<String> {
    let suffix = format!(":{https_port}");
    let web = v["Web"].as_object()?;
    web.iter().filter(|(host, _)| host.ends_with(&suffix)).find_map(|(_, site)| {
        site["Handlers"].as_object()?.values().find_map(|h| {
            let proxy = h["Proxy"].as_str().or(h["Path"].as_str()).or(h["Text"].as_str().map(|_| "a text page"))?;
            (proxy.trim_end_matches('/') != target).then(|| proxy.to_string())
        })
    })
}

/// Turns a failed `tailscale serve` into something a person can act on.
pub fn explain_serve_error(err: &str) -> String {
    let url = err.split_whitespace().find(|w| w.starts_with("https://login.tailscale.com"));
    let lower = err.to_lowercase();
    if lower.contains("serve") && (lower.contains("not enabled") || lower.contains("disabled")) || lower.contains("https") && lower.contains("enable") {
        return match url {
            Some(u) => format!("Serve isn't enabled on your tailnet. Turn it on here, then try again: {u}"),
            None => "HTTPS isn't enabled on your tailnet. Turn on HTTPS Certificates in the Tailscale admin console (DNS page), then try again: https://login.tailscale.com/admin/dns".into(),
        };
    }
    if lower.contains("access denied") || lower.contains("permission") {
        return "Tailscale refused: this user isn't allowed to change Serve. Run `tailscale set --operator=$USER` once in Terminal, then try again.".into();
    }
    err.lines().next().unwrap_or(err).to_string()
}

/// `tailscale serve --bg --https=<https_port> http://127.0.0.1:<local_port>`.
pub fn serve_on(https_port: u16, local_port: u16) -> Result<(), String> {
    let target = format!("http://127.0.0.1:{local_port}");
    if let Ok(out) = run(&["serve", "status", "--json"], STATUS_TIMEOUT) {
        if let Some(other) = serde_json::from_str::<Value>(&out).ok().and_then(|v| serve_conflict(&v, https_port, &target)) {
            return Err(format!("Tailscale Serve already uses HTTPS port {https_port} for {other}. Pick another HTTPS port, or remove that with `tailscale serve --https={https_port} off`."));
        }
    }
    let https = format!("--https={https_port}");
    run(&["serve", "--bg", &https, &target], SERVE_TIMEOUT).map(|_| ()).map_err(|e| explain_serve_error(&e))
}

pub fn serve_off(https_port: u16) -> Result<(), String> {
    let https = format!("--https={https_port}");
    run(&["serve", &https, "off"], SERVE_TIMEOUT).map(|_| ()).map_err(|e| explain_serve_error(&e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn running_tailnet_with_https() {
        let v = json!({
            "BackendState": "Running",
            "CertDomains": ["mac.tail1234.ts.net"],
            "Self": { "DNSName": "mac.tail1234.ts.net.", "TailscaleIPs": ["fd7a:115c:a1e0::1", "100.101.102.103"] }
        });
        let i = parse_status(&v);
        assert_eq!(i.state, State::Ready);
        assert_eq!(i.ip.as_deref(), Some("100.101.102.103"));
        assert_eq!(i.dns_name.as_deref(), Some("mac.tail1234.ts.net"));
        assert!(i.https_available);
    }

    #[test]
    fn backend_states_map_to_what_settings_shows() {
        let st = |s: &str| parse_status(&json!({ "BackendState": s })).state;
        assert_eq!(st("NeedsLogin"), State::LoggedOut);
        assert_eq!(st("Stopped"), State::Stopped);
        assert_eq!(st("Starting"), State::NotRunning);
        assert!(!parse_status(&json!({ "BackendState": "Running", "CertDomains": null })).https_available);
    }

    #[test]
    fn cli_errors_are_classified() {
        assert_eq!(classify_error("failed to connect to local tailscaled; it doesn't appear to be running"), State::NotRunning);
        assert_eq!(classify_error("Logged out."), State::LoggedOut);
    }

    #[test]
    fn serve_conflict_ignores_our_own_handler() {
        let ours = "http://127.0.0.1:4747";
        let v = json!({ "Web": { "mac.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:4747" } } } } });
        assert_eq!(serve_conflict(&v, 443, ours), None);
        let other = json!({ "Web": { "mac.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:3000" } } } } });
        assert_eq!(serve_conflict(&other, 443, ours).as_deref(), Some("http://127.0.0.1:3000"));
        assert_eq!(serve_conflict(&other, 8443, ours), None, "different port");
        assert_eq!(serve_conflict(&json!({}), 443, ours), None);
    }

    #[test]
    fn serve_errors_say_what_to_do() {
        let e = explain_serve_error("Serve is not enabled on your tailnet.\nTo enable, visit:\n\n         https://login.tailscale.com/f/serve?node=abc");
        assert!(e.contains("https://login.tailscale.com/f/serve?node=abc"), "{e}");
        assert!(explain_serve_error("Access denied: serve config denied").contains("--operator"));
    }
}
