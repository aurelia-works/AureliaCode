//! `aurelia_delegate` and `aurelia_delegation` in `aurelia-space mcp`: a Claude pane hands a
//! task to another agent CLI and either waits for its report or carries on and checks later.
//! Backends: `opencode run` (any OpenCode model, DeepSeek on the Go plan by default),
//! `claude -p` (Sonnet or Haiku on this pane's account) and `grok -p`. No Codex, no Gemini.
//!
//! Runs live in this MCP server process, which lives as long as the pane's `claude`: the
//! registry is per pane, and a pane that closes stops its runs (subagents::serve).

use crate::subagents::{self, command as opencode_command, render, run_job, stop, Job, Kind, Mode, Outcome, Running};
use crate::{config, which};
use serde_json::{json, Value};
use std::os::unix::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, LazyLock, Mutex};
use std::time::{Duration, Instant};

pub const INSTRUCTIONS: &str = "aurelia_delegate hands one self-contained task to another agent: provider \"opencode\" \
(DeepSeek by default, or any OpenCode model), \"claude\" (Sonnet or Haiku, this account) or \"grok\". With wait false it \
returns an id at once and the agent works in the background; check it with aurelia_delegation (status, wait, cancel). \
The agent knows nothing of this conversation: name the files, the constraints and what to report. Mode read (default) \
only reads; work may edit files and run commands (destructive git and rm -rf are blocked). Review a work agent's changes.";

const PROVIDERS: [&str; 3] = ["opencode", "claude", "grok"];
const MAX_WAIT: u64 = 1800;

pub fn tools() -> Vec<Value> {
    vec![
        json!({
            "name": "aurelia_delegate",
            "title": "Delegate to another agent",
            "description": "Run another agent CLI on one self-contained task in this folder. provider: opencode (default model from Settings → Subagents, usually DeepSeek), claude (sonnet or haiku on this account; never opus) or grok. wait true (default) returns its report; wait false returns an id at once, to follow with aurelia_delegation. The report ends with a footer line: agent, model, mode, tool calls, time, session, files changed.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "provider": { "type": "string", "enum": PROVIDERS },
                    "model": { "type": "string", "description": "opencode: provider/model as `opencode models` lists it. claude: sonnet or haiku. grok: grok-4.6 etc. Omit for the default." },
                    "task": { "type": "string", "description": "The task, with the files to look at and what to return." },
                    "context": { "type": "string", "description": "Background the agent needs: decisions, constraints." },
                    "mode": { "type": "string", "enum": ["read", "work"], "description": "read (default): read and search only. work: may edit files and run commands." },
                    "wait": { "type": "boolean", "description": "true (default): wait for the report. false: return an id now." },
                    "session": { "type": "string", "description": "Session id from an earlier report of the same provider, to continue that agent." }
                },
                "required": ["provider", "task"]
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "openWorldHint": true }
        }),
        json!({
            "name": "aurelia_delegation",
            "title": "Check a delegated agent",
            "description": "Follow agents started by aurelia_delegate. status: how each run (or the one `id`) is doing, or its report once done. wait: block until `id` finishes or `seconds` pass (default 300, at most 1800). cancel: stop `id` and everything it started.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["status", "wait", "cancel"] },
                    "id": { "type": "string", "description": "The id aurelia_delegate returned. Optional for status." },
                    "seconds": { "type": "integer", "minimum": 1, "maximum": MAX_WAIT }
                },
                "required": ["action"]
            },
            "annotations": { "readOnlyHint": false }
        }),
    ]
}

pub fn handles(name: &str) -> bool {
    matches!(name, "aurelia_delegate" | "aurelia_delegation")
}

#[derive(Debug, PartialEq)]
struct Request {
    provider: &'static str,
    model: String,
    task: String,
    context: Option<String>,
    mode: Mode,
    wait: bool,
    session: Option<String>,
}

/// The arguments, checked; `default_model` is the OpenCode model from Settings → Subagents.
fn parse(args: &Value, default_model: &str) -> Result<Request, String> {
    let provider = match args["provider"].as_str().unwrap_or("") {
        "opencode" => "opencode",
        "claude" => "claude",
        "grok" => "grok",
        "codex" => return Err("Codex isn't a delegation backend here; use opencode, claude or grok.".into()),
        other => return Err(format!("unknown provider {other:?}; use opencode, claude or grok")),
    };
    let task = args["task"].as_str().map(str::trim).filter(|t| !t.is_empty()).ok_or("`task` must say what the agent should do")?;
    let mode = match args["mode"].as_str().unwrap_or("read") {
        "read" => Mode::Read,
        "work" | "write" => Mode::Write,
        other => return Err(format!("unknown mode {other:?}; use \"read\" or \"work\"")),
    };
    let model = args["model"].as_str().map(str::trim).filter(|m| !m.is_empty());
    let model = match (provider, model) {
        (_, Some(m)) if m.to_ascii_lowercase().contains("opus") => return Err("Delegated agents are for cheaper models; Opus isn't one of them.".into()),
        (_, Some(m)) if !m.chars().all(|c| c.is_ascii_alphanumeric() || "/._-#:".contains(c)) => return Err(format!("{m:?} isn't a model id")),
        (_, Some(m)) => m.to_string(),
        ("opencode", None) if !default_model.trim().is_empty() => default_model.trim().to_string(),
        ("opencode", None) => return Err("No OpenCode model set (Settings → Subagents); pass `model`.".into()),
        ("claude", None) => "sonnet".into(),
        (_, None) => String::new(),
    };
    let session = args["session"].as_str().map(str::trim).filter(|s| !s.is_empty());
    if let Some(s) = session {
        if !s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
            return Err("`session` must be a session id from an earlier report".into());
        }
    }
    Ok(Request {
        provider,
        model,
        task: task.to_string(),
        context: args["context"].as_str().map(str::trim).filter(|c| !c.is_empty()).map(String::from),
        mode,
        wait: args["wait"].as_bool().unwrap_or(true),
        session: session.map(String::from),
    })
}

/// Shell commands a work agent may never run, as each CLI writes its deny rules.
const DENIED: [&str; 8] = ["git push", "git reset --hard", "git clean", "git checkout --", "git restore", "rm -rf", "rm -fr", "sudo"];

/// The command for one run. `bin` is the provider's CLI.
fn build(bin: &std::path::Path, r: &Request, cwd: &str) -> Command {
    let job = Job { tasks: vec![r.task.clone()], context: r.context.clone(), mode: r.mode, files: vec![], effort: None, session: r.session.clone() };
    if r.provider == "opencode" {
        return opencode_command(bin, &r.model, &job, cwd);
    }
    let mut cmd = Command::new(bin);
    let prompt = subagents::prompt(&job, cwd);
    match r.provider {
        "claude" => {
            cmd.args(["-p", &prompt, "--output-format", "stream-json", "--verbose", "--strict-mcp-config", "--model", &r.model]);
            if let Some(s) = &r.session {
                cmd.args(["--resume", s]);
            }
            match r.mode {
                // Read tools run without asking; anything else would need a human, so it's refused.
                Mode::Read => cmd.args(["--permission-mode", "default", "--disallowedTools", "Edit,Write,MultiEdit,NotebookEdit,Bash"]),
                Mode::Write => {
                    let deny: Vec<String> = DENIED.iter().map(|d| format!("Bash({d}:*)")).collect();
                    cmd.args(["--permission-mode", "acceptEdits", "--allowedTools", "Bash", "--disallowedTools", &deny.join(",")])
                }
            };
            // A nested `claude` refuses to start inside another's session markers; the
            // account (CLAUDE_CONFIG_DIR) stays the pane's.
            cmd.env_remove("CLAUDECODE").env_remove("CLAUDE_CODE_ENTRYPOINT");
        }
        _ => {
            cmd.args(["-p", &prompt, "--output-format", "streaming-json", "--cwd", cwd, "--no-auto-update", "--max-turns", "60"]);
            if !r.model.is_empty() {
                cmd.args(["-m", &r.model]);
            }
            if let Some(s) = &r.session {
                cmd.args(["-r", s]);
            }
            match r.mode {
                Mode::Read => cmd.args(["--deny", "Edit", "--deny", "Write", "--deny", "Bash"]),
                Mode::Write => {
                    cmd.args(["--allow", "Edit", "--allow", "Write", "--allow", "Bash"]);
                    for d in DENIED {
                        cmd.args(["--deny", &format!("Bash({d}*)")]);
                    }
                    &mut cmd
                }
            };
        }
    }
    cmd.current_dir(cwd)
        .env("PWD", cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);
    cmd
}

fn who(provider: &str, model: &str) -> &'static str {
    match provider {
        "opencode" if model.contains("deepseek") => "DeepSeek",
        "opencode" => "OpenCode",
        "claude" => "Claude",
        _ => "Grok",
    }
}

/// One delegated run.
struct Run {
    id: String,
    provider: &'static str,
    model: String,
    mode: Mode,
    title: String,
    started: Instant,
    tools: AtomicUsize,
    last: Mutex<String>,
    /// Where its process is registered in `running`: the MCP request id for a waiting call,
    /// else the run id.
    key: String,
    /// Set by aurelia_delegation cancel before it stops the process.
    cancelled: AtomicBool,
    /// The rendered report and whether it failed, once the run ends.
    done: Mutex<Option<(String, bool)>>,
    finished: Condvar,
}

impl Run {
    /// Renders the finished run's report. A cancelled run was killed by us, so it says
    /// "cancelled" rather than that the program failed.
    fn settle(&self, mut o: Outcome) {
        let cancelled = self.cancelled.load(Ordering::Relaxed);
        if cancelled {
            o.exit_ok = true;
            o.stderr.clear();
        }
        let model = if self.model.is_empty() { "default" } else { &self.model };
        let (mut report, failed) = render(&o, who(self.provider, &self.model), model, self.mode);
        if cancelled {
            report.push_str("\nStopped: cancelled.");
        }
        report.push_str(&format!("\nDelegation {}", self.id));
        self.finish(report, failed || cancelled);
    }

    fn finish(&self, report: String, failed: bool) {
        *self.done.lock().unwrap() = Some((report, failed));
        self.finished.notify_all();
    }

    /// Waits up to `limit`; the report once the run ended.
    fn wait(&self, limit: Duration) -> Option<(String, bool)> {
        let done = self.done.lock().unwrap();
        let (done, _) = self.finished.wait_timeout_while(done, limit, |d| d.is_none()).unwrap();
        done.clone()
    }

    fn line(&self) -> String {
        let mode = if self.mode == Mode::Write { "work" } else { "read" };
        let model = if self.model.is_empty() { "default model".to_string() } else { self.model.clone() };
        let head = format!("{} · {} agent · {model} · {mode} · {}", self.id, who(self.provider, &self.model), self.title);
        match &*self.done.lock().unwrap() {
            Some((_, failed)) => format!("{head} · {}", if *failed { "failed" } else { "done" }),
            None => {
                let last = self.last.lock().unwrap();
                let now = if last.is_empty() { String::new() } else { format!(" · now: {last}") };
                format!("{head} · running {}s · {} tool calls{now}", self.started.elapsed().as_secs(), self.tools.load(Ordering::Relaxed))
            }
        }
    }
}

static RUNS: LazyLock<Mutex<Vec<Arc<Run>>>> = LazyLock::new(Default::default);
static NEXT: AtomicUsize = AtomicUsize::new(1);

fn find(id: &str) -> Option<Arc<Run>> {
    RUNS.lock().unwrap().iter().find(|r| r.id == id).cloned()
}

fn text(t: String, is_error: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": t }], "isError": is_error })
}

/// Handles both tools. `key` is the MCP request id: cancelling a waiting call stops its run.
pub fn call(name: &str, args: &Value, key: &str, running: &Running, progress: &(dyn Fn(usize, &str) + Sync)) -> Value {
    if name == "aurelia_delegation" {
        return follow(args, running);
    }
    let cfg = config::load().subagents;
    let req = match parse(args, &cfg.model) {
        Ok(r) => r,
        Err(e) => return text(e, true),
    };
    let Some(bin) = locate(req.provider) else {
        return text(format!("{} isn't installed on this Mac.", req.provider), true);
    };
    let cwd = std::env::current_dir().map(|d| d.to_string_lossy().into_owned()).unwrap_or_else(|_| ".".into());
    let id = format!("d{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let run = Arc::new(Run {
        id: id.clone(),
        // A waiting call is cancelled through its request id; a background run through its own id.
        key: if req.wait { key.to_string() } else { id.clone() },
        provider: req.provider,
        model: req.model.clone(),
        mode: req.mode,
        title: req.task.lines().next().unwrap_or("").chars().take(60).collect(),
        started: Instant::now(),
        tools: AtomicUsize::new(0),
        last: Mutex::new(String::new()),
        cancelled: AtomicBool::new(false),
        done: Mutex::new(None),
        finished: Condvar::new(),
    });
    RUNS.lock().unwrap().push(run.clone());
    let limit = Duration::from_secs(cfg.timeout_minutes.max(1) * 60);
    let kind = match req.provider {
        "opencode" => Kind::OpenCode,
        "claude" => Kind::Claude,
        _ => Kind::Grok,
    };
    let cmd = build(&bin, &req, &cwd);
    let run_key = run.key.clone();
    let execute = {
        let (run, running) = (run.clone(), running.clone());
        move |progress: &dyn Fn(usize, &str)| {
            let result = run_job(cmd, kind, &cwd, limit, &run_key, &running, |n, note| {
                run.tools.store(n, Ordering::Relaxed);
                *run.last.lock().unwrap() = note.to_string();
                progress(n, note);
            });
            match result {
                Ok(o) => run.settle(o),
                Err(e) => run.finish(e, true),
            }
        }
    };
    if req.wait {
        execute(progress);
        let (report, failed) = run.done.lock().unwrap().clone().unwrap_or_default();
        return text(report, failed);
    }
    std::thread::spawn(move || execute(&|_, _| {}));
    text(format!("Started {id}: {} agent on \"{}\". Check it with aurelia_delegation (status, wait or cancel) and id {id}.", who(run.provider, &run.model), run.title), false)
}

fn locate(provider: &str) -> Option<PathBuf> {
    which::locate(provider)
}

fn follow(args: &Value, running: &Running) -> Value {
    let id = args["id"].as_str().map(str::trim).filter(|s| !s.is_empty());
    let action = args["action"].as_str().unwrap_or("status");
    if action == "status" && id.is_none() {
        let runs = RUNS.lock().unwrap().clone();
        if runs.is_empty() {
            return text("No delegated runs in this chat yet.".into(), false);
        }
        return text(runs.iter().map(|r| r.line()).collect::<Vec<_>>().join("\n"), false);
    }
    let Some(id) = id else { return text(format!("{action} needs the run's `id`"), true) };
    let Some(run) = find(id) else { return text(format!("No delegated run {id} in this chat."), true) };
    match action {
        "status" => match run.wait(Duration::ZERO) {
            Some((report, failed)) => text(report, failed),
            None => text(run.line(), false),
        },
        "wait" => {
            let secs = args["seconds"].as_u64().unwrap_or(300).clamp(1, MAX_WAIT);
            match run.wait(Duration::from_secs(secs)) {
                Some((report, failed)) => text(report, failed),
                None => text(format!("Still running after {secs}s: {}", run.line()), false),
            }
        }
        "cancel" => {
            if run.wait(Duration::ZERO).is_some() {
                return text(format!("{id} had already finished."), false);
            }
            run.cancelled.store(true, Ordering::Relaxed);
            if let Some(child) = running.lock().unwrap().get(&run.key) {
                stop(&mut child.lock().unwrap());
            }
            match run.wait(Duration::from_secs(10)) {
                Some((report, _)) => text(format!("Cancelled {id}.\n\n{report}"), false),
                None => text(format!("Asked {id} to stop; it hasn't ended yet."), true),
            }
        }
        other => text(format!("unknown action {other:?}; use status, wait or cancel"), true),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn req(args: Value) -> Result<Request, String> {
        parse(&args, "opencode-go/deepseek-v4.1-flash")
    }

    #[test]
    fn providers_models_and_modes_are_checked() {
        let r = req(json!({ "provider": "opencode", "task": "  look at a.rs  " })).unwrap();
        assert_eq!((r.model.as_str(), r.task.as_str(), r.mode, r.wait), ("opencode-go/deepseek-v4.1-flash", "look at a.rs", Mode::Read, true));
        assert_eq!(req(json!({ "provider": "claude", "task": "t" })).unwrap().model, "sonnet");
        assert_eq!(req(json!({ "provider": "grok", "task": "t", "mode": "work", "wait": false })).unwrap().mode, Mode::Write);
        assert!(req(json!({ "provider": "claude", "task": "t", "model": "claude-opus-5-5" })).unwrap_err().contains("Opus"));
        assert!(req(json!({ "provider": "codex", "task": "t" })).unwrap_err().contains("Codex"));
        assert!(req(json!({ "provider": "gemini", "task": "t" })).is_err());
        assert!(req(json!({ "provider": "opencode", "task": " " })).is_err());
        assert!(req(json!({ "provider": "opencode", "task": "t", "model": "x; rm -rf /" })).is_err());
        assert!(req(json!({ "provider": "opencode", "task": "t", "session": "../x" })).is_err());
        assert!(parse(&json!({ "provider": "opencode", "task": "t" }), "").unwrap_err().contains("Settings"));
    }

    fn args_of(cmd: &Command) -> Vec<String> {
        cmd.get_args().map(|a| a.to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn claude_reads_by_default_and_works_with_destructive_commands_denied() {
        let read = build(std::path::Path::new("/bin/claude"), &req(json!({ "provider": "claude", "task": "t", "model": "haiku" })).unwrap(), "/w");
        let a = args_of(&read);
        assert!(a.windows(2).any(|w| w == ["--model", "haiku"]) && a.contains(&"--strict-mcp-config".to_string()));
        assert!(a.windows(2).any(|w| w[0] == "--disallowedTools" && w[1].contains("Edit") && w[1].contains("Bash")), "{a:?}");
        let work = build(std::path::Path::new("/bin/claude"), &req(json!({ "provider": "claude", "task": "t", "mode": "work", "session": "abc-1" })).unwrap(), "/w");
        let a = args_of(&work);
        assert!(a.windows(2).any(|w| w == ["--permission-mode", "acceptEdits"]) && a.windows(2).any(|w| w == ["--resume", "abc-1"]));
        assert!(a.windows(2).any(|w| w[0] == "--disallowedTools" && w[1].contains("Bash(git push:*)") && w[1].contains("Bash(rm -rf:*)")), "{a:?}");
        assert!(work.get_envs().any(|(k, v)| k == std::ffi::OsStr::new("CLAUDECODE") && v.is_none()));
    }

    #[test]
    fn grok_gets_its_folder_and_deny_rules() {
        let a = args_of(&build(std::path::Path::new("/bin/grok"), &req(json!({ "provider": "grok", "task": "t", "mode": "work" })).unwrap(), "/w"));
        assert!(a.windows(2).any(|w| w == ["--cwd", "/w"]) && a.windows(2).any(|w| w == ["--output-format", "streaming-json"]));
        assert!(a.windows(2).any(|w| w == ["--deny", "Bash(git push*)"]) && !a.contains(&"-m".to_string()));
        let a = args_of(&build(std::path::Path::new("/bin/grok"), &req(json!({ "provider": "grok", "task": "t" })).unwrap(), "/w"));
        assert!(a.windows(2).any(|w| w == ["--deny", "Bash"]));
    }

    fn fake(name: &str, body: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("delegate-{name}-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bin = dir.join(name);
        std::fs::write(&bin, format!("#!/bin/sh\n{body}\n")).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        bin
    }

    fn run_with(bin: &PathBuf, kind: Kind, key: &str, running: &Running, limit: Duration) -> subagents::Outcome {
        let mut cmd = Command::new(bin);
        cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).process_group(0);
        run_job(cmd, kind, "/w", limit, key, running, |_, _| {}).unwrap()
    }

    #[test]
    fn a_fake_claude_run_reports_its_answer_and_changed_files() {
        let lines = [
            r#"{"type":"system","subtype":"init","session_id":"s-1"}"#,
            r#"{"type":"assistant","message":{"id":"m1","content":[{"type":"text","text":"Fixing it."},{"type":"tool_use","id":"t1","name":"Edit","input":{"file_path":"/w/a.rs"}},{"type":"tool_use","id":"t2","name":"Write","input":{"file_path":"/w/b.rs"}}]}}"#,
            r#"{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"t1","content":"ok"},{"type":"tool_result","tool_use_id":"t2","is_error":true,"content":"denied"}]}}"#,
            r#"{"type":"result","subtype":"success","is_error":false,"result":"Fixed a.rs:3.","permission_denials":[{"tool_name":"Bash","tool_input":{"command":"git push"}}]}"#,
        ];
        let body = lines.iter().map(|l| format!("printf '%s\\n' '{l}'")).collect::<Vec<_>>().join("\n");
        let o = run_with(&fake("claude", &body), Kind::Claude, "c", &Running::default(), Duration::from_secs(10));
        assert_eq!(o.report.text, "Fixed a.rs:3.");
        assert_eq!(o.report.session.as_deref(), Some("s-1"));
        assert_eq!((o.report.tools, o.report.changed.clone()), (2, vec!["a.rs".to_string()]));
        assert_eq!(o.report.blocked, ["Bash git push"]);
        let (text, failed) = render(&o, "Claude", "haiku", Mode::Write);
        assert!(!failed && text.contains("Claude agent · haiku · write · 2 tool calls") && text.contains("Changed: a.rs"), "{text}");
    }

    #[test]
    fn a_fake_grok_run_keeps_the_last_response_and_its_session() {
        let lines = [
            r#"{"type":"text","data":"Let me look."}"#,
            r#"{"type":"usage","messageId":"r1","stopReason":"tool_use"}"#,
            r#"{"type":"tool_call","toolCallId":"c1","toolName":"search_replace","kind":"edit","status":"in_progress","rawInput":{"path":"/w/x.py"}}"#,
            r#"{"type":"tool_call_update","toolCallId":"c1","status":"completed"}"#,
            r#"{"type":"text","data":"Done: "}"#,
            r#"{"type":"text","data":"x.py:2 fixed."}"#,
            r#"{"type":"usage","messageId":"r2","stopReason":"end_turn"}"#,
            r#"{"type":"end","stopReason":"end_turn","sessionId":"g-9"}"#,
        ];
        let body = lines.iter().map(|l| format!("printf '%s\\n' '{l}'")).collect::<Vec<_>>().join("\n");
        let o = run_with(&fake("grok", &body), Kind::Grok, "g", &Running::default(), Duration::from_secs(10));
        assert_eq!(o.report.text, "Done: x.py:2 fixed.");
        assert_eq!((o.report.session.as_deref(), o.report.changed.clone(), o.report.error.clone()), (Some("g-9"), vec!["x.py".to_string()], None));
        let mut r = subagents::Report::new(Kind::Grok, "/w");
        r.fold(r#"{"type":"error","message":"You are not authenticated."}"#);
        assert_eq!(r.error.as_deref(), Some("You are not authenticated."));
    }

    /// Runs the real `claude` (Haiku, read mode) in a scratch folder with a planted bug and
    /// prints the report. Manual: `cargo test --lib delegate::tests::real -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn real_claude_read_run_on_this_mac() {
        let dir = std::env::temp_dir().join(format!("delegate-real-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("calc.py"), "def add(a, b):\n    return a - b\n").unwrap();
        let req = parse(&json!({ "provider": "claude", "model": "haiku", "mode": "read",
            "task": "Read calc.py and say in one line what add(2, 3) returns. Then fix it." }), "").unwrap();
        let cwd = dir.to_string_lossy().into_owned();
        let cmd = build(&locate("claude").expect("claude isn't installed"), &req, &cwd);
        let o = run_job(cmd, Kind::Claude, &cwd, Duration::from_secs(300), "real", &Running::default(), |_, _| {}).unwrap();
        let (report, failed) = render(&o, "Claude", "haiku", Mode::Read);
        println!("{report}\nfailed: {failed}");
        assert!(!failed && report.contains("-1"), "{report}");
        assert_eq!(std::fs::read_to_string(dir.join("calc.py")).unwrap(), "def add(a, b):\n    return a - b\n", "read mode edited the file");
    }

    #[test]
    fn a_waiting_run_can_be_cancelled_by_its_id() {
        let running = Running::default();
        let bin = fake("slow-wait", "sleep 30");
        let run = Arc::new(Run {
            id: "d901".into(),
            key: "request-7".into(),
            provider: "opencode",
            model: String::new(),
            mode: Mode::Read,
            title: "waited task".into(),
            started: Instant::now(),
            tools: AtomicUsize::new(0),
            last: Mutex::new(String::new()),
            cancelled: AtomicBool::new(false),
            done: Mutex::new(None),
            finished: Condvar::new(),
        });
        RUNS.lock().unwrap().push(run.clone());
        let (r2, running2) = (run.clone(), running.clone());
        std::thread::spawn(move || r2.settle(run_with(&bin, Kind::OpenCode, "request-7", &running2, Duration::from_secs(60))));
        let started = Instant::now();
        while !running.lock().unwrap().contains_key("request-7") {
            assert!(started.elapsed() < Duration::from_secs(5), "never started");
            std::thread::yield_now();
        }
        let cancelled = follow(&json!({ "action": "cancel", "id": "d901" }), &running);
        let t = cancelled["content"][0]["text"].as_str().unwrap();
        assert!(t.starts_with("Cancelled d901.") && t.contains("Stopped: cancelled."), "{t}");
        assert!(started.elapsed() < Duration::from_secs(8), "cancel didn't stop the process");
    }

    #[test]
    fn a_background_run_can_be_followed_and_cancelled() {
        let running = Running::default();
        let bin = fake("slow", r#"printf '%s\n' '{"type":"text","sessionID":"s","part":{"messageID":"m","text":"partial"}}'; sleep 30"#);
        let run = Arc::new(Run {
            id: "d900".into(),
            key: "d900".into(),
            provider: "opencode",
            model: "opencode-go/deepseek-v4.1-flash".into(),
            mode: Mode::Read,
            title: "slow task".into(),
            started: Instant::now(),
            tools: AtomicUsize::new(0),
            last: Mutex::new(String::new()),
            cancelled: AtomicBool::new(false),
            done: Mutex::new(None),
            finished: Condvar::new(),
        });
        RUNS.lock().unwrap().push(run.clone());
        let (r2, running2) = (run.clone(), running.clone());
        std::thread::spawn(move || {
            r2.settle(run_with(&bin, Kind::OpenCode, "d900", &running2, Duration::from_secs(60)));
        });
        let started = Instant::now();
        while !running.lock().unwrap().contains_key("d900") {
            assert!(started.elapsed() < Duration::from_secs(5), "never started");
            std::thread::yield_now();
        }
        let status = follow(&json!({ "action": "status", "id": "d900" }), &running);
        assert!(status["content"][0]["text"].as_str().unwrap().contains("running"), "{status}");
        let waited = follow(&json!({ "action": "wait", "id": "d900", "seconds": 1 }), &running);
        assert!(waited["content"][0]["text"].as_str().unwrap().starts_with("Still running after 1s"), "{waited}");
        let cancelled = follow(&json!({ "action": "cancel", "id": "d900" }), &running);
        let t = cancelled["content"][0]["text"].as_str().unwrap();
        assert!(t.starts_with("Cancelled d900.") && t.contains("partial"), "{t}");
        assert!(t.contains("\nStopped: cancelled.") && !t.contains("exited with an error"), "{t}");
        assert!(started.elapsed() < Duration::from_secs(20), "cancel didn't stop the sleep");
        assert!(follow(&json!({ "action": "status" }), &running)["content"][0]["text"].as_str().unwrap().contains("d900"));
        assert_eq!(follow(&json!({ "action": "wait", "id": "nope" }), &running)["isError"], true);
    }
}
