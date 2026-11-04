//! OpenCode chat panes. OpenCode has no long-running headless mode like Claude Code's, so
//! each message is one `opencode run --format json` (with `--session` after the first) in the
//! pane's folder. Its events are turned into the messages Claude Code's stream sends, so the
//! chat view draws them unchanged: text and reasoning as assistant blocks, each tool call as a
//! tool_use plus its tool_result, the step usage summed into the turn's end.
//!
//! A message sent while a run is going waits and runs next, as Claude Code queues it.

use crate::chat::{ChatEvent, Outcome, Status, Usage};
use serde_json::{json, Map, Value};
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Read};
use std::os::unix::process::CommandExt;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const STDERR_TAIL: usize = 4 * 1024;

/// Claude Code's names for OpenCode's tools, so the chat's tool cards (icons, diffs) fit.
fn tool_name(t: &str) -> String {
    match t {
        "read" => "Read",
        "shell" | "bash" => "Bash",
        "edit" => "Edit",
        "write" => "Write",
        "grep" => "Grep",
        "glob" => "Glob",
        "list" => "LS",
        "webfetch" => "WebFetch",
        "websearch" => "WebSearch",
        "todowrite" => "TodoWrite",
        "task" => "Task",
        other => other,
    }
    .to_string()
}

/// OpenCode's input keys as Claude Code's (`path` is a file for read/edit/write, a folder for grep).
fn tool_input(tool: &str, input: &Value) -> Value {
    let Some(o) = input.as_object() else { return input.clone() };
    let file = matches!(tool, "read" | "edit" | "write");
    let mut out = Map::new();
    for (k, v) in o {
        let key = match k.as_str() {
            "path" | "filePath" if file => "file_path",
            "oldString" => "old_string",
            "newString" => "new_string",
            "replaceAll" => "replace_all",
            k => k,
        };
        out.insert(key.to_string(), v.clone());
    }
    Value::Object(out)
}

/// One run's events → chat events. No I/O, so it is tested on recorded lines.
#[derive(Default)]
pub(crate) struct Translate {
    /// The session id known so far; a new one is reported once.
    session: Option<String>,
    usage: Usage,
    steps: usize,
    error: Option<String>,
}

impl Translate {
    pub(crate) fn new(session: Option<String>) -> Self {
        Translate { session, ..Translate::default() }
    }

    pub(crate) fn line(&mut self, e: &Value) -> Vec<ChatEvent> {
        let mut out = vec![];
        if let Some(id) = e["sessionID"].as_str().filter(|s| !s.is_empty()) {
            if self.session.as_deref() != Some(id) {
                self.session = Some(id.to_string());
                out.push(ChatEvent::Session { id: id.to_string() });
            }
        }
        let part = &e["part"];
        let msg_id = part["messageID"].as_str().unwrap_or_default();
        let assistant = |block: Value| ChatEvent::Raw { msg: json!({ "type": "assistant", "message": { "id": msg_id, "role": "assistant", "content": [block] } }) };
        match e["type"].as_str().unwrap_or_default() {
            "text" => {
                if let Some(t) = part["text"].as_str().filter(|t| !t.trim().is_empty()) {
                    out.push(assistant(json!({ "type": "text", "text": t })));
                }
            }
            "reasoning" => {
                if let Some(t) = part["text"].as_str().filter(|t| !t.trim().is_empty()) {
                    out.push(assistant(json!({ "type": "thinking", "thinking": t })));
                }
            }
            "tool_use" => {
                let tool = part["tool"].as_str().unwrap_or("tool");
                let id = part["id"].as_str().or(part["callID"].as_str()).unwrap_or_default();
                let state = &part["state"];
                out.push(assistant(json!({ "type": "tool_use", "id": id, "name": tool_name(tool), "input": tool_input(tool, &state["input"]) })));
                let failed = state["status"] == "error";
                let result = if failed { state["error"].as_str().unwrap_or("failed") } else { state["output"].as_str().unwrap_or_default() };
                out.push(ChatEvent::Raw {
                    msg: json!({ "type": "user", "message": { "role": "user", "content": [{ "type": "tool_result", "tool_use_id": id, "content": result, "is_error": failed }] } }),
                });
            }
            "step_finish" => {
                let t = &part["tokens"];
                let n = |v: &Value| v.as_u64().unwrap_or(0);
                self.steps += 1;
                self.usage.input_tokens += n(&t["input"]);
                self.usage.output_tokens += n(&t["output"]) + n(&t["reasoning"]);
                self.usage.cache_read_tokens += n(&t["cache"]["read"]);
                self.usage.cache_write_tokens += n(&t["cache"]["write"]);
                self.usage.cost_usd += part["cost"].as_f64().unwrap_or(0.0);
                // The context is what the last step read and wrote.
                self.usage.context_tokens = Some(n(&t["input"]) + n(&t["cache"]["read"]) + n(&t["cache"]["write"]) + n(&t["output"]));
            }
            "error" => {
                let err = &e["error"];
                let text = err["message"].as_str().or(err["data"]["message"].as_str()).or(err.as_str()).unwrap_or("OpenCode reported an error");
                self.error = Some(text.to_string());
            }
            _ => {}
        }
        out
    }

    /// The turn's end, from how the run exited.
    pub(crate) fn end(self, code: Option<i32>, interrupted: bool, stderr: &str, ms: u64) -> ChatEvent {
        let usage = (self.steps > 0).then_some(self.usage);
        let (outcome, error) = if interrupted {
            (Outcome::Interrupted, None)
        } else if let Some(e) = self.error {
            (Outcome::Failed, Some(e))
        } else if code != Some(0) {
            let last = stderr.trim().lines().last().unwrap_or_default();
            (Outcome::Failed, Some(if last.is_empty() { format!("opencode exited with {code:?}") } else { last.to_string() }))
        } else {
            (Outcome::Completed, None)
        };
        ChatEvent::TurnEnd { outcome, error, usage, duration_ms: Some(ms) }
    }
}

/// A message's files, written out for `--file`: OpenCode attaches paths, not inline data.
pub(crate) struct Attachment {
    pub name: String,
    pub bytes: Vec<u8>,
}

struct Msg {
    text: String,
    files: Vec<Attachment>,
}

#[derive(Default)]
struct Runs {
    /// The running `opencode run`, also its process group.
    pid: Option<u32>,
    queue: VecDeque<Msg>,
    interrupted: bool,
    closed: bool,
}

pub(crate) struct OcChat {
    /// The command up to `run`: the login shell and the opencode binary.
    prefix: Vec<String>,
    dir: String,
    vars: Vec<(String, String)>,
    model: Mutex<Option<String>>,
    session: Mutex<Option<String>>,
    runs: Mutex<Runs>,
    emit: Box<dyn Fn(ChatEvent) + Send + Sync>,
}

impl OcChat {
    pub(crate) fn new(prefix: Vec<String>, dir: String, vars: Vec<(String, String)>, model: Option<String>, session: Option<String>, emit: Box<dyn Fn(ChatEvent) + Send + Sync>) -> Arc<Self> {
        let chat = Arc::new(OcChat { prefix, dir, vars, model: Mutex::new(model), session: Mutex::new(session), runs: Mutex::default(), emit });
        chat.report_model();
        (chat.emit)(ChatEvent::Status { status: Status::Idle });
        chat
    }

    /// The model, in the shape of Claude Code's init line, for the chat's model label.
    fn report_model(&self) {
        if let Some(m) = self.model.lock().unwrap().clone() {
            (self.emit)(ChatEvent::Raw { msg: json!({ "type": "system", "subtype": "init", "model": m }) });
        }
    }

    pub(crate) fn set_model(&self, model: Option<String>) {
        *self.model.lock().unwrap() = model.filter(|m| !m.is_empty() && m != "default");
        self.report_model();
    }

    pub(crate) fn send(self: &Arc<Self>, text: String, files: Vec<Attachment>) -> Result<(), String> {
        let mut runs = self.runs.lock().unwrap();
        if runs.closed {
            return Err("this chat was closed".into());
        }
        let msg = Msg { text, files };
        if runs.pid.is_some() {
            runs.queue.push_back(msg);
            return Ok(());
        }
        self.start(&mut runs, msg)
    }

    pub(crate) fn interrupt(&self) {
        let mut runs = self.runs.lock().unwrap();
        if let Some(pid) = runs.pid {
            runs.interrupted = true;
            unsafe {
                libc::killpg(pid as i32, libc::SIGTERM);
            }
        }
    }

    pub(crate) fn kill(&self) {
        let mut runs = self.runs.lock().unwrap();
        runs.closed = true;
        runs.queue.clear();
        if let Some(pid) = runs.pid {
            unsafe {
                libc::killpg(pid as i32, libc::SIGTERM);
            }
        }
    }

    fn argv(&self, msg: &Msg, files: &[std::path::PathBuf]) -> Vec<String> {
        let mut argv = self.prefix.clone();
        argv.extend(["run", "--format", "json", "--thinking"].map(String::from));
        if let Some(m) = self.model.lock().unwrap().as_deref() {
            argv.extend(["--model".into(), m.into()]);
        }
        if let Some(s) = self.session.lock().unwrap().as_deref() {
            argv.extend(["--session".into(), s.into()]);
        }
        for f in files {
            argv.extend(["--file".into(), f.to_string_lossy().into_owned()]);
        }
        // After `--`, a message starting with "-" is still the message.
        argv.extend(["--".into(), msg.text.clone()]);
        argv
    }

    fn start(self: &Arc<Self>, runs: &mut Runs, msg: Msg) -> Result<(), String> {
        let files = write_files(&msg.files)?;
        let argv = self.argv(&msg, &files);
        let mut child = Command::new(&argv[0])
            .args(&argv[1..])
            .current_dir(&self.dir)
            .env_clear()
            .envs(self.vars.iter().cloned())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .process_group(0)
            .spawn()
            .map_err(|e| {
                remove_files(&files);
                format!("couldn't start opencode: {e}")
            })?;
        runs.pid = Some(child.id());
        runs.interrupted = false;
        (self.emit)(ChatEvent::Status { status: Status::Working });

        let stdout = child.stdout.take().unwrap();
        let mut stderr = child.stderr.take().unwrap();
        let tail = Arc::new(Mutex::new(String::new()));
        let tail_w = tail.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = stderr.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let mut t = tail_w.lock().unwrap();
                t.push_str(&String::from_utf8_lossy(&buf[..n]));
                if t.len() > STDERR_TAIL {
                    let mut cut = t.len() - STDERR_TAIL;
                    while !t.is_char_boundary(cut) {
                        cut += 1;
                    }
                    t.drain(..cut);
                }
            }
        });

        // Lines come over a channel so the turn can end when the run exits: a process it left
        // behind, or one that inherited the pipe, may keep stdout open for much longer.
        let (lines_tx, lines) = mpsc::channel::<String>();
        std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else { break };
                if lines_tx.send(line).is_err() {
                    break;
                }
            }
        });

        let chat = self.clone();
        let started = Instant::now();
        std::thread::spawn(move || {
            let mut tr = Translate::new(chat.session.lock().unwrap().clone());
            let mut on_line = |line: String| {
                let Ok(e) = serde_json::from_str::<Value>(line.trim()) else { return };
                for ev in tr.line(&e) {
                    if let ChatEvent::Session { id } = &ev {
                        *chat.session.lock().unwrap() = Some(id.clone());
                    }
                    (chat.emit)(ev);
                }
            };
            let mut exited = None;
            loop {
                match lines.recv_timeout(Duration::from_millis(100)) {
                    Ok(line) => on_line(line),
                    Err(RecvTimeoutError::Disconnected) => break,
                    Err(RecvTimeoutError::Timeout) => {
                        if let Ok(Some(status)) = child.try_wait() {
                            exited = Some(status);
                            break;
                        }
                    }
                }
            }
            // Exited with the pipe still open: what it wrote last is read within the grace.
            if exited.is_some() {
                while let Ok(line) = lines.recv_timeout(Duration::from_millis(150)) {
                    on_line(line);
                }
            }
            let code = match exited {
                Some(s) => s.code(),
                None => child.wait().ok().and_then(|s| s.code()),
            };
            remove_files(&files);
            let mut runs = chat.runs.lock().unwrap();
            runs.pid = None;
            if runs.closed {
                return;
            }
            let stderr = std::mem::take(&mut *tail.lock().unwrap());
            (chat.emit)(tr.end(code, runs.interrupted, &stderr, started.elapsed().as_millis() as u64));
            let next = runs.queue.pop_front();
            match next {
                Some(msg) => {
                    if let Err(e) = chat.start(&mut runs, msg) {
                        (chat.emit)(ChatEvent::TurnEnd { outcome: Outcome::Failed, error: Some(e), usage: None, duration_ms: None });
                        (chat.emit)(ChatEvent::Status { status: Status::Idle });
                    }
                }
                None => (chat.emit)(ChatEvent::Status { status: Status::Idle }),
            }
        });
        Ok(())
    }
}

fn write_files(files: &[Attachment]) -> Result<Vec<std::path::PathBuf>, String> {
    if files.is_empty() {
        return Ok(vec![]);
    }
    let dir = std::env::temp_dir().join(format!("aurelia-opencode-{}", uuid_ish()));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let written: Result<Vec<_>, String> = files
        .iter()
        .enumerate()
        .map(|(i, f)| {
            // Only the file name: a name with slashes can't write outside the folder.
            let name = std::path::Path::new(&f.name).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into());
            // A folder per file, so two files with one name both arrive under that name.
            let sub = dir.join((i + 1).to_string());
            std::fs::create_dir_all(&sub).map_err(|e| e.to_string())?;
            let path = sub.join(name);
            std::fs::write(&path, &f.bytes).map(|_| path).map_err(|e| e.to_string())
        })
        .collect();
    if written.is_err() {
        let _ = std::fs::remove_dir_all(&dir);
    }
    written
}

/// The run's attachment folder (see write_files) with everything in it.
fn remove_files(files: &[std::path::PathBuf]) {
    if let Some(dir) = files.first().and_then(|f| f.parent()).and_then(|p| p.parent()) {
        let _ = std::fs::remove_dir_all(dir);
    }
}

fn uuid_ish() -> String {
    let t = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    format!("{}-{t}", std::process::id())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    const STREAM: &str = r#"{"type":"step_start","sessionID":"ses_a","part":{"messageID":"msg_1","type":"step-start"}}
{"type":"reasoning","sessionID":"ses_a","part":{"messageID":"msg_1","type":"reasoning","text":"Run ls."}}
{"type":"tool_use","sessionID":"ses_a","part":{"messageID":"msg_1","type":"tool","id":"call_1","tool":"edit","state":{"status":"completed","input":{"path":"/p/calc.py","oldString":"a - b","newString":"a + b"},"output":"Edited calc.py"}}}
{"type":"tool_use","sessionID":"ses_a","part":{"messageID":"msg_1","type":"tool","id":"call_2","tool":"shell","state":{"status":"error","input":{"command":"false"},"error":"exit 1"}}}
{"type":"step_finish","sessionID":"ses_a","part":{"type":"step-finish","cost":0.002,"tokens":{"input":100,"output":10,"reasoning":5,"cache":{"read":40,"write":0}}}}
{"type":"text","sessionID":"ses_a","part":{"messageID":"msg_2","type":"text","text":"Fixed."}}
{"type":"step_finish","sessionID":"ses_a","part":{"type":"step-finish","cost":0.001,"tokens":{"input":200,"output":3,"reasoning":0,"cache":{"read":50,"write":0}}}}"#;

    fn raws(evs: &[ChatEvent]) -> Vec<Value> {
        evs.iter().filter_map(|e| if let ChatEvent::Raw { msg } = e { Some(msg.clone()) } else { None }).collect()
    }

    #[test]
    fn a_run_reads_as_claude_messages() {
        let mut tr = Translate::new(None);
        let evs: Vec<ChatEvent> = STREAM.lines().flat_map(|l| tr.line(&serde_json::from_str(l).unwrap())).collect();
        assert_eq!(evs[0], ChatEvent::Session { id: "ses_a".into() });
        assert_eq!(evs.iter().filter(|e| matches!(e, ChatEvent::Session { .. })).count(), 1, "the session is reported once");
        let r = raws(&evs);
        assert_eq!(r[0]["message"]["content"][0], json!({ "type": "thinking", "thinking": "Run ls." }));
        assert_eq!(r[1]["message"]["content"][0], json!({ "type": "tool_use", "id": "call_1", "name": "Edit", "input": { "file_path": "/p/calc.py", "old_string": "a - b", "new_string": "a + b" } }));
        assert_eq!(r[2]["message"]["content"][0], json!({ "type": "tool_result", "tool_use_id": "call_1", "content": "Edited calc.py", "is_error": false }));
        assert_eq!(r[3]["message"]["content"][0]["name"], "Bash");
        assert_eq!(r[4]["message"]["content"][0], json!({ "type": "tool_result", "tool_use_id": "call_2", "content": "exit 1", "is_error": true }));
        assert_eq!(r[5]["message"]["content"][0], json!({ "type": "text", "text": "Fixed." }));
        assert_eq!(r[5]["message"]["id"], "msg_2");
        let ChatEvent::TurnEnd { outcome, usage: Some(u), error: None, .. } = tr.end(Some(0), false, "", 900) else { panic!("no usage") };
        assert_eq!(outcome, Outcome::Completed);
        assert_eq!((u.input_tokens, u.output_tokens, u.cache_read_tokens), (300, 18, 90));
        assert!((u.cost_usd - 0.003).abs() < 1e-9);
        assert_eq!(u.context_tokens, Some(253), "the last step's context");
    }

    #[test]
    fn attachments_with_one_name_are_all_kept_and_cleaned_up() {
        let files = write_files(&[
            Attachment { name: "notes.txt".into(), bytes: b"one".to_vec() },
            Attachment { name: "../notes.txt".into(), bytes: b"two".to_vec() },
        ])
        .unwrap();
        assert_eq!(files.len(), 2);
        assert_ne!(files[0], files[1], "the second must not overwrite the first");
        assert_eq!(std::fs::read(&files[0]).unwrap(), b"one");
        assert_eq!(std::fs::read(&files[1]).unwrap(), b"two");
        let dir = files[0].parent().unwrap().to_path_buf();
        remove_files(&files);
        assert!(!dir.exists(), "the run's temp folder goes too");
    }

    #[test]
    fn a_grep_path_stays_a_folder() {
        assert_eq!(tool_input("grep", &json!({ "pattern": "def", "path": "/p" })), json!({ "pattern": "def", "path": "/p" }));
        assert_eq!(tool_input("read", &json!({ "filePath": "/p/a" })), json!({ "file_path": "/p/a" }));
    }

    #[test]
    fn errors_and_exits_end_the_turn_as_failed() {
        let mut tr = Translate::new(Some("ses_a".into()));
        let evs = tr.line(&json!({ "type": "error", "sessionID": "ses_a", "error": { "type": "provider.no-route", "message": "Model unavailable: nope/none" } }));
        assert!(evs.is_empty(), "the same session isn't reported again");
        assert_eq!(tr.end(Some(1), false, "", 1), ChatEvent::TurnEnd { outcome: Outcome::Failed, error: Some("Model unavailable: nope/none".into()), usage: None, duration_ms: Some(1) });
        assert_eq!(Translate::new(None).end(Some(2), false, "warn\nboom\n", 1), ChatEvent::TurnEnd { outcome: Outcome::Failed, error: Some("boom".into()), usage: None, duration_ms: Some(1) });
        assert_eq!(Translate::new(None).end(None, true, "", 1), ChatEvent::TurnEnd { outcome: Outcome::Interrupted, error: None, usage: None, duration_ms: Some(1) });
    }

    /// A fake `opencode`: prints its arguments as a text event, sleeps when asked to.
    fn fake(dir: &std::path::Path) -> Vec<String> {
        let bin = dir.join("opencode");
        std::fs::write(
            &bin,
            "#!/bin/sh\nlast=''; for a in \"$@\"; do last=\"$a\"; done\nargs=$(printf '%s ' \"$@\" | sed 's/\"/\\\\\"/g')\n\
             echo \"{\\\"type\\\":\\\"text\\\",\\\"sessionID\\\":\\\"ses_f\\\",\\\"part\\\":{\\\"messageID\\\":\\\"m\\\",\\\"text\\\":\\\"$args\\\"}}\"\n\
             case \"$last\" in slow*) sleep 5;; leak*) perl -e 'setpgrp(0,0); sleep 5' & ;; esac\n",
        )
        .unwrap();
        std::fs::set_permissions(&bin, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
        vec![bin.to_string_lossy().into_owned()]
    }

    fn chat(dir: &std::path::Path) -> (Arc<OcChat>, mpsc::Receiver<ChatEvent>) {
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let path = std::env::var("PATH").unwrap_or_default();
        let c = OcChat::new(fake(dir), dir.to_string_lossy().into_owned(), vec![("PATH".into(), path)], Some("opencode-go/deepseek".into()), None, Box::new(move |e| {
            let _ = tx.lock().unwrap().send(e);
        }));
        (c, rx)
    }

    fn until_idle(rx: &mpsc::Receiver<ChatEvent>, turns: usize) -> Vec<ChatEvent> {
        let mut got = vec![];
        let mut ended = 0;
        while ended < turns {
            let e = rx.recv_timeout(Duration::from_secs(10)).expect("the turn never ended");
            if matches!(e, ChatEvent::TurnEnd { .. }) {
                ended += 1;
            }
            got.push(e);
        }
        got
    }

    #[test]
    fn messages_run_in_turn_on_one_session() {
        let dir = std::env::temp_dir().join(format!("oc-chat-queue-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (c, rx) = chat(&dir);
        c.send("first".into(), vec![]).unwrap();
        c.send("-second".into(), vec![]).unwrap();
        let evs = until_idle(&rx, 2);
        let texts: Vec<String> = raws(&evs).iter().filter(|m| m["type"] == "assistant").map(|m| m["message"]["content"][0]["text"].as_str().unwrap().to_string()).collect();
        assert_eq!(texts.len(), 2);
        assert!(texts[0].contains("--model opencode-go/deepseek") && texts[0].ends_with("-- first ") && !texts[0].contains("--session"), "{}", texts[0]);
        assert!(texts[1].contains("--session ses_f") && texts[1].ends_with("-- -second "), "the second message continues the session: {}", texts[1]);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn attachments_are_removed_when_opencode_cannot_start() {
        let dir = std::env::temp_dir().join(format!("oc-chat-nostart-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let c = OcChat::new(vec![dir.join("missing-opencode").to_string_lossy().into_owned()], dir.to_string_lossy().into_owned(), vec![], None, None, Box::new(|_| {}));
        let marker = "nostart-marker.txt";
        assert!(c.send("hi".into(), vec![Attachment { name: marker.into(), bytes: b"x".to_vec() }]).is_err());
        let prefix = format!("aurelia-opencode-{}-", std::process::id());
        let left: Vec<_> = std::fs::read_dir(std::env::temp_dir())
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().starts_with(&prefix) && e.path().join("1").join(marker).exists())
            .collect();
        assert!(left.is_empty(), "attachment folder left behind: {:?}", left.iter().map(|e| e.path()).collect::<Vec<_>>());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn a_turn_ends_when_the_run_exits_even_if_its_output_stays_open() {
        // A process the run left behind (or one that inherited the pipe) keeps stdout open.
        let dir = std::env::temp_dir().join(format!("oc-chat-leak-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (c, rx) = chat(&dir);
        let t0 = Instant::now();
        c.send("leak".into(), vec![]).unwrap();
        let evs = until_idle(&rx, 1);
        assert!(evs.iter().any(|e| matches!(e, ChatEvent::TurnEnd { outcome: Outcome::Completed, .. })), "{evs:?}");
        assert!(t0.elapsed() < Duration::from_secs(3), "ended after {:?}, when the leftover process closed the pipe", t0.elapsed());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn an_interrupt_stops_the_run() {
        let dir = std::env::temp_dir().join(format!("oc-chat-stop-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let (c, rx) = chat(&dir);
        let t0 = Instant::now();
        c.send("slow".into(), vec![]).unwrap();
        while !matches!(rx.recv_timeout(Duration::from_secs(5)).unwrap(), ChatEvent::Raw { msg } if msg["type"] == "assistant") {}
        c.interrupt();
        let evs = until_idle(&rx, 1);
        assert!(evs.iter().any(|e| matches!(e, ChatEvent::TurnEnd { outcome: Outcome::Interrupted, .. })));
        assert!(t0.elapsed() < Duration::from_secs(4), "the sleep was cut short");
        assert_eq!(rx.recv_timeout(Duration::from_secs(2)).unwrap(), ChatEvent::Status { status: Status::Idle });
        std::fs::remove_dir_all(&dir).ok();
    }

    /// The real CLI: two messages in one session, the second needing the first. Spends a
    /// fraction of a cent on OpenCode Go. `cargo test --lib real_opencode -- --ignored`
    #[test]
    #[ignore]
    fn real_opencode_chat_on_this_mac() {
        let dir = std::env::temp_dir().join(format!("oc-chat-real-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("calc.py"), "def add(a, b):\n    return a - b\n").unwrap();
        let (tx, rx) = mpsc::channel();
        let tx = Mutex::new(tx);
        let cfg = crate::config::load();
        let bin = crate::which::locate("opencode").expect("opencode on PATH").to_string_lossy().into_owned();
        let prefix = vec![crate::pty::default_shell(&cfg), "-l".into(), "-c".into(), "exec \"$0\" \"$@\"".into(), bin];
        let vars: Vec<(String, String)> = std::env::vars().collect();
        let c = OcChat::new(prefix, dir.to_string_lossy().into_owned(), vars, Some("opencode-go/deepseek-v4.1-flash".into()), None, Box::new(move |e| {
            let _ = tx.lock().unwrap().send(e);
        }));
        c.send("Read calc.py. What does add(2, 3) return? Answer with the number only.".into(), vec![]).unwrap();
        c.send("Now fix add so it adds, and say done.".into(), vec![]).unwrap();
        let mut got = vec![];
        let mut ended = 0;
        while ended < 2 {
            let e = rx.recv_timeout(Duration::from_secs(180)).expect("a turn never ended");
            if matches!(e, ChatEvent::TurnEnd { .. }) {
                ended += 1;
            }
            got.push(e);
        }
        let sessions = got.iter().filter(|e| matches!(e, ChatEvent::Session { .. })).count();
        let ends: Vec<_> = got.iter().filter(|e| matches!(e, ChatEvent::TurnEnd { .. })).collect();
        let tools: Vec<String> = raws(&got).iter().filter_map(|m| m["message"]["content"][0]["name"].as_str().map(String::from)).collect();
        println!("tools {tools:?}\nends {ends:?}");
        assert_eq!(sessions, 1, "both messages ran in one session");
        assert!(ends.iter().all(|e| matches!(e, ChatEvent::TurnEnd { outcome: Outcome::Completed, usage: Some(_), .. })), "{ends:?}");
        assert!(tools.contains(&"Read".to_string()), "{tools:?}");
        assert!(std::fs::read_to_string(dir.join("calc.py")).unwrap().contains("a + b"), "the second turn fixed the file");
        std::fs::remove_dir_all(&dir).ok();
    }
}
