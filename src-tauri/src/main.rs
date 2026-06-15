// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `memosa mcp` runs the local-first MCP server over stdio (no GUI) so AI
    // clients (Claude Desktop / Cursor / Claude Code) can query the meeting
    // corpus. Branch before any Tauri init.
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(|a| a.as_str()) {
        Some("mcp") => {
            memosa_lib::mcp::run_stdio();
            return;
        }
        Some("reindex") => {
            memosa_lib::run_reindex();
            return;
        }
        _ => {}
    }
    memosa_lib::run();
}
