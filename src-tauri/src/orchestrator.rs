//! `aurelia_*` tools in `aurelia-space mcp`: a Claude pane can list the other panes, read
//! their screens, send them a message, open new Claude panes on a task, and show an HTML
//! page in a browser pane. Each call is forwarded to the running app (control.rs).

use crate::control;
use serde_json::{json, Value};

pub const INSTRUCTIONS: &str = "The aurelia_* tools drive AureliaSpace, the terminal you run in. aurelia_list_panes shows the other \
panes (agents and shells) with their status; aurelia_read_pane reads one's recent output; aurelia_send_to_pane gives one a \
message (queued if that agent is busy; refused while it waits on its human); aurelia_open_pane starts a new Claude pane \
on a task, e.g. to split work and check on it later with list/read; aurelia_show_html shows the user an HTML page (a \
diagram, a report, a mockup) in a browser pane next to you. aurelia_task_add, aurelia_task_list and aurelia_task_update \
keep the shared task list for a team run: one task per slice, status todo, doing or done, attached to the worker's pane. \
aurelia_team_status shows recent team runs with their lead, workers, models, panes and merged report; aurelia_team_finish closes one with the lead's merged report.";

pub fn tools() -> Vec<Value> {
    vec![
        json!({
            "name": "aurelia_list_panes",
            "title": "List AureliaSpace panes",
            "description": "List the terminal panes open in AureliaSpace: id, title, folder, account, status (needs_input, working, done, idle, shell) and tab. Your own pane is marked self.",
            "inputSchema": { "type": "object", "properties": {} },
            "annotations": { "readOnlyHint": true }
        }),
        json!({
            "name": "aurelia_read_pane",
            "title": "Read a pane",
            "description": "Read the last lines of a pane's terminal output (its screen and recent scrollback).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pane": { "type": "string", "description": "Pane id from aurelia_list_panes" },
                    "lines": { "type": "integer", "minimum": 5, "maximum": 400, "description": "How many lines (default 80)" }
                },
                "required": ["pane"]
            },
            "annotations": { "readOnlyHint": true }
        }),
        json!({
            "name": "aurelia_send_to_pane",
            "title": "Message a pane",
            "description": "Send text to another pane and press Enter. To a Claude pane it is a prompt (queued until that agent finishes its turn if it's busy); to a shell it is a command. Refused while the pane waits on its human (a permission prompt or question).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pane": { "type": "string" },
                    "text": { "type": "string" }
                },
                "required": ["pane", "text"]
            }
        }),
        json!({
            "name": "aurelia_open_pane",
            "title": "Open a Claude pane",
            "description": "Open a new Claude pane beside yours, in a folder (default: yours) on an account (default: yours), starting on `prompt`. Returns its pane id; follow it with aurelia_list_panes / aurelia_read_pane.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "prompt": { "type": "string" },
                    "cwd": { "type": "string" },
                    "account": { "type": "string" },
                    "view": { "type": "string", "enum": ["chat", "terminal"], "description": "chat (default): Claude drawn as a conversation; terminal: Claude's own TUI" }
                },
                "required": ["prompt"]
            }
        }),
        json!({
            "name": "aurelia_show_html",
            "title": "Show an HTML page",
            "description": "Show the user a self-contained HTML page (inline CSS and JS, up to 2 MB) in a browser pane beside you: a diagram, report, table or mockup.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "html": { "type": "string" }
                },
                "required": ["html"]
            }
        }),
        json!({
            "name": "aurelia_task_add",
            "title": "Add a team task",
            "description": "Add one task to the shared task list (the project's tasks in AureliaSpace). `project` defaults to the calling pane's git root; `pane` attaches the task to the worker's pane so the board and rail show who owns it.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string" },
                    "project": { "type": "string", "description": "Project root; default the calling pane's" },
                    "pane": { "type": "string", "description": "Pane id from aurelia_list_panes" },
                    "status": { "type": "string", "enum": ["todo", "doing", "done"], "description": "Default todo" }
                },
                "required": ["title"]
            }
        }),
        json!({
            "name": "aurelia_task_list",
            "title": "List team tasks",
            "description": "List the shared task list: id, project, title, status (todo, doing, done), attached pane and when it was added. Filter by project and/or status.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "project": { "type": "string" },
                    "status": { "type": "string", "enum": ["todo", "doing", "done", "pending", "review", "completed"] }
                }
            },
            "annotations": { "readOnlyHint": true }
        }),
        json!({
            "name": "aurelia_task_update",
            "title": "Update a team task",
            "description": "Change a task's title, status (todo, doing, done; pending/review/completed are accepted aliases) or attached pane. Pass an empty pane to detach it. Returns the updated task.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "project": { "type": "string", "description": "Skip the search when known" },
                    "title": { "type": "string" },
                    "status": { "type": "string", "enum": ["todo", "doing", "done", "pending", "review", "completed"] },
                    "pane": { "type": "string" }
                },
                "required": ["id"]
            }
        }),
        json!({
            "name": "aurelia_team_status",
            "title": "Team run status",
            "description": "Recent team runs: task, status (running, done, blocked, failed), lead, workers with roles and routed models, pane ids and the merged report. Filter by run id or team id.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "run": { "type": "string", "description": "Run id from the agent view" },
                    "team": { "type": "string", "description": "Team id" }
                }
            },
            "annotations": { "readOnlyHint": true }
        }),
        json!({
            "name": "aurelia_team_finish",
            "title": "Finish a team run",
            "description": "Record the lead's merged report and close a team run: status done, blocked or failed, and the PASS/ISSUES/BLOCKED summary. The agent view shows it after the panes are gone.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "run": { "type": "string", "description": "Run id from aurelia_team_status" },
                    "status": { "type": "string", "enum": ["done", "blocked", "failed"] },
                    "summary": { "type": "string", "description": "The merged report, in the PASS/ISSUES/BLOCKED shape" }
                },
                "required": ["run", "status", "summary"]
            }
        }),
    ]
}

pub fn handles(name: &str) -> bool {
    name.starts_with("aurelia_")
}

pub fn call(name: &str, args: &Value) -> Value {
    let method = name.trim_start_matches("aurelia_");
    match control::request(method, args.clone()) {
        Ok(result) => {
            let text = match &result {
                Value::String(s) => s.clone(),
                other => serde_json::to_string_pretty(other).unwrap_or_default(),
            };
            json!({ "content": [{ "type": "text", "text": text }] })
        }
        Err(e) => json!({ "content": [{ "type": "text", "text": e }], "isError": true }),
    }
}
