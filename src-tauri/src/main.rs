// Prevents an extra console window on Windows in release; harmless on macOS.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Every mode, so the pty host's shells inherit it too.
    aurelia_space_lib::raise_fd_limit();
    // Claude panes start this same binary as their MCP server (see subagents.rs).
    let mode = std::env::args().nth(1);
    let mode = match mode.as_deref() {
        Some("mcp") => "mcp",
        Some("pty-host") => "pty-host",
        _ => "app",
    };
    aurelia_space_lib::panic_log::install(mode);
    match mode {
        "mcp" => aurelia_space_lib::serve_mcp(),
        // The terminal host the app starts in the background (see ptyhost.rs).
        "pty-host" => aurelia_space_lib::serve_pty_host(),
        _ => aurelia_space_lib::run(),
    }
}
