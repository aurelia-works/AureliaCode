//! CLIProxyAPI hub (Settings → Accounts): an optional local proxy that chats reach Anthropic
//! through. Off by default. Loopback only, its web panel and usage statistics off, and its
//! Claude disguise off: what goes through it is real Claude Code.

use crate::config;
use serde::Serialize;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

const KEYCHAIN_SERVICE: &str = "AureliaCode";

static HUB: Mutex<Option<Child>> = Mutex::new(None);

fn config_path() -> PathBuf {
    config::app_dir().join("cliproxy.yaml")
}

fn binary() -> Option<PathBuf> {
    crate::which::locate("cliproxyapi")
}

fn yaml(port: u16, key: &str) -> String {
    format!(
        r#"config-version: 8
server:
  host: "127.0.0.1"
  port: {port}
  discovery:
    enabled: false
management:
  allow-remote: false
  secret-key: ""
  disable-control-panel: true
access:
  api-keys:
    - "{key}"
upstream:
  claude:
    disable-claude-cloak-mode: true
observability:
  logs:
    logging-to-file: false
    request-log: false
  usage:
    usage-statistics-enabled: false
"#
    )
}

/// The token between the app and its own hub, made once and kept in the Keychain.
fn local_key() -> Result<String, String> {
    let e = keyring::Entry::new(KEYCHAIN_SERVICE, "cliproxy-local-key").map_err(|e| e.to_string())?;
    if let Ok(k) = e.get_password() {
        return Ok(k);
    }
    let bytes: [u8; 24] = std::array::from_fn(|_| rand_byte());
    let k: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
    e.set_password(&k).map_err(|e| e.to_string())?;
    Ok(k)
}

fn rand_byte() -> u8 {
    let mut b = [0u8; 1];
    // macOS has this in libc. Other targets (the Linux test VM) read a byte from urandom.
    #[cfg(target_os = "macos")]
    unsafe { libc::arc4random_buf(b.as_mut_ptr().cast(), 1) };
    #[cfg(not(target_os = "macos"))]
    {
        use std::io::Read;
        if std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut b)).is_err() {
            b[0] = 0x5a;
        }
    }
    b[0]
}

fn write_config(port: u16) -> Result<(), String> {
    use std::os::unix::fs::OpenOptionsExt;
    use std::io::Write;
    let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(config_path()).map_err(|e| e.to_string())?;
    f.write_all(yaml(port, &local_key()?).as_bytes()).map_err(|e| e.to_string())
}

fn stop() {
    if let Some(mut c) = HUB.lock().unwrap().take() {
        let _ = c.kill();
        let _ = c.wait();
    }
}

fn start(port: u16) -> Result<(), String> {
    stop();
    let bin = binary().ok_or("cliproxyapi isn't installed (brew install cliproxyapi)")?;
    write_config(port)?;
    let child = Command::new(bin)
        .arg("-config")
        .arg(config_path())
        // Its built-in model list, not the catalog it would otherwise fetch every 3 hours.
        .arg("-local-model")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    *HUB.lock().unwrap() = Some(child);
    Ok(())
}

/// Starts the hub at launch when the switch is on.
pub fn setup() {
    let p = config::load().proxy;
    if p.enabled {
        if let Err(e) = start(p.port) {
            eprintln!("[aurelia] CLIProxyAPI: {e}");
        }
    }
}

pub fn shutdown() {
    stop();
}

/// What a chat adds to its environment while the switch is on.
pub fn chat_env(cfg: &config::Config) -> Vec<(String, String)> {
    if !cfg.proxy.enabled {
        return vec![];
    }
    let Ok(key) = local_key() else { return vec![] };
    env_for(cfg.proxy.port, &key)
}

fn env_for(port: u16, key: &str) -> Vec<(String, String)> {
    vec![("ANTHROPIC_BASE_URL".into(), format!("http://127.0.0.1:{port}")), ("ANTHROPIC_AUTH_TOKEN".into(), key.into())]
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyStatus {
    installed: bool,
    running: bool,
    signed_in: bool,
}

#[tauri::command]
pub fn proxy_status() -> ProxyStatus {
    let running = HUB.lock().unwrap().as_mut().is_some_and(|c| matches!(c.try_wait(), Ok(None)));
    let auth = config::home_dir().join(".cli-proxy-api");
    let signed_in = std::fs::read_dir(auth).is_ok_and(|d| d.flatten().any(|e| e.file_name().to_string_lossy().contains("claude")));
    ProxyStatus { installed: binary().is_some(), running, signed_in }
}

/// Applies the switch now. Chats already open keep their route until they restart.
#[tauri::command]
pub fn proxy_apply() -> Result<(), String> {
    let p = config::load().proxy;
    if p.enabled {
        start(p.port)
    } else {
        stop();
        Ok(())
    }
}

/// The browser sign-in, for the one account the hub uses.
#[tauri::command]
pub fn proxy_login() -> Result<(), String> {
    let bin = binary().ok_or("cliproxyapi isn't installed (brew install cliproxyapi)")?;
    write_config(config::load().proxy.port)?;
    Command::new(bin).arg("-config").arg(config_path()).arg("-claude-login").stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_hub_stays_on_loopback_with_panel_statistics_and_disguise_off() {
        let y = yaml(8317, "k");
        for line in ["host: \"127.0.0.1\"", "allow-remote: false", "disable-control-panel: true", "usage-statistics-enabled: false", "disable-claude-cloak-mode: true", "- \"k\""] {
            assert!(y.contains(line), "{line}");
        }
    }

    #[test]
    fn a_chat_points_at_the_hub() {
        assert_eq!(env_for(8317, "k")[0].1, "http://127.0.0.1:8317");
        assert_eq!(env_for(8317, "k")[1], ("ANTHROPIC_AUTH_TOKEN".to_string(), "k".to_string()));
    }

    #[test]
    fn the_switch_is_off_until_turned_on() {
        assert!(chat_env(&config::Config::default()).is_empty());
    }
}
