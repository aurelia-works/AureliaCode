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
aurelia_team_status shows recent team runs with their lead, workers, models, panes and merged report; aurelia_team_finish closes one with the lead's merged report. \
aurelia_browser drives the browser pane beside you: open a url, snapshot the page (elements with refs), act on a ref, wait, \
resize the viewport, inspect an element's box and styles, and screenshot the page alone. aurelia_computer controls the desktop \
itself (screen points, mouse, keyboard) and is only for native apps; use aurelia_browser for web pages. It is off unless the \
human enables Computer use in Settings, and every action is logged.";

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
            "description": "Show the user a self-contained HTML page (inline CSS and JS, up to 2 MB): a diagram, chart, report, table or mockup. In a chat it appears as a card in the thread, in the app's theme (CSS variables such as --bg, --surface, --text, --text-dim, --accent, --ok, --err, --font-ui are set; use them so it follows light and dark); in a terminal it opens in a browser pane beside you. Scripts run, sandboxed away from the app.",
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
        json!({
            "name": "aurelia_browser",
            "title": "Drive the browser pane",
            "description": "Check a page in the browser pane beside you. Use when the task asks for browser work or checking a UI change. Loop: open → snapshot → act/inspect → screenshot. \
open: `url` (reuses your tab's browser pane, else splits one). snapshot: text tree of the page, each element with a ref like e12; refs stay valid until the page navigates; `ref`/`selector` limits it to one part; caps at 20 KB. \
act: `kind` click (default), type (`text`, `clear`), press (`key`, `modifiers`), hover, select (`value`), scroll (`dx`/`dy`, or a ref to scroll into view), on a `ref` or `selector`. Events are synthetic. \
wait: for `selector` or `text` to appear (`gone`: disappear), or with neither for load + quiet DOM; `timeoutMs` up to 15000. \
resize: emulate a `width`x`height` viewport (wider than the pane zooms out); `reset` returns to the pane size. \
inspect: a ref's box, visibility, what covers it, ancestors clipping it, text overflow and key computed styles. \
screenshot: PNG of the page alone (no windows on top), or of one `ref`; returned as an image and saved to a file.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": crate::browser_agent::ACTIONS },
                    "pane": { "type": "string", "description": "Browser pane id; default the one in your tab" },
                    "url": { "type": "string" },
                    "ref": { "type": "string", "description": "Element ref from snapshot, e.g. e12" },
                    "selector": { "type": "string", "description": "CSS selector, when there is no ref" },
                    "kind": { "type": "string", "enum": ["click", "type", "press", "hover", "select", "scroll"] },
                    "text": { "type": "string" },
                    "clear": { "type": "boolean" },
                    "key": { "type": "string" },
                    "modifiers": { "type": "array", "items": { "type": "string", "enum": ["Shift", "Meta", "Control", "Alt"] } },
                    "value": { "type": "string" },
                    "dx": { "type": "number" },
                    "dy": { "type": "number" },
                    "gone": { "type": "boolean" },
                    "timeoutMs": { "type": "integer", "minimum": 0, "maximum": 15000 },
                    "width": { "type": "number" },
                    "height": { "type": "number" },
                    "reset": { "type": "boolean" }
                },
                "required": ["action"]
            }
        }),
        json!({
            "name": "aurelia_computer",
            "title": "Control the desktop",
            "description": "Full desktop computer use: screenshots, mouse and keyboard for any macOS app. This is NOT the browser pane; use aurelia_browser for web pages and their DOM. Off unless Settings → Advanced & Labs → Computer use is on, and blocked while macOS Accessibility, Screen Recording or secure input stops it. Loop: screenshot → act → look at the returned screenshot and verify. Coordinates are screen points. Quit and force-quit keys are blocked. Every action is logged.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "action": { "type": "string", "enum": ["status", "screenshot", "move", "click", "doubleClick", "rightClick", "type", "key", "scroll"] },
                    "x": { "type": "number", "description": "Screen x in points, for move/click/scroll" },
                    "y": { "type": "number", "description": "Screen y in points, for move/click/scroll" },
                    "text": { "type": "string", "description": "Text to type; at most 4000 characters" },
                    "key": { "type": "string", "description": "Key name: a letter, digit, Return, Tab, Escape, Delete, arrow, Home, End, PageUp, PageDown" },
                    "modifiers": { "type": "array", "items": { "type": "string", "enum": ["Shift", "Control", "Alt", "Meta"] } },
                    "clickCount": { "type": "integer", "minimum": 1, "maximum": 3 },
                    "dx": { "type": "number" },
                    "dy": { "type": "number" },
                    "verify": { "type": "boolean", "description": "Take a screenshot after the action (default true)" }
                },
                "required": ["action"]
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": true, "openWorldHint": true }
        }),
    ]
}

pub fn handles(name: &str) -> bool {
    name.starts_with("aurelia_")
}

pub fn call(name: &str, args: &Value) -> Value {
    let method = name.trim_start_matches("aurelia_");
    match control::request(method, args.clone()) {
        Ok(result) => content(&result),
        Err(e) => json!({ "content": [{ "type": "text", "text": e }], "isError": true }),
    }
}

/// The MCP result for a tool's reply. A snapshot's `text` goes as plain text; a screenshot's
/// `image` file goes as an image block, so the agent sees the pixels, plus the path as text.
pub fn content(result: &Value) -> Value {
    if let Some(text) = result.get("text").and_then(|t| t.as_str()).filter(|_| result.as_object().is_some_and(|o| o.len() == 1)) {
        return json!({ "content": [{ "type": "text", "text": text }] });
    }
    let text = match result {
        Value::String(s) => s.clone(),
        other => serde_json::to_string_pretty(other).unwrap_or_default(),
    };
    let mut blocks = vec![json!({ "type": "text", "text": text })];
    let image = result
        .get("image")
        .and_then(|p| p.as_str())
        .or_else(|| result.get("screen").and_then(|s| s.get("image")).and_then(|p| p.as_str()));
    if let Some(path) = image {
        match std::fs::read(path) {
            Ok(bytes) => {
                use base64::Engine;
                let data = base64::engine::general_purpose::STANDARD.encode(bytes);
                blocks.push(json!({ "type": "image", "data": data, "mimeType": "image/png" }));
            }
            Err(e) => blocks.push(json!({ "type": "text", "text": format!("couldn't read the screenshot: {e}") })),
        }
    }
    json!({ "content": blocks })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_tool_schema_lists_every_action() {
        let tool = tools().into_iter().find(|t| t["name"] == "aurelia_browser").expect("aurelia_browser");
        let actions: Vec<&str> = tool["inputSchema"]["properties"]["action"]["enum"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
        assert_eq!(actions, ["open", "snapshot", "act", "wait", "resize", "inspect", "screenshot"]);
        assert_eq!(tool["inputSchema"]["required"], json!(["action"]));
        // Every action is accepted by the app side.
        for a in actions {
            assert!(crate::browser_agent::request(a, &json!({ "ref": "e1" })).is_ok(), "{a}");
        }
        assert!(handles("aurelia_browser"));
    }

    #[test]
    fn computer_tool_is_described_as_desktop_control_not_the_browser() {
        let tool = tools().into_iter().find(|t| t["name"] == "aurelia_computer").expect("aurelia_computer");
        let actions: Vec<&str> = tool["inputSchema"]["properties"]["action"]["enum"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
        assert_eq!(actions, ["status", "screenshot", "move", "click", "doubleClick", "rightClick", "type", "key", "scroll"]);
        assert_eq!(tool["inputSchema"]["required"], json!(["action"]));
        assert!(tool["description"].as_str().unwrap().contains("NOT the browser pane"));
        assert!(handles("aurelia_computer"));
    }

    #[test]
    fn screenshots_reach_the_agent_as_images() {
        let path = std::env::temp_dir().join(format!("aurelia-shot-{}.png", std::process::id()));
        std::fs::write(&path, b"\x89PNG fake").unwrap();
        let out = content(&json!({ "image": path.to_string_lossy(), "width": 10, "height": 5 }));
        let blocks = out["content"].as_array().unwrap();
        assert_eq!(blocks[0]["type"], "text");
        assert!(blocks[0]["text"].as_str().unwrap().contains("\"width\": 10"));
        assert_eq!(blocks[1]["type"], "image");
        assert_eq!(blocks[1]["mimeType"], "image/png");
        assert_eq!(blocks[1]["data"], "iVBORyBmYWtl");
        // Computer use returns its screenshot inside `screen`.
        let nested = content(&json!({ "action": "click", "screen": { "image": path.to_string_lossy(), "width": 10, "height": 5 } }));
        assert_eq!(nested["content"][1]["type"], "image");
        let _ = std::fs::remove_file(&path);
        // A snapshot is its text alone, not JSON.
        assert_eq!(content(&json!({ "text": "url: x" }))["content"][0]["text"], "url: x");
        // A missing file is said, not dropped.
        let gone = content(&json!({ "image": "/nonexistent/x.png" }));
        assert!(gone["content"][1]["text"].as_str().unwrap().contains("couldn't read"));
    }
}
