// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `memosa mcp` runs the local-first MCP server over stdio (no GUI) so AI
    // clients (Claude Desktop / Cursor / Claude Code) can query the meeting
    // corpus. Branch before any Tauri init.
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(|a| a.as_str()) {
        Some("mcp") => {
            // 3.0: the MCP server reads the files-only vault directly (no DB).
            memosa_lib::mcp_vault::run_stdio();
            return;
        }
        Some("reindex") => {
            memosa_lib::run_reindex();
            return;
        }
        Some("migrate") => {
            // One-time import of legacy DB data into the files-only vault.
            let root = memosa_lib::vault_cmds::vault_root();
            println!("Migrating legacy data into vault: {}", root.display());
            match memosa_lib::vault_migrate::migrate(&root) {
                Ok(r) => println!(
                    "Done: {} conversations, {} audio copied, {} skipped, {} errors",
                    r.conversations,
                    r.audio_copied,
                    r.skipped,
                    r.errors.len()
                ),
                Err(e) => eprintln!("migrate failed: {e}"),
            }
            return;
        }
        _ => {}
    }
    memosa_lib::run();
}
