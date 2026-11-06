//! Opt-in long-session compression for new Claude Code threads, via billion-context's
//! file-free launcher (`bili claude --bin`). Off until an account is enabled and a new
//! thread is stamped. Each stamped thread gets its own loopback proxy, which the launcher
//! stops when Claude exits. This module never installs the native Claude plugin (that
//! writes shared Claude settings) and never turns on certificate MITM.
//!
//! Session separation was checked in billion-context 0.1.212 `dist/index.js`: the store
//! key is the verbatim `x-claude-code-session-id`, with `|sub:<agent>` only when
//! `x-claude-code-agent-id` or `x-claude-code-parent-agent-id` is present. The native
//! subagent lane-token hook is a different install, which we do not use. Header-less
//! subagents are therefore not treated as isolated, so proxies are not shared across
//! threads or accounts. Summaries for one account live in that account's sessions dir.

use crate::config::{self, Config};
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const HOST: &str = "127.0.0.1";
const PNPM: &str = "11.21.0";
pub const BLOCK_KEY: &str = "AURELIA_COMPRESSION_BLOCK";

#[derive(Clone)]
pub struct Home {
    pub root: PathBuf,
}

impl Home {
    pub fn production() -> Self {
        Self { root: config::app_dir() }
    }

    fn pkg(&self) -> PathBuf {
        self.root.join("billion-context/pkg")
    }

    pub fn bili(&self) -> PathBuf {
        self.pkg().join("node_modules/.bin/bili")
    }

    pub fn wrapper(&self) -> PathBuf {
        self.root.join("shell/aurelia-bili-wrap.sh")
    }

    fn bili_config(&self) -> PathBuf {
        self.root.join("billion-context/billion-context.json")
    }

    fn sessions(&self, account: &str) -> PathBuf {
        self.root.join("billion-context/sessions").join(account_dir_name(account))
    }

    fn record_dir(&self) -> PathBuf {
        self.root.join("run/compression")
    }

    fn meta(&self) -> PathBuf {
        self.root.join("billion-context/installed.json")
    }
}

fn account_dir_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if s.is_empty() || s == "." || s == ".." { "_".into() } else { s }
}

fn executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.metadata().is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
}

#[derive(Debug, PartialEq)]
pub enum InstallState {
    Absent,
    Unavailable { version: Option<String>, reason: String },
    Ready { version: String },
}

pub struct Files {
    pub bili_executable: bool,
    pub wrapper_executable: bool,
    pub claude_executable: bool,
    pub version: Option<String>,
}

pub fn classify(files: &Files) -> InstallState {
    let any = files.bili_executable || files.version.is_some();
    if !any && !files.wrapper_executable {
        return InstallState::Absent;
    }
    if !any {
        return InstallState::Unavailable { version: None, reason: "The compression wrapper is present, but billion-context is not installed.".into() };
    }
    let Some(version) = files.version.clone() else {
        return InstallState::Unavailable { version: None, reason: "The install has no pinned version.".into() };
    };
    if !files.bili_executable {
        return InstallState::Unavailable { version: Some(version), reason: "The billion-context command isn't executable.".into() };
    }
    if !files.wrapper_executable {
        return InstallState::Unavailable { version: Some(version), reason: "The launch wrapper isn't installed. Restart AureliaCode.".into() };
    }
    if !files.claude_executable {
        return InstallState::Unavailable { version: Some(version), reason: "Claude Code isn't on PATH.".into() };
    }
    InstallState::Ready { version }
}

fn read_version(path: &Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;
    let version = v.get("version")?.as_str()?.trim().to_string();
    parse_version(&version).ok()
}

fn files_of(home: &Home, claude: bool) -> Files {
    Files {
        bili_executable: executable(&home.bili()),
        wrapper_executable: executable(&home.wrapper()),
        claude_executable: claude,
        version: read_version(&home.meta()),
    }
}

/// Managed proxy config. No listen address: the launch flag pins loopback, and this file
/// only turns off the updater and the advisory force-install.
pub fn managed_config_json() -> &'static str {
    "{\n  \"autoUpdate\": false,\n  \"advisoryCheck\": false\n}\n"
}

fn write_managed_config(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let body = managed_config_json();
    if body.contains("0.0.0.0") {
        return Err("refusing to write a public bind into the compression config".into());
    }
    fs::write(path, body).map_err(|e| e.to_string())
}

fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

pub fn parse_version(text: &str) -> Result<String, String> {
    let line = text.lines().map(str::trim).filter(|l| !l.is_empty()).next_back().unwrap_or("");
    let ok = !line.is_empty()
        && line.len() < 40
        && line.split('.').count() == 3
        && line.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '+');
    let mut parts = line.split('.');
    let numeric = parts.by_ref().take(3).all(|p| p.chars().next().is_some_and(|c| c.is_ascii_digit()));
    if ok && numeric && !line.starts_with('.') && !line.contains("..") {
        Ok(line.to_string())
    } else {
        Err("Couldn't read a billion-context version from the registry.".into())
    }
}

fn package_json(version: &str) -> String {
    format!(
        "{{\n  \"private\": true,\n  \"packageManager\": \"pnpm@{PNPM}\",\n  \"dependencies\": {{\n    \"billion-context\": \"{version}\"\n  }}\n}}\n"
    )
}

/// What `install` runs. The version is whatever the registry returned at that moment.
pub fn install_script(pkg: &Path, version: &str) -> String {
    format!(
        "# billion-context@{version}\nset -eu\ncd {}\nexport COREPACK_ENABLE_DOWNLOAD_PROMPT=0\ncorepack pnpm@{PNPM} install --ignore-scripts\n",
        shell_quote(&pkg.to_string_lossy())
    )
}

pub fn version_script() -> String {
    format!("export COREPACK_ENABLE_DOWNLOAD_PROMPT=0\ncorepack pnpm@{PNPM} view billion-context version\n")
}

fn looks_secret(line: &str) -> bool {
    let l = line.to_ascii_lowercase();
    l.contains("api_key") || l.contains("authorization") || l.contains("bearer ") || l.contains("sk-") || l.contains("token=")
}

fn public_tail(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let kept: Vec<&str> = text.lines().filter(|l| !looks_secret(l)).collect();
    let joined = kept.join("\n");
    let trimmed = joined.trim();
    let count = trimmed.chars().count();
    if count > 400 { trimmed.chars().skip(count - 400).collect() } else { trimmed.to_string() }
}

fn login_output(script: &str) -> Result<std::process::Output, String> {
    let shell = crate::pty::default_shell(&config::load());
    Command::new(shell)
        .args(["-lc", script])
        .env("COREPACK_ENABLE_DOWNLOAD_PROMPT", "0")
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("couldn't run the install shell: {e}"))
}

fn install_at(home: &Home) -> Result<String, String> {
    let out = login_output(&version_script())?;
    if !out.status.success() {
        return Err(format!("Couldn't resolve billion-context. {}", public_tail(&out.stderr)));
    }
    let version = parse_version(&String::from_utf8_lossy(&out.stdout))?;
    let pkg = home.pkg();
    fs::create_dir_all(&pkg).map_err(|e| e.to_string())?;
    fs::write(pkg.join("package.json"), package_json(&version)).map_err(|e| e.to_string())?;
    fs::write(pkg.join(".npmrc"), "ignore-scripts=true\n").map_err(|e| e.to_string())?;
    let out = login_output(&install_script(&pkg, &version))?;
    if !out.status.success() {
        return Err(format!("billion-context didn't install. {}", public_tail(&out.stderr)));
    }
    if !executable(&home.bili()) {
        return Err("The install finished, but the bili command isn't executable.".into());
    }
    fs::write(home.meta(), format!("{{\n  \"version\": \"{version}\"\n}}\n")).map_err(|e| e.to_string())?;
    write_managed_config(&home.bili_config())?;
    Ok(version)
}

#[tauri::command]
pub fn context_compression_install() -> Result<String, String> {
    install_at(&Home::production())
}

/// Why this launch cannot be compressed. Checked after the install is ready, so a missing
/// install is reported first.
pub fn launch_block(proxy_enabled: bool, foreign_base: bool) -> Option<&'static str> {
    if proxy_enabled {
        return Some("Long-session compression and CLIProxyAPI both replace Claude's API address. Turn one off. Claude was not started.");
    }
    if foreign_base {
        return Some("This launch already sets an Anthropic base URL, which compression would replace. Turn compression off for a new thread. Claude was not started.");
    }
    None
}

/// Env added for one thread. `requested` is the stamp stored on that thread, not the
/// account switch by itself: a thread opened before the switch stays uncompressed.
pub fn apply(home: &Home, cfg: &Config, pane_id: &str, account: Option<&str>, requested: bool, vars: &mut BTreeMap<String, String>) -> Result<(), String> {
    apply_with(home, cfg, pane_id, account, requested, vars, crate::which::locate("claude").as_deref())
}

fn apply_with(home: &Home, cfg: &Config, pane_id: &str, account: Option<&str>, requested: bool, vars: &mut BTreeMap<String, String>, claude: Option<&Path>) -> Result<(), String> {
    if !requested {
        return Ok(());
    }
    let Some(account) = account else {
        return blocked(vars, "Long-session compression was requested without a Claude account. Claude was not started.");
    };
    if !safe_pane(pane_id) {
        return Err("bad pane id".into());
    }
    match classify(&files_of(home, claude.is_some())) {
        InstallState::Absent => blocked(vars, "Long-session compression is on, but billion-context isn't installed. Install it in Settings → Accounts. Claude was not started."),
        InstallState::Unavailable { reason, .. } => blocked(vars, &format!("Long-session compression is on, but it isn't available. {reason} Claude was not started.")),
        InstallState::Ready { .. } => {
            if let Some(reason) = launch_block(cfg.proxy.enabled, vars.contains_key("ANTHROPIC_BASE_URL") || vars.contains_key("ANTHROPIC_VERTEX_BASE_URL")) {
                return blocked(vars, reason);
            }
            let claude = claude.ok_or("Claude Code isn't on PATH.")?;
            write_managed_config(&home.bili_config())?;
            let sessions = home.sessions(account);
            fs::create_dir_all(&sessions).map_err(|e| e.to_string())?;
            let record = home.record_dir().join(pane_id);
            if let Some(parent) = record.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let set = |vars: &mut BTreeMap<String, String>, k: &str, v: &str| {
                vars.insert(k.to_string(), v.to_string());
            };
            set(vars, "AURELIA_CONTEXT_COMPRESSION", "1");
            set(vars, "AURELIA_BILI", &home.bili().to_string_lossy());
            set(vars, "AURELIA_CLAUDE_BIN", &claude.to_string_lossy());
            set(vars, "AURELIA_BILI_WRAP", &home.wrapper().to_string_lossy());
            set(vars, "AURELIA_COMPRESSION_RECORD", &record.to_string_lossy());
            set(vars, "ACP_AUTO_UPDATE", "0");
            set(vars, "BILI_ADVISORY_CHECK", "0");
            set(vars, "BILI_LAUNCHER_PLUGIN", "0");
            set(vars, "BILI_CONFIG_FILE", &home.bili_config().to_string_lossy());
            set(vars, "BILI_SESSIONS_DIR", &sessions.to_string_lossy());
            Ok(())
        }
    }
}

fn blocked(vars: &mut BTreeMap<String, String>, reason: &str) -> Result<(), String> {
    vars.insert("AURELIA_CONTEXT_COMPRESSION".into(), "1".into());
    vars.insert(BLOCK_KEY.into(), reason.into());
    Ok(())
}

fn safe_pane(id: &str) -> bool {
    !id.is_empty() && id.len() < 80 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

/// Replaces the Claude executable in the chat command with the wrapper and `bili claude --bin`.
/// Flags before `claude` belong to bili. Flags after `--` belong to Claude.
pub fn wrap_chat_argv(argv: &[String], wrapper: &Path, bili: &Path, claude_bin: &Path) -> Result<Vec<String>, String> {
    if argv.len() < 5 || argv.get(3).map(String::as_str) != Some("exec \"$0\" \"$@\"") {
        return Err("Claude's launch command changed shape, so compression refused to start it.".into());
    }
    if wrapper.as_os_str().is_empty() || bili.as_os_str().is_empty() || claude_bin.as_os_str().is_empty() {
        return Err("compression refused to start Claude without its launcher paths".into());
    }
    let mut out = argv[..4].to_vec();
    out.push(wrapper.to_string_lossy().into_owned());
    out.push(bili.to_string_lossy().into_owned());
    out.extend(["--host".into(), HOST.into(), "--no-auto-update".into(), "--bin".into(), claude_bin.to_string_lossy().into_owned(), "claude".into(), "--".into()]);
    out.extend_from_slice(&argv[5..]);
    if out.iter().any(|a| a == "0.0.0.0" || a == "--mitm-domain") {
        return Err("compression refused a public or certificate-intercepting launch".into());
    }
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LiveSession {
    pub pane_id: String,
    pub account: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FailedSession {
    pub pane_id: String,
    pub account: String,
    pub code: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompressionStatus {
    pub phase: String,
    pub version: Option<String>,
    pub reason: Option<String>,
    pub claude: bool,
    pub active: Vec<LiveSession>,
    pub failures: Vec<FailedSession>,
}

/// A non-zero exit stays on disk until dismiss or the next successful launch.
/// A clean exit is removed and not reported. A dead pid with no exit file is recorded as 1.
fn reap(dir: &Path, id: &str, account: &str) -> Option<FailedSession> {
    let exit_path = dir.join(format!("{id}.exit"));
    let code = fs::read_to_string(&exit_path).ok().and_then(|t| t.trim().parse().ok()).unwrap_or(1);
    if code == 0 {
        let _ = fs::remove_file(&exit_path);
        return None;
    }
    if !exit_path.exists() {
        let _ = fs::write(&exit_path, format!("{code}\n"));
    }
    Some(FailedSession { pane_id: id.into(), account: account.into(), code })
}

fn pid_alive(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

/// Reads pid files. A dead pid is a failure when an exit code was recorded, and idle
/// when the launch ended cleanly. This does not start a process.
pub fn observe_dir(dir: &Path) -> (Vec<LiveSession>, Vec<FailedSession>) {
    let mut active = Vec::new();
    let mut failures = Vec::new();
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return (active, failures),
    };
    let mut pids = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if let Some(id) = name.strip_suffix(".pid") {
            if safe_pane(id) {
                pids.push(id.to_string());
            }
        }
    }
    // Exit files for panes that no longer have a pid.
    let mut exits = Vec::new();
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if let Some(id) = name.strip_suffix(".exit") {
                if safe_pane(id) && !pids.iter().any(|p| p == id) {
                    exits.push(id.to_string());
                }
            }
        }
    }
    for id in pids {
        let pid_path = dir.join(format!("{id}.pid"));
        let pid = fs::read_to_string(&pid_path).ok().and_then(|t| t.trim().parse().ok()).unwrap_or(0);
        let account = fs::read_to_string(dir.join(format!("{id}.account"))).unwrap_or_default().trim().to_string();
        if pid_alive(pid) {
            active.push(LiveSession { pane_id: id, account });
        } else {
            let _ = fs::remove_file(&pid_path);
            if let Some(failed) = reap(dir, &id, &account) {
                failures.push(failed);
            }
        }
    }
    for id in exits {
        let account = fs::read_to_string(dir.join(format!("{id}.account"))).unwrap_or_default().trim().to_string();
        if let Some(failed) = reap(dir, &id, &account) {
            failures.push(failed);
        }
    }
    (active, failures)
}

fn status_at(home: &Home) -> CompressionStatus {
    let claude = crate::which::locate("claude").is_some();
    let files = files_of(home, claude);
    let (phase, version, reason) = match classify(&files) {
        InstallState::Absent => ("absent".into(), None, None),
        InstallState::Unavailable { version, reason } => ("unavailable".into(), version, Some(reason)),
        InstallState::Ready { version } => ("ready".into(), Some(version), None),
    };
    let (active, failures) = observe_dir(&home.record_dir());
    CompressionStatus { phase, version, reason, claude, active, failures }
}

#[tauri::command]
pub fn context_compression_status() -> CompressionStatus {
    status_at(&Home::production())
}

#[tauri::command]
pub fn context_compression_dismiss() -> Result<(), String> {
    let dir = Home::production().record_dir();
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(e) => return Err(e.to_string()),
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.ends_with(".exit") {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aurelia-compress-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn touch_exe(path: &Path) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, "#!/bin/sh\nexit 0\n").unwrap();
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[test]
    fn the_switch_starts_off_and_a_missing_field_stays_off() {
        assert!(Config::default().context_compression.accounts.is_empty());
        let cfg: Config = serde_json::from_str("{}").unwrap();
        assert!(cfg.context_compression.accounts.is_empty());
    }

    #[test]
    fn classify_separates_absent_unavailable_and_ready() {
        assert_eq!(classify(&Files { bili_executable: false, wrapper_executable: false, claude_executable: false, version: None }), InstallState::Absent);
        assert!(matches!(
            classify(&Files { bili_executable: true, wrapper_executable: true, claude_executable: false, version: Some("0.1.212".into()) }),
            InstallState::Unavailable { reason, .. } if reason.contains("Claude Code")
        ));
        assert!(matches!(
            classify(&Files { bili_executable: true, wrapper_executable: true, claude_executable: true, version: Some("0.1.212".into()) }),
            InstallState::Ready { version } if version == "0.1.212"
        ));
    }

    #[test]
    fn the_registry_line_is_pinned_and_junk_is_refused() {
        assert_eq!(parse_version("0.1.212\n").unwrap(), "0.1.212");
        assert_eq!(parse_version("npm notice\n0.1.212\n").unwrap(), "0.1.212");
        assert!(parse_version("latest").is_err());
        assert!(parse_version("").is_err());
        assert!(parse_version("1.2").is_err());
    }

    #[test]
    fn the_managed_config_disables_updates_and_does_not_bind_a_public_address() {
        let body = managed_config_json();
        let v: serde_json::Value = serde_json::from_str(body).unwrap();
        assert_eq!(v["autoUpdate"], false);
        assert_eq!(v["advisoryCheck"], false);
        assert!(!body.contains("0.0.0.0"));
        assert!(!body.contains("HTTPS_PROXY"));
    }

    #[test]
    fn the_install_script_uses_corepack_pnpm_and_the_resolved_version() {
        let script = install_script(Path::new("/tmp/pkg"), "0.1.212");
        assert!(script.contains("corepack pnpm@11.21.0 install --ignore-scripts"));
        assert!(script.contains("'/tmp/pkg'"));
        assert!(!script.contains("sudo"));
        assert!(!script.contains("npm install -g"));
        let json: serde_json::Value = serde_json::from_str(&package_json("0.1.212")).unwrap();
        assert_eq!(json["dependencies"]["billion-context"], "0.1.212");
        assert_eq!(json["packageManager"], "pnpm@11.21.0");
    }

    #[test]
    fn an_unstamped_thread_gains_no_compression_environment() {
        let home = Home { root: temp("off") };
        let mut vars = BTreeMap::new();
        vars.insert("CLAUDE_CONFIG_DIR".into(), "/tmp/claude-work".into());
        apply(&home, &Config::default(), "pane-1", Some("work"), false, &mut vars).unwrap();
        assert!(vars.get("ACP_AUTO_UPDATE").is_none());
        assert!(vars.get("AURELIA_CONTEXT_COMPRESSION").is_none());
        assert_eq!(vars.get("CLAUDE_CONFIG_DIR").map(String::as_str), Some("/tmp/claude-work"));
    }

    #[test]
    fn a_stamped_thread_without_an_install_is_blocked_and_not_rewritten_into_plain_claude() {
        let home = Home { root: temp("block") };
        let mut vars = BTreeMap::new();
        apply(&home, &Config::default(), "pane-1", Some("work"), true, &mut vars).unwrap();
        let reason = vars.get(BLOCK_KEY).unwrap();
        assert!(reason.contains("isn't installed"));
        assert!(reason.contains("was not started"));
        assert!(vars.get("ACP_AUTO_UPDATE").is_none());
        assert!(vars.get("HTTPS_PROXY").is_none());
    }

    #[test]
    fn a_ready_thread_points_at_its_account_store_and_does_not_set_a_proxy_or_ca() {
        let root = temp("ready");
        let home = Home { root: root.clone() };
        touch_exe(&home.bili());
        touch_exe(&home.wrapper());
        let claude = root.join("claude");
        touch_exe(&claude);
        fs::write(home.meta(), "{\n  \"version\": \"0.1.212\"\n}\n").unwrap();
        let mut vars = BTreeMap::new();
        vars.insert("CLAUDE_CONFIG_DIR".into(), "/tmp/claude-work".into());
        apply_with(&home, &Config::default(), "pane-1", Some("work"), true, &mut vars, Some(&claude)).unwrap();
        for key in ["HTTPS_PROXY", "https_proxy", "NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "BILI_LAUNCHER_DIRECT", BLOCK_KEY] {
            assert!(vars.get(key).is_none(), "{key} was set");
        }
        assert_eq!(vars.get("ACP_AUTO_UPDATE").map(String::as_str), Some("0"));
        assert_eq!(vars.get("BILI_ADVISORY_CHECK").map(String::as_str), Some("0"));
        assert_eq!(vars.get("BILI_LAUNCHER_PLUGIN").map(String::as_str), Some("0"));
        assert_eq!(vars.get("AURELIA_CLAUDE_BIN").map(String::as_str), Some(claude.to_str().unwrap()));
        assert_eq!(vars.get("CLAUDE_CONFIG_DIR").map(String::as_str), Some("/tmp/claude-work"));
        assert!(vars.get("BILI_SESSIONS_DIR").unwrap().ends_with("sessions/work"));
        let cfg: serde_json::Value = serde_json::from_str(&fs::read_to_string(home.bili_config()).unwrap()).unwrap();
        assert_eq!(cfg["autoUpdate"], false);
        assert_eq!(cfg["advisoryCheck"], false);
    }

    #[test]
    fn cli_proxy_and_a_foreign_base_url_block_the_launch() {
        let root = temp("conflict");
        let home = Home { root: root.clone() };
        touch_exe(&home.bili());
        touch_exe(&home.wrapper());
        let claude = root.join("claude");
        touch_exe(&claude);
        fs::write(home.meta(), "{\"version\":\"0.1.212\"}").unwrap();
        let mut cfg = Config::default();
        cfg.proxy.enabled = true;
        let mut vars = BTreeMap::new();
        apply_with(&home, &cfg, "pane-1", Some("work"), true, &mut vars, Some(&claude)).unwrap();
        assert!(vars.get(BLOCK_KEY).unwrap().contains("CLIProxyAPI"));
        assert!(vars.get(BLOCK_KEY).unwrap().contains("Claude was not started."));
        assert!(vars.get("AURELIA_BILI").is_none());
        cfg.proxy.enabled = false;
        let mut vars = BTreeMap::new();
        vars.insert("ANTHROPIC_BASE_URL".into(), "https://api.deepseek.com/anthropic".into());
        apply_with(&home, &cfg, "pane-2", Some("work"), true, &mut vars, Some(&claude)).unwrap();
        assert!(vars.get(BLOCK_KEY).unwrap().contains("base URL"));
        assert!(vars.get("AURELIA_BILI").is_none());
        assert!(launch_block(false, false).is_none());
    }

    #[test]
    fn the_chat_command_keeps_claude_flags_and_binds_loopback() {
        let argv = vec![
            "/bin/zsh".into(),
            "-l".into(),
            "-c".into(),
            "exec \"$0\" \"$@\"".into(),
            "/usr/local/bin/claude".into(),
            "-p".into(),
            "--settings".into(),
            "/tmp/hooks.json".into(),
        ];
        let out = wrap_chat_argv(&argv, Path::new("/app/wrap.sh"), Path::new("/app/bili"), Path::new("/usr/local/bin/claude")).unwrap();
        assert_eq!(&out[..4], &argv[..4]);
        assert_eq!(out[4], "/app/wrap.sh");
        assert_eq!(out[5], "/app/bili");
        assert_eq!(&out[6..13], &["--host", "127.0.0.1", "--no-auto-update", "--bin", "/usr/local/bin/claude", "claude", "--"].map(str::to_string));
        assert_eq!(&out[13..], &["-p", "--settings", "/tmp/hooks.json"].map(str::to_string));
        assert!(!out.iter().any(|a| a == "0.0.0.0" || a == "--mitm-domain" || a.contains("plugin install")));
        assert!(wrap_chat_argv(&["claude".into()], Path::new("/w"), Path::new("/b"), Path::new("/c")).is_err());
    }

    #[test]
    fn a_dead_proxy_is_a_failure_and_observing_it_again_does_not_change_that() {
        let dir = temp("observe");
        let mut ended = std::process::Command::new("true").spawn().unwrap();
        let dead = ended.id();
        let _ = ended.wait();
        fs::write(dir.join("pane-1.pid"), format!("{dead}\n")).unwrap();
        fs::write(dir.join("pane-1.account"), "work\n").unwrap();
        fs::write(dir.join("pane-1.exit"), "2\n").unwrap();
        // 999999 is not alive. observe removes the pid and reports the exit.
        let (active, failures) = observe_dir(&dir);
        assert!(active.is_empty());
        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].code, 2);
        assert_eq!(failures[0].account, "work");
        let (active2, failures2) = observe_dir(&dir);
        assert!(active2.is_empty());
        assert_eq!(failures2.len(), 1);
        assert_eq!(failures2[0].code, 2);
        // A dead pid with no exit file is recorded once as a failure and not restarted.
        let mut ended = std::process::Command::new("true").spawn().unwrap();
        let dead = ended.id();
        let _ = ended.wait();
        fs::write(dir.join("pane-3.pid"), format!("{dead}\n")).unwrap();
        fs::write(dir.join("pane-3.account"), "work\n").unwrap();
        let (_, missing) = observe_dir(&dir);
        let missed = missing.iter().find(|f| f.pane_id == "pane-3").unwrap();
        assert_eq!(missed.code, 1);
        let (_, again) = observe_dir(&dir);
        assert_eq!(again.iter().find(|f| f.pane_id == "pane-3").unwrap().code, 1);
        assert!(!dir.join("pane-3.pid").exists());
    }

    #[test]
    fn a_live_pid_is_active_and_a_clean_exit_is_not_a_failure() {
        let dir = temp("live");
        fs::write(dir.join("pane-9.pid"), format!("{}\n", std::process::id())).unwrap();
        fs::write(dir.join("pane-9.account"), "home\n").unwrap();
        let (active, failures) = observe_dir(&dir);
        assert!(failures.is_empty());
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].pane_id, "pane-9");
        fs::remove_file(dir.join("pane-9.pid")).unwrap();
        fs::write(dir.join("pane-8.exit"), "0\n").unwrap();
        let (active, failures) = observe_dir(&dir);
        assert!(active.is_empty());
        assert!(failures.is_empty(), "a clean exit is not a failure and is not restarted");
        assert!(!dir.join("pane-8.exit").exists());
    }
}
