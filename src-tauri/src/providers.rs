//! What each agent CLI on this Mac can do: installed or not, signed in or not (and how), its
//! models and capabilities. Read only from the CLIs' own status commands (`claude auth status`,
//! `opencode auth list`, `grok models`, `codex login status`) and Gemini's settings file; no
//! credential is ever read. Cached until a refresh, since some of these take seconds.

use crate::{config, which};
use serde::Serialize;
use std::io::Read;
use std::os::unix::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    /// "claude:<account>" for Claude, else the provider id.
    pub id: String,
    pub provider: String,
    pub label: String,
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
    /// None when the CLI has no way to tell.
    pub signed_in: Option<bool>,
    /// How it signs in: "Claude.ai account, Pro plan", "ChatGPT", "Google sign-in", "API key".
    pub auth: Option<String>,
    pub email: Option<String>,
    pub models: Vec<String>,
    pub default_model: Option<String>,
    /// From: chat (runs as a chat here), resume, interrupt, steer, effort, images, files, mcp.
    pub caps: Vec<String>,
    /// Why a status command failed, if it did.
    pub error: Option<String>,
}

static CACHE: Mutex<Option<Vec<ProviderStatus>>> = Mutex::new(None);

/// Every known provider's status; runs the CLIs again only when `refresh` (or on first call).
#[tauri::command]
pub async fn providers(refresh: bool) -> Result<Vec<ProviderStatus>, String> {
    if !refresh {
        if let Some(c) = CACHE.lock().unwrap().clone() {
            return Ok(c);
        }
    }
    let all = tauri::async_runtime::spawn_blocking(discover_all).await.map_err(|e| e.to_string())?;
    *CACHE.lock().unwrap() = Some(all.clone());
    Ok(all)
}

fn discover_all() -> Vec<ProviderStatus> {
    let accounts = config::load().accounts;
    let mut jobs: Vec<std::thread::JoinHandle<ProviderStatus>> = accounts
        .into_iter()
        .map(|a| std::thread::spawn(move || claude(&a.name, (!a.is_default()).then(|| a.resolved_dir()))))
        .collect();
    for f in [opencode, gemini, grok, codex, cursor, copilot] {
        jobs.push(std::thread::spawn(f));
    }
    jobs.into_iter().filter_map(|j| j.join().ok()).collect()
}

fn caps(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

/// The base status for `bin`: where it is and its version, or not installed.
fn base(id: &str, provider: &str, label: &str, bin: &str, version_args: &[&str], known: &[&str]) -> (ProviderStatus, Option<String>) {
    let mut s = ProviderStatus { id: id.into(), provider: provider.into(), label: label.into(), caps: caps(known), ..Default::default() };
    let Some(path) = which::locate(bin) else { return (s, None) };
    let path = path.to_string_lossy().into_owned();
    s.installed = true;
    s.path = Some(path.clone());
    s.version = run(&path, version_args, &[]).ok().and_then(|o| parse_version(&o.1));
    (s, Some(path))
}

fn claude(account: &str, config_dir: Option<String>) -> ProviderStatus {
    let (mut s, path) = base(&format!("claude:{account}"), "claude", &format!("Claude · {account}"), "claude", &["--version"], &["chat", "resume", "interrupt", "steer", "effort", "images", "files", "mcp"]);
    let Some(path) = path else { return s };
    let env: Vec<(&str, String)> = config_dir.into_iter().map(|d| ("CLAUDE_CONFIG_DIR", d)).collect();
    match run(&path, &["auth", "status", "--json"], &env) {
        Ok((_, out)) => match parse_claude_auth(&out) {
            Some(a) => {
                s.signed_in = Some(a.signed_in);
                s.auth = a.auth;
                s.email = a.email;
            }
            None => s.error = Some(first_line(&out)),
        },
        Err(e) => s.error = Some(e),
    }
    s
}

fn opencode() -> ProviderStatus {
    let (mut s, path) = base("opencode", "opencode", "OpenCode", "opencode", &["--version"], &["resume", "effort", "files", "mcp"]);
    let Some(path) = path else { return s };
    match run(&path, &["auth", "list"], &[]) {
        Ok((_, out)) => {
            let signed = parse_opencode_auth(&out);
            s.signed_in = Some(!signed.is_empty());
            s.auth = (!signed.is_empty()).then(|| signed.join(", "));
        }
        Err(e) => s.error = Some(e),
    }
    match run(&path, &["models"], &[]) {
        Ok((_, out)) => s.models = parse_opencode_models(&out),
        Err(e) => s.error = s.error.take().or(Some(e)),
    }
    s
}

fn gemini() -> ProviderStatus {
    let (mut s, path) = base("gemini", "gemini", "Gemini CLI", "gemini", &["--version"], &["resume", "files", "mcp"]);
    if path.is_none() {
        return s;
    }
    let home = std::env::var("HOME").unwrap_or_default();
    let dir = Path::new(&home).join(".gemini");
    let settings = std::fs::read_to_string(dir.join("settings.json")).unwrap_or_default();
    let g = parse_gemini(&settings, dir.join("oauth_creds.json").is_file());
    s.signed_in = g.signed_in;
    s.auth = g.auth;
    s.default_model = g.model.clone();
    s.models = g.model.into_iter().collect();
    s
}

fn grok() -> ProviderStatus {
    let (mut s, path) = base("grok", "grok", "Grok", "grok", &["version"], &["resume", "effort", "mcp"]);
    let Some(path) = path else { return s };
    match run(&path, &["models"], &[]) {
        Ok((code, out)) => {
            let (g, why) = grok_status(code, &out);
            s.signed_in = g.signed_in;
            s.models = g.models;
            s.default_model = g.default;
            s.error = why;
        }
        Err(e) => s.error = Some(e),
    }
    s
}

struct GrokStatus {
    signed_in: Option<bool>,
    models: Vec<String>,
    default: Option<String>,
}

/// `grok models` with its exit code: a failure that doesn't say "not authenticated" leaves the
/// sign-in unknown and passes on why, rather than reading as signed in.
fn grok_status(code: i32, out: &str) -> (GrokStatus, Option<String>) {
    let g = parse_grok_models(out);
    let says_out = !g.signed_in;
    let failed = code != 0 && !says_out;
    let signed_in = if failed { None } else { Some(g.signed_in) };
    (GrokStatus { signed_in, models: g.models, default: g.default }, failed.then(|| first_line(out)))
}

fn codex() -> ProviderStatus {
    let (mut s, path) = base("codex", "codex", "OpenAI Codex", "codex", &["--version"], &["resume", "effort", "images", "mcp"]);
    let Some(path) = path else { return s };
    match run(&path, &["login", "status"], &[]) {
        Ok((_, out)) => {
            let (signed, how) = parse_codex_login(&out);
            s.signed_in = Some(signed);
            s.auth = how;
        }
        Err(e) => s.error = Some(e),
    }
    s
}

fn cursor() -> ProviderStatus {
    base("cursor", "cursor", "Cursor CLI", "cursor-agent", &["--version"], &["resume", "mcp"]).0
}

fn copilot() -> ProviderStatus {
    base("copilot", "copilot", "GitHub Copilot", "copilot", &["--version"], &["resume", "mcp"]).0
}

/// Runs a status command: (exit code, stdout then stderr). Bounded; the group is killed on timeout.
fn run(path: &str, args: &[&str], env: &[(&str, String)]) -> Result<(i32, String), String> {
    // A GUI app's PATH is minimal; node-based CLIs need to find node.
    let dir = Path::new(path).parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
    let inherited = std::env::var("PATH").unwrap_or_default();
    let mut cmd = Command::new(path);
    cmd.args(args)
        .env("PATH", format!("{dir}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:{inherited}"))
        .env("NO_COLOR", "1")
        .env_remove("CLAUDECODE")
        .env_remove("CLAUDE_CODE_ENTRYPOINT")
        .env_remove("CLAUDE_CONFIG_DIR")
        .current_dir(std::env::temp_dir())
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);
    for (k, v) in env {
        cmd.env(k, v);
    }
    let mut child = cmd.spawn().map_err(|e| format!("couldn't run {}: {e}", Path::new(path).file_name().unwrap_or_default().to_string_lossy()))?;
    let pid = child.id() as i32;
    let read = |r: Option<Box<dyn Read + Send>>| {
        std::thread::spawn(move || {
            let mut s = String::new();
            if let Some(mut r) = r {
                let _ = r.read_to_string(&mut s);
            }
            s
        })
    };
    let out = read(child.stdout.take().map(|r| Box::new(r) as Box<dyn Read + Send>));
    let err = read(child.stderr.take().map(|r| Box::new(r) as Box<dyn Read + Send>));
    let started = Instant::now();
    let code = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st.code().unwrap_or(-1),
            Ok(None) if started.elapsed() > TIMEOUT => {
                unsafe { libc::killpg(pid, libc::SIGKILL) };
                let _ = child.wait();
                return Err(format!("no answer in {} s", TIMEOUT.as_secs()));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(30)),
            Err(e) => return Err(e.to_string()),
        }
    };
    // A child left holding the pipes would block the readers; the group is ours until reaped.
    unsafe { libc::killpg(pid, libc::SIGKILL) };
    let text = format!("{}{}", out.join().unwrap_or_default(), err.join().unwrap_or_default());
    Ok((code, strip_ansi(&text)))
}

fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\u{1b}' && chars.peek() == Some(&'[') {
            chars.next();
            while let Some(&n) = chars.peek() {
                chars.next();
                if n.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn first_line(s: &str) -> String {
    s.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("no output").chars().take(200).collect()
}

/// "2.1.318 (Claude Code)", "codex-cli 0.166.0", "opencode v2.0.15" → the version number.
fn parse_version(out: &str) -> Option<String> {
    out.split(|c: char| c.is_whitespace() || c == '(' || c == ')')
        .map(|w| w.trim_start_matches('v'))
        .find(|w| w.split('.').count() >= 2 && w.split('.').all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit())))
        .map(str::to_string)
}

struct ClaudeAuth {
    signed_in: bool,
    auth: Option<String>,
    email: Option<String>,
}

/// `claude auth status --json`.
fn parse_claude_auth(out: &str) -> Option<ClaudeAuth> {
    let start = out.find('{')?;
    let v: serde_json::Value = serde_json::from_str(out[start..].trim()).ok()?;
    let signed_in = v.get("loggedIn")?.as_bool()?;
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).filter(|x| !x.is_empty());
    let method = match s("authMethod") {
        Some("claude.ai") => Some("Claude.ai account".to_string()),
        Some("api_key" | "apiKey" | "console") => Some("API key".to_string()),
        Some(other) => Some(other.to_string()),
        None => None,
    };
    let via = s("apiProvider").filter(|p| *p != "firstParty").map(|p| format!("via {p}"));
    let plan = s("subscriptionType").map(|p| {
        let mut c = p.chars();
        format!("{}{} plan", c.next().map(|f| f.to_uppercase().to_string()).unwrap_or_default(), c.as_str())
    });
    let parts: Vec<String> = [method, via, plan].into_iter().flatten().collect();
    Some(ClaudeAuth { signed_in, auth: (!parts.is_empty()).then(|| parts.join(", ")), email: s("email").map(str::to_string) })
}

/// `opencode auth list`: one line per stored credential, "<Provider>  <label>  <kind>".
fn parse_opencode_auth(out: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    for line in out.lines() {
        let line = line.trim_start_matches(|c: char| !c.is_alphanumeric()).trim();
        let Some(name) = line.split("  ").map(str::trim).find(|p| !p.is_empty()) else { continue };
        let lower = name.to_lowercase();
        if line.split_whitespace().count() < 2 || lower.starts_with("credentials") || lower.ends_with(" credentials") || name.contains(':') {
            continue;
        }
        if !names.iter().any(|n| n == name) {
            names.push(name.to_string());
        }
    }
    names
}

/// `opencode models`: "provider/model" lines.
fn parse_opencode_models(out: &str) -> Vec<String> {
    out.lines()
        .map(str::trim)
        .filter(|l| {
            let mut it = l.splitn(2, '/');
            matches!((it.next(), it.next()), (Some(p), Some(m)) if !p.is_empty() && !m.is_empty() && !l.contains(char::is_whitespace))
        })
        .map(str::to_string)
        .collect()
}

struct GrokModels {
    signed_in: bool,
    models: Vec<String>,
    default: Option<String>,
}

/// `grok models`: "You are not authenticated." when signed out, then "  * id (default)" / "  - id".
fn parse_grok_models(out: &str) -> GrokModels {
    let signed_in = !out.to_lowercase().contains("not authenticated");
    let mut models = Vec::new();
    let mut default = None;
    for line in out.lines() {
        let t = line.trim();
        if let Some(rest) = t.strip_prefix("Default model:") {
            default = Some(rest.trim().to_string()).filter(|d| !d.is_empty());
        } else if let Some(rest) = t.strip_prefix("* ").or_else(|| t.strip_prefix("- ")) {
            let id = rest.split_whitespace().next().unwrap_or("");
            if !id.is_empty() {
                if rest.contains("(default)") && default.is_none() {
                    default = Some(id.to_string());
                }
                models.push(id.to_string());
            }
        }
    }
    GrokModels { signed_in, models, default }
}

/// `codex login status`: "Logged in using ChatGPT" / "Logged in using an API key" / "Not logged in".
fn parse_codex_login(out: &str) -> (bool, Option<String>) {
    let l = out.to_lowercase();
    if l.contains("not logged in") {
        return (false, None);
    }
    if !l.contains("logged in") {
        return (false, None);
    }
    let how = if l.contains("api key") { "API key" } else if l.contains("chatgpt") { "ChatGPT" } else { "signed in" };
    (true, Some(how.to_string()))
}

struct GeminiAuth {
    signed_in: Option<bool>,
    auth: Option<String>,
    model: Option<String>,
}

/// ~/.gemini/settings.json (`security.auth.selectedType`, `model.name`) and whether the OAuth
/// credentials file exists (it isn't read). An API key can live anywhere, so it's "unknown".
fn parse_gemini(settings: &str, creds_exist: bool) -> GeminiAuth {
    let v: serde_json::Value = serde_json::from_str(settings).unwrap_or_default();
    let kind = v.pointer("/security/auth/selectedType").or_else(|| v.get("selectedAuthType")).and_then(|x| x.as_str());
    let model = v.pointer("/model/name").and_then(|x| x.as_str()).filter(|m| !m.is_empty()).map(str::to_string);
    let (signed_in, auth) = match kind {
        Some("oauth-personal") => (Some(creds_exist), Some("Google sign-in".to_string())),
        Some("gemini-api-key") => (None, Some("API key".to_string())),
        Some("vertex-ai") => (None, Some("Vertex AI".to_string())),
        Some(other) => (None, Some(other.to_string())),
        None => (Some(creds_exist), creds_exist.then(|| "Google sign-in".to_string())),
    };
    GeminiAuth { signed_in, auth, model }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions_come_out_of_each_cli_s_own_format() {
        assert_eq!(parse_version("2.1.318 (Claude Code)").as_deref(), Some("2.1.318"));
        assert_eq!(parse_version("codex-cli 0.166.0").as_deref(), Some("0.166.0"));
        assert_eq!(parse_version("opencode v2.0.15").as_deref(), Some("2.0.15"));
        assert_eq!(parse_version("grok 1.0.70 (f50904eaee6c) [stable]").as_deref(), Some("1.0.70"));
        assert_eq!(parse_version("0.46.0\n").as_deref(), Some("0.46.0"));
        assert_eq!(parse_version("command not found"), None);
    }

    #[test]
    fn claude_auth_status_says_how_and_which_plan() {
        let a = parse_claude_auth(r#"{"loggedIn": true, "authMethod": "claude.ai", "apiProvider": "firstParty", "email": "a@b.c", "orgId": "x", "subscriptionType": "pro"}"#).unwrap();
        assert!(a.signed_in);
        assert_eq!(a.auth.as_deref(), Some("Claude.ai account, Pro plan"));
        assert_eq!(a.email.as_deref(), Some("a@b.c"));
        let k = parse_claude_auth(r#"{"loggedIn": true, "authMethod": "api_key", "apiProvider": "bedrock"}"#).unwrap();
        assert_eq!(k.auth.as_deref(), Some("API key, via bedrock"));
        let out = parse_claude_auth(r#"{"loggedIn": false}"#).unwrap();
        assert!(!out.signed_in && out.auth.is_none());
        assert!(parse_claude_auth("error: unknown command 'auth'").is_none());
    }

    #[test]
    fn opencode_lists_the_providers_it_has_credentials_for() {
        let out = "OpenCode Go       OpenCode Go                 stored\nOpenAI            OpenAI                      stored\nOpenCode Console  Aurelia                     stored\nOpenCode Console  Default                     stored\n";
        assert_eq!(parse_opencode_auth(out), ["OpenCode Go", "OpenAI", "OpenCode Console"]);
        // The boxed style some versions print.
        assert_eq!(parse_opencode_auth("┌  Credentials ~/.local/share/opencode/auth.json\n│\n●  DeepSeek api\n│\n└  1 credentials\n"), ["DeepSeek api"]);
        assert!(parse_opencode_auth("").is_empty());
    }

    #[test]
    fn opencode_models_are_provider_slash_model_lines() {
        let out = "opencode-go/deepseek-v4-pro\nopenai/gpt-5.5-fast\ncodex-router/opencode-go/glm-5.3-flash\n\nsome warning text here\n";
        assert_eq!(parse_opencode_models(out), ["opencode-go/deepseek-v4-pro", "openai/gpt-5.5-fast", "codex-router/opencode-go/glm-5.3-flash"]);
    }

    #[test]
    fn grok_models_and_sign_in() {
        let g = parse_grok_models("You are not authenticated.\n\nDefault model: grok-4.6\n\nAvailable models:\n  * grok-4.6 (default)\n  - grok-4.5\n");
        assert!(!g.signed_in);
        assert_eq!(g.models, ["grok-4.6", "grok-4.5"]);
        assert_eq!(g.default.as_deref(), Some("grok-4.6"));
        assert!(parse_grok_models("Available models:\n  * grok-4.6 (default)\n").signed_in);
    }

    #[test]
    fn grok_failing_without_saying_why_is_not_signed_in() {
        let (status, why) = grok_status(1, "Error: couldn't reach api.x.ai\n");
        assert_eq!(status.signed_in, None);
        assert_eq!(why.as_deref(), Some("Error: couldn't reach api.x.ai"));
        assert_eq!(grok_status(1, "You are not authenticated.\n").0.signed_in, Some(false));
        assert_eq!(grok_status(0, "Available models:\n  * grok-4.6 (default)\n").0.signed_in, Some(true));
    }

    #[test]
    fn codex_login_status() {
        assert_eq!(parse_codex_login("Logged in using ChatGPT\n"), (true, Some("ChatGPT".into())));
        assert_eq!(parse_codex_login("Logged in using an API key - sk-***"), (true, Some("API key".into())));
        assert_eq!(parse_codex_login("Not logged in\n"), (false, None));
        assert_eq!(parse_codex_login(""), (false, None));
    }

    #[test]
    fn gemini_sign_in_comes_from_its_settings_and_the_credentials_file_existing() {
        let s = r#"{"security":{"auth":{"selectedType":"oauth-personal"}},"model":{"name":"gemini-4-pro"}}"#;
        let g = parse_gemini(s, true);
        assert_eq!((g.signed_in, g.auth.as_deref(), g.model.as_deref()), (Some(true), Some("Google sign-in"), Some("gemini-4-pro")));
        assert_eq!(parse_gemini(s, false).signed_in, Some(false));
        let k = parse_gemini(r#"{"security":{"auth":{"selectedType":"gemini-api-key"}}}"#, false);
        assert_eq!((k.signed_in, k.auth.as_deref()), (None, Some("API key")));
        let none = parse_gemini("", false);
        assert_eq!((none.signed_in, none.auth), (Some(false), None));
    }

    #[test]
    fn run_reads_both_streams_and_the_exit_code_without_colours() {
        let dir = std::env::temp_dir().join(format!("providers-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let fake = dir.join("fake-cli");
        std::fs::write(&fake, "#!/bin/sh\nprintf '\\033[1mLogged in\\033[0m using ChatGPT\\n'\necho warn >&2\nexit 3\n").unwrap();
        std::fs::set_permissions(&fake, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
        let (code, out) = run(fake.to_str().unwrap(), &[], &[]).unwrap();
        assert_eq!(code, 3);
        assert_eq!(out, "Logged in using ChatGPT\nwarn\n");
        std::fs::remove_dir_all(&dir).ok();
    }

    /// Real discovery on this Mac, read only: `cargo test --lib providers::tests::real -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_discovery_on_this_mac() {
        for p in discover_all() {
            println!("{:<16} installed={} signed_in={:?} auth={:?} version={:?} models={} error={:?}", p.id, p.installed, p.signed_in, p.auth, p.version, p.models.len(), p.error);
        }
    }
}
