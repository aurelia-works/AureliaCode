//! App config (`~/Library/Application Support/AureliaSpace/config.json`) and
//! small JSON state files (layout, tasks) stored next to it.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

pub fn home_dir() -> PathBuf {
    PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/".into()))
}

/// The installed app's folder. Dev builds (`tauri dev`, and "AureliaSpace Dev" from
/// `npm run app:build:dev`) keep their layout, sockets, hooks and checkpoints in their own
/// folder, so they run next to the installed app without taking its voice socket or
/// overwriting its saved layout. Only config.json (accounts, settings) is shared.
fn installed_dir() -> PathBuf {
    home_dir().join("Library/Application Support/AureliaCode")
}

pub fn app_dir() -> PathBuf {
    if cfg!(debug_assertions) {
        home_dir().join("Library/Application Support/AureliaCode Dev")
    } else {
        installed_dir()
    }
}

/// First launch after the AureliaSpace → AureliaCode rename: copies the old app's folders
/// (config, layout, store, hooks) so nothing is lost. The old folder stays, so the old app
/// can still run next to the new one. Call before anything writes into `app_dir()`.
pub fn migrate_from_aureliaspace() {
    let support = home_dir().join("Library/Application Support");
    let mut pairs = vec![(support.join("AureliaSpace"), installed_dir())];
    if cfg!(debug_assertions) {
        pairs.push((support.join("AureliaSpace Dev"), app_dir()));
    }
    for (old, new) in pairs {
        match migrate_dir(&old, &new) {
            Ok(true) => eprintln!("[aurelia] copied {} → {}", old.display(), new.display()),
            Ok(false) => {}
            Err(e) => eprintln!("[aurelia] migrating {}: {e}", old.display()),
        }
    }
}

/// Written into `new` once the copy is done, so it happens once per folder.
const MIGRATED_MARKER: &str = ".migrated-from-aureliaspace";

/// Copies `old` into `new` once, overwriting what's there: before the first copy `new` only
/// holds defaults that something (cargo test, an early `load()`) wrote. Sockets (and the `run/`
/// folder that holds them) belong to the running old app and are skipped. The marker is written
/// last, so a crash halfway retries next launch. Returns whether it copied.
fn migrate_dir(old: &Path, new: &Path) -> Result<bool, String> {
    if new.join(MIGRATED_MARKER).exists() || !old.is_dir() {
        return Ok(false);
    }
    fs::create_dir_all(new).map_err(|e| e.to_string())?;
    // Best effort: a file that won't copy is logged and skipped. The marker is written either
    // way, so a later launch never copies again over what was changed in the new app since.
    let mut failed = Vec::new();
    copy_tree(old, new, &mut failed);
    for (path, e) in &failed {
        eprintln!("[aurelia] migration skipped {}: {e}", path.display());
    }
    fs::write(new.join(MIGRATED_MARKER), "").map_err(|e| e.to_string())?;
    Ok(true)
}

/// A consistent copy of a SQLite store that another process may be writing (`VACUUM INTO`
/// reads one transaction's view, WAL included, into a fresh file).
fn snapshot_db(from: &Path, to: &Path) -> Result<(), String> {
    let _ = fs::remove_file(to);
    let src = rusqlite::Connection::open_with_flags(from, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    src.execute("VACUUM INTO ?1", [to.to_string_lossy()]).map_err(|e| e.to_string())?;
    Ok(())
}

fn copy_tree(from: &Path, to: &Path, failed: &mut Vec<(PathBuf, std::io::Error)>) {
    if let Err(e) = fs::create_dir_all(to) {
        return failed.push((to.to_path_buf(), e));
    }
    let entries = match fs::read_dir(from) {
        Ok(entries) => entries,
        Err(e) => return failed.push((from.to_path_buf(), e)),
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Ok(kind) = entry.file_type() else { continue };
        let lossy = name.to_string_lossy();
        // A SQLite store's -wal/-shm belong to the old app's open connection; the .db is snapshotted whole.
        if name == "run" || lossy.ends_with(".sock") || lossy.ends_with(".db-wal") || lossy.ends_with(".db-shm") || kind.is_symlink() {
            continue;
        }
        let target = to.join(&name);
        if kind.is_dir() {
            copy_tree(&entry.path(), &target, failed);
        } else if kind.is_file() && lossy.ends_with(".db") {
            if let Err(e) = snapshot_db(&entry.path(), &target) {
                failed.push((entry.path(), std::io::Error::other(e)));
            }
        } else if kind.is_file() {
            if let Err(e) = fs::copy(entry.path(), &target) {
                failed.push((entry.path(), e));
            }
        }
    }
}

/// Expands a leading `~` and strips trailing slashes, so the result matches the
/// string Claude Code hashes for its keychain service name.
pub fn expand_path(p: &str) -> String {
    let expanded = if p == "~" {
        home_dir().to_string_lossy().into_owned()
    } else if let Some(rest) = p.strip_prefix("~/") {
        home_dir().join(rest).to_string_lossy().into_owned()
    } else {
        p.to_string()
    };
    let trimmed = expanded.trim_end_matches('/');
    if trimmed.is_empty() { "/".into() } else { trimmed.into() }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub name: String,
    pub config_dir: String,
}

impl Account {
    pub fn resolved_dir(&self) -> String {
        expand_path(&self.config_dir)
    }

    /// The default account (`~/.claude`) must run without CLAUDE_CONFIG_DIR, otherwise
    /// Claude Code looks for a different keychain entry and `.claude.json`.
    pub fn is_default(&self) -> bool {
        self.resolved_dir() == expand_path("~/.claude")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProviderConfig {
    pub base_url: String,
    pub model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SuggestionsConfig {
    /// "ollama" | "gemini" | "openrouter"
    pub provider: String,
    pub ollama: ProviderConfig,
    pub gemini: ProviderConfig,
    pub openrouter: ProviderConfig,
}

impl Default for SuggestionsConfig {
    fn default() -> Self {
        Self {
            provider: "ollama".into(),
            ollama: ProviderConfig {
                base_url: "http://localhost:11434".into(),
                model: "qwen2.5-coder:1.5b".into(),
            },
            gemini: ProviderConfig {
                base_url: "https://generativelanguage.googleapis.com/v1beta".into(),
                model: "gemini-2.5-flash".into(),
            },
            openrouter: ProviderConfig {
                base_url: "https://openrouter.ai/api/v1".into(),
                model: "qwen/qwen-2.5-coder-32b-instruct:free".into(),
            },
        }
    }
}

impl Default for ProviderConfig {
    fn default() -> Self {
        Self { base_url: String::new(), model: String::new() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TerminalConfig {
    pub font_family: String,
    pub font_size: f32,
    pub line_height: f32,
    pub scrollback: u32,
    pub option_as_meta: bool,
    /// Panes beyond this count use the DOM renderer instead of WebGL.
    pub webgl_pane_limit: u32,
    pub shell: String,
    /// Panes' shells live in the terminal host (ptyhost.rs) and keep running while the
    /// app quits, restarts or updates; off = they die with the app.
    pub keep_alive: bool,
}

impl Default for TerminalConfig {
    fn default() -> Self {
        Self {
            font_family: "\"JetBrains Mono\", \"SF Mono\", Menlo, Monaco, monospace".into(),
            font_size: 13.0,
            line_height: 1.15,
            scrollback: 10000,
            option_as_meta: true,
            webgl_pane_limit: 12,
            shell: String::new(),
            keep_alive: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CacheConfig {
    /// Prompt-cache TTL in minutes: 5 (default API TTL) or 60 (1-hour TTL).
    pub ttl_minutes: u32,
}

impl Default for CacheConfig {
    fn default() -> Self {
        Self { ttl_minutes: 60 }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct VoiceConfig {
    /// Tidy dictation typed into plain shell panes ("dash dash" -> "--", trailing period dropped).
    pub shell_cleanup: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct HudConfig {
    /// Floating session HUD, shown only while AureliaSpace isn't the focused app.
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ProxyConfig {
    /// Route chats through a local CLIProxyAPI hub (src-tauri/src/proxy.rs).
    pub enabled: bool,
    pub port: u16,
}

impl Default for ProxyConfig {
    fn default() -> Self {
        Self { enabled: false, port: 8317 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TrayConfig {
    /// The menu bar squid.
    pub enabled: bool,
    /// Sway while a thread is working.
    pub animate: bool,
    /// Points, 14-22.
    pub size: u32,
    /// `#rrggbb`, or empty to follow the menu bar (a template icon).
    pub color: String,
    /// Streamer mode: account details blurred until hovered 3 s or clicked.
    pub streamer: bool,
}

impl Default for TrayConfig {
    fn default() -> Self {
        Self { enabled: true, animate: false, size: 18, color: String::new(), streamer: false }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SoundsConfig {
    /// Alert sounds play from inside the app, so macOS Focus doesn't mute them.
    pub enabled: bool,
    /// 0-100.
    pub volume: u8,
    /// Event -> sound id ("glass" | "marimba" | "lantern" | "hourglass" | "pebble" | "off"); see src/lib/sounds.ts.
    pub events: std::collections::HashMap<String, String>,
    /// Folder -> (event -> sound id); wins over `events` for panes in that folder.
    pub projects: std::collections::HashMap<String, std::collections::HashMap<String, String>>,
}

impl Default for SoundsConfig {
    fn default() -> Self {
        let events = [
            ("needsHelp", "glass"),
            ("yourTurn", "lantern"),
            ("finished", "marimba"),
            ("cacheWarning", "hourglass"),
            ("cacheExpired", "pebble"),
        ]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();
        Self { enabled: true, volume: 70, events, projects: Default::default() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PushConfig {
    /// Send alerts to the phone through an ntfy topic while the window isn't focused.
    pub enabled: bool,
    /// ntfy server; the public one unless self-hosted.
    pub server: String,
    /// Private topic the phone subscribes to; anyone who knows it can read the alerts.
    pub topic: String,
    /// Include the project and message; off = a generic "Claude needs you".
    pub detail: bool,
}

impl Default for PushConfig {
    fn default() -> Self {
        Self { enabled: false, server: "https://ntfy.sh".into(), topic: String::new(), detail: false }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct EffortConfig {
    /// Prompts sent from the composer pick their own effort (effort.rs, lib/effort.ts).
    pub auto: bool,
    /// Unclear prompts go to a Haiku 5.5 judge; off = rules only.
    pub judge: bool,
    pub floor: String,
    /// xhigh and max cost the most; they still apply when the prompt asks for them by name
    /// only if the ceiling allows.
    pub ceiling: String,
    /// Panes launched on a task start on the model picked for it (haiku/sonnet/opus).
    pub auto_model: bool,
}

impl Default for EffortConfig {
    fn default() -> Self {
        Self { auto: true, judge: true, floor: "low".into(), ceiling: "high".into(), auto_model: false }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SubagentsConfig {
    /// Claude panes get a `deepseek_agent` tool that hands tasks to OpenCode (subagents.rs).
    pub enabled: bool,
    /// OpenCode model the agents run on: `provider/model[#variant]`.
    pub model: String,
    /// An agent still running after this long is stopped.
    pub timeout_minutes: u64,
}

impl Default for SubagentsConfig {
    fn default() -> Self {
        Self { enabled: true, model: "opencode-go/deepseek-v4.1-flash".into(), timeout_minutes: 15 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RemoteConfig {
    /// Serve the phone remote (remote.rs): a web page that lists and drives the panes.
    pub enabled: bool,
    pub port: u16,
    /// Also accept phones on the local network; off = this Mac and Tailscale only.
    pub allow_lan: bool,
    /// Serve the remote at https://<mac>.<tailnet>.ts.net through `tailscale serve`.
    pub tailscale_https: bool,
    /// The HTTPS port `tailscale serve` listens on (443 = no port in the address).
    pub https_port: u16,
    /// Hide the window instead of quitting when the close button is pressed, so agents and
    /// the phone remote keep running. Click the dock icon to bring it back.
    pub keep_running: bool,
}

impl Default for RemoteConfig {
    fn default() -> Self {
        Self { enabled: false, port: 4747, allow_lan: false, tailscale_https: false, https_port: 443, keep_running: false }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DiscordConfig {
    /// Discord Rich Presence; on by default, like a game's.
    pub enabled: bool,
    /// Unused: AureliaSpace ships its own Discord application. Kept so old configs parse.
    pub client_id: String,
    /// Show "Working in a project" instead of the project name.
    pub hide_project: bool,
}

impl Default for DiscordConfig {
    fn default() -> Self {
        Self { enabled: true, client_id: String::new(), hide_project: false }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub accounts: Vec<Account>,
    pub usage_script: String,
    pub usage_refresh_seconds: u64,
    /// "system" | "light" | "dark"
    pub theme: String,
    /// Named color palette: "aurelia" | "midnight" | "nord" | "solarized" | "rose-pine" | "catppuccin"
    pub palette: String,
    pub notifications: bool,
    pub sounds: SoundsConfig,
    pub push: PushConfig,
    /// Command used to open files (receives `path[:line[:col]]`); empty = Cursor, then
    /// VS Code, then the default app.
    pub editor: String,
    /// Folder new panes open in when they have no cwd to inherit.
    pub default_workspace: String,
    pub terminal: TerminalConfig,
    pub suggestions: SuggestionsConfig,
    pub cache: CacheConfig,
    pub voice: VoiceConfig,
    pub hud: HudConfig,
    pub tray: TrayConfig,
    pub proxy: ProxyConfig,
    pub discord: DiscordConfig,
    /// Account new Claude panes use when none is chosen; empty = ask.
    pub default_account: String,
    /// Folder -> account name; wins over `default_account` for panes in that folder.
    pub workspace_accounts: std::collections::HashMap<String, String>,
    /// Claude panes restored at launch reopen the conversation they last ran.
    pub resume_on_launch: bool,
    /// `--permission-mode` for Claude panes AureliaSpace starts; empty = Claude's own default.
    pub claude_permission_mode: String,
    /// The one-time setup (permissions, model, effort, account) has been answered; it never asks again.
    pub setup_done: bool,
    /// ⌘-clicked paths and the Files view open in an editor pane; off = `editor` above.
    pub open_files_in_app: bool,
    pub subagents: SubagentsConfig,
    /// `aurelia_*` tools: Claude panes may list, read and message other panes (orchestrator.rs).
    pub orchestrator: bool,
    /// Scheduled prompts (src/lib/routines.ts); kept as the frontend writes them.
    pub routines: Vec<Value>,
    pub effort: EffortConfig,
    pub remote: RemoteConfig,
    /// Interface contrast: "normal" | "high" (T3-style accessibility).
    pub contrast: String,
    /// Chat column width: "comfortable" | "wide" | "full".
    pub chat_width: String,
    /// Turn off panel/message animations regardless of the OS setting.
    pub reduce_motion: bool,
    /// Agent logos in their brand colour (Claude's orange); off keeps colour for state only.
    pub brand_marks: bool,
    /// Enter sends a chat message; off means ⌘Enter sends and Enter inserts a newline.
    pub chat_send_on_enter: bool,
    /// Show the time next to chat messages.
    pub chat_timestamps: bool,
    /// Links clicked in chat: "system" | "local" (local dev servers in-app) | "app" (all in-app).
    pub link_open: String,
    /// Address-bar search engine: "duckduckgo" | "google" | "bing".
    pub browser_search: String,
    /// New threads start on their own git worktree by default.
    pub worktree_by_default: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            accounts: detect_accounts(),
            usage_script: "~/.claude/fetch-usage.sh".into(),
            usage_refresh_seconds: 180,
            theme: "system".into(),
            palette: "aurelia".into(),
            notifications: true,
            sounds: SoundsConfig::default(),
            push: PushConfig::default(),
            editor: String::new(),
            default_workspace: "~".into(),
            terminal: TerminalConfig::default(),
            suggestions: SuggestionsConfig::default(),
            cache: CacheConfig::default(),
            voice: VoiceConfig::default(),
            hud: HudConfig::default(),
            tray: TrayConfig::default(),
            proxy: ProxyConfig::default(),
            discord: DiscordConfig::default(),
            default_account: String::new(),
            workspace_accounts: Default::default(),
            resume_on_launch: true,
            claude_permission_mode: String::new(),
            setup_done: false,
            open_files_in_app: true,
            subagents: SubagentsConfig::default(),
            orchestrator: true,
            routines: Vec::new(),
            effort: EffortConfig::default(),
            remote: RemoteConfig::default(),
            contrast: "normal".into(),
            chat_width: "comfortable".into(),
            reduce_motion: false,
            brand_marks: false,
            chat_send_on_enter: true,
            chat_timestamps: false,
            link_open: "local".into(),
            browser_search: "duckduckgo".into(),
            worktree_by_default: false,
        }
    }
}

/// First-run default: every `~/.claude` / `~/.claude-*` directory becomes an account.
fn detect_accounts() -> Vec<Account> {
    let mut accounts: Vec<Account> = fs::read_dir(home_dir())
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .filter(|e| e.path().is_dir())
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().into_owned();
                    let is_claude = name == ".claude"
                        || name.strip_prefix(".claude-").is_some_and(|s| !s.is_empty());
                    is_claude.then(|| Account {
                        name: name.trim_start_matches('.').into(),
                        config_dir: format!("~/{name}"),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    accounts.sort_by(|a, b| a.name.cmp(&b.name));
    if accounts.is_empty() {
        accounts.push(Account { name: "claude".into(), config_dir: "~/.claude".into() });
    }
    accounts
}

pub fn config_path() -> PathBuf {
    installed_dir().join("config.json")
}

/// Loads config, writing the default file on first run. A malformed file falls back
/// to defaults without being overwritten, so hand edits are never lost.
pub fn load() -> Config {
    let path = config_path();
    match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).unwrap_or_else(|e| {
            eprintln!("[aurelia] config.json is invalid ({e}); using defaults");
            Config::default()
        }),
        Err(_) => {
            let cfg = Config::default();
            let _ = write_json(&path, &serde_json::to_value(&cfg).unwrap_or(Value::Null));
            cfg
        }
    }
}

fn write_json(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(&tmp, text).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

/// Atomic JSON write for files only this user may read (pairing tokens, remote devices).
/// The temp file is created 0600 before any bytes are written, so there is no window where
/// it is world-readable, and a crash leaves either the old file or the complete new one.
pub(crate) fn write_private_json(path: &Path, value: &Value) -> Result<(), String> {
    use std::io::Write;
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(&tmp)
        .map_err(|e| e.to_string())?;
    file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    file.sync_all().map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    Ok(())
}

/// Only these state files may be read/written from the frontend.
fn state_path(name: &str) -> Result<PathBuf, String> {
    match name {
        "layout" | "tasks" | "work" | "ui" | "recents" | "agents" | "prompts" | "routines" | "planner" | "teamruns" | "skills" => Ok(app_dir().join(format!("{name}.json"))),
        _ => Err(format!("unknown state file: {name}")),
    }
}

#[tauri::command]
pub fn get_config() -> Config {
    load()
}

/// Trims and checks accounts so a bad edit can't leave panes pointing at a missing or duplicated account.
fn validate_accounts(accounts: &mut [Account]) -> Result<(), String> {
    if accounts.is_empty() {
        return Err("at least one account is required".into());
    }
    for a in accounts.iter_mut() {
        a.name = a.name.trim().to_string();
        a.config_dir = a.config_dir.trim().to_string();
        if a.name.is_empty() || a.config_dir.is_empty() {
            return Err("every account needs a name and a config folder".into());
        }
    }
    for (i, a) in accounts.iter().enumerate() {
        if accounts[..i].iter().any(|b| b.name.eq_ignore_ascii_case(&a.name)) {
            return Err(format!("duplicate account name '{}'", a.name));
        }
    }
    Ok(())
}

#[tauri::command]
pub fn save_config(mut config: Config) -> Result<(), String> {
    validate_accounts(&mut config.accounts)?;
    write_json(&config_path(), &serde_json::to_value(&config).map_err(|e| e.to_string())?)
}

#[tauri::command]
pub fn load_state(name: String) -> Result<Option<Value>, String> {
    read_state(&state_path(&name)?)
}

/// A missing file is None. A file that can't be read is an error (so the frontend never saves an empty state over it).
/// A file that isn't valid JSON is copied to `<name>.corrupt.json` first, then treated as missing.
fn read_state(path: &Path) -> Result<Option<Value>, String> {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    match serde_json::from_str(&text) {
        Ok(v) => Ok(Some(v)),
        Err(_) => {
            let _ = fs::write(path.with_extension("corrupt.json"), &text);
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn save_state(name: String, value: Value) -> Result<(), String> {
    write_json(&state_path(&name)?, &value)
}

/// Opens the config folder (or config.json in the default text editor).
#[tauri::command]
pub fn reveal_config(file: bool) -> Result<(), String> {
    let mut cmd = std::process::Command::new("open");
    if file {
        load(); // make sure it exists
        cmd.arg("-t").arg(config_path());
    } else {
        cmd.arg(app_dir());
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Nearest ancestor containing `.git`, else the directory itself. Used as the task-list key.
#[tauri::command]
pub fn project_root(cwd: String) -> String {
    let start = PathBuf::from(expand_path(&cwd));
    let mut dir = start.as_path();
    loop {
        if dir.join(".git").exists() {
            return dir.to_string_lossy().into_owned();
        }
        match dir.parent() {
            Some(p) => dir = p,
            None => return start.to_string_lossy().into_owned(),
        }
    }
}

#[cfg(test)]
mod state_file_tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aurelia-state-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn missing_file_is_none() {
        let dir = temp("missing");
        assert_eq!(read_state(&dir.join("planner.json")).unwrap(), None);
    }

    #[test]
    fn valid_file_is_read() {
        let dir = temp("valid");
        fs::write(dir.join("planner.json"), r#"{"a":1}"#).unwrap();
        assert_eq!(read_state(&dir.join("planner.json")).unwrap().unwrap()["a"], 1);
    }

    #[test]
    fn corrupt_file_is_kept_aside_and_reads_as_none() {
        let dir = temp("corrupt");
        fs::write(dir.join("planner.json"), "{ half").unwrap();
        assert_eq!(read_state(&dir.join("planner.json")).unwrap(), None);
        assert_eq!(fs::read_to_string(dir.join("planner.corrupt.json")).unwrap(), "{ half");
    }

    #[test]
    fn unreadable_path_is_an_error_not_none() {
        let dir = temp("dir");
        // A directory where the file should be: reading it fails with something other than NotFound.
        fs::create_dir_all(dir.join("planner.json")).unwrap();
        assert!(read_state(&dir.join("planner.json")).is_err());
    }
}

#[cfg(test)]
mod migrate_tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("aurelia-migrate-test-{}-{name}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn copies_old_folder_but_not_sockets() {
        let root = temp("copy");
        let old = root.join("AureliaSpace");
        fs::create_dir_all(old.join("run")).unwrap();
        fs::create_dir_all(old.join("hooks")).unwrap();
        fs::write(old.join("config.json"), "{}").unwrap();
        fs::write(old.join("hooks/hook.sh"), "x").unwrap();
        fs::write(old.join("run/control.sock"), "").unwrap();
        fs::write(old.join("voice.sock"), "").unwrap();
        let new = root.join("AureliaCode");
        assert!(migrate_dir(&old, &new).unwrap());
        assert_eq!(fs::read_to_string(new.join("config.json")).unwrap(), "{}");
        assert_eq!(fs::read_to_string(new.join("hooks/hook.sh")).unwrap(), "x");
        assert!(!new.join("run").exists());
        assert!(!new.join("voice.sock").exists());
        assert!(old.join("config.json").exists(), "the old app keeps its folder");
    }

    #[test]
    fn a_stray_default_config_does_not_block_the_copy() {
        // cargo test and early config::load() calls write a default config.json before the app's first run.
        let root = temp("stray");
        let old = root.join("AureliaSpace");
        let new = root.join("AureliaCode");
        fs::create_dir_all(&old).unwrap();
        fs::create_dir_all(&new).unwrap();
        fs::write(old.join("config.json"), "old").unwrap();
        fs::write(new.join("config.json"), "default").unwrap();
        assert!(migrate_dir(&old, &new).unwrap());
        assert_eq!(fs::read_to_string(new.join("config.json")).unwrap(), "old");
    }

    #[test]
    fn an_unreadable_file_is_skipped_and_the_copy_still_counts() {
        use std::os::unix::fs::PermissionsExt;
        let root = temp("unreadable");
        let old = root.join("AureliaSpace");
        let new = root.join("AureliaCode");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("config.json"), "old").unwrap();
        fs::write(old.join("locked.json"), "x").unwrap();
        fs::set_permissions(old.join("locked.json"), fs::Permissions::from_mode(0o000)).unwrap();
        assert!(migrate_dir(&old, &new).unwrap());
        assert_eq!(fs::read_to_string(new.join("config.json")).unwrap(), "old");
        // Marked done, so a later launch never copies over what was changed since.
        fs::write(new.join("config.json"), "edited").unwrap();
        assert!(!migrate_dir(&old, &new).unwrap());
        assert_eq!(fs::read_to_string(new.join("config.json")).unwrap(), "edited");
    }

    #[test]
    fn the_store_is_copied_as_a_snapshot_not_raw_wal_files() {
        let root = temp("db");
        let old = root.join("AureliaSpace");
        let new = root.join("AureliaCode");
        fs::create_dir_all(&old).unwrap();
        // The old app holds the store open in WAL mode while the new one copies it.
        let live = rusqlite::Connection::open(old.join("aurelia.db")).unwrap();
        live.execute_batch("PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE t(x); INSERT INTO t VALUES (42);").unwrap();
        assert!(old.join("aurelia.db-wal").exists());
        assert!(migrate_dir(&old, &new).unwrap());
        assert!(!new.join("aurelia.db-wal").exists() && !new.join("aurelia.db-shm").exists());
        let copy = rusqlite::Connection::open(new.join("aurelia.db")).unwrap();
        assert_eq!(copy.query_row("SELECT x FROM t", [], |r| r.get::<_, i64>(0)).unwrap(), 42);
        drop(live);
    }

    #[test]
    fn copies_only_once() {
        let root = temp("once");
        let old = root.join("AureliaSpace");
        let new = root.join("AureliaCode");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("config.json"), "old").unwrap();
        assert!(migrate_dir(&old, &new).unwrap());
        fs::write(new.join("config.json"), "edited in AureliaCode").unwrap();
        assert!(!migrate_dir(&old, &new).unwrap());
        assert_eq!(fs::read_to_string(new.join("config.json")).unwrap(), "edited in AureliaCode");
    }

    #[test]
    fn nothing_to_migrate_without_old_folder() {
        let root = temp("none");
        assert!(!migrate_dir(&root.join("AureliaSpace"), &root.join("AureliaCode")).unwrap());
        assert!(!root.join("AureliaCode").exists());
    }
}
