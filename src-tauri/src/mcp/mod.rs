//! Local-first MCP server: exposes the meeting corpus to external AI agents
//! (Claude Desktop / Claude Code / Cursor / any MCP client) over stdio.
//!
//! Launched as a subcommand: `memosa mcp`. It opens the same SQLite DB the app
//! uses, READ-ONLY, and never sends anything anywhere itself — the connected AI
//! client decides what to do with what it retrieves. This is the "context layer
//! for your intelligence" surface: your meetings, queryable by your AI, with the
//! corpus staying on disk.
//!
//! Protocol: JSON-RPC 2.0 over newline-delimited stdio (MCP stdio transport).
//! Hand-rolled (no MCP crate dep) — methods: initialize, tools/list, tools/call, ping.

use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::io::{BufRead, Write};

const PROTOCOL_VERSION: &str = "2024-11-05";

/// Entry point for `memosa mcp`. Blocks, serving the stdio transport until EOF.
pub fn run_stdio() {
    let enabled = crate::storage::SettingsManager::load().mcp_server_enabled;
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();

    for line in stdin.lock().lines() {
        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let req: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue, // ignore malformed lines
        };

        let id = req.get("id").cloned();
        let method = req.get("method").and_then(|m| m.as_str()).unwrap_or("");

        // Notifications (no id) get no response.
        let response = match method {
            "initialize" => Some(ok(id, initialize_result())),
            "ping" => Some(ok(id, json!({}))),
            "tools/list" => Some(ok(id, json!({ "tools": tool_specs() }))),
            "tools/call" => Some(handle_tool_call(id, &req, enabled)),
            _ if id.is_some() => Some(err(id, -32601, "Method not found")),
            _ => None, // notification (e.g. notifications/initialized)
        };

        if let Some(resp) = response {
            let _ = writeln!(stdout, "{}", resp);
            let _ = stdout.flush();
        }
    }
}

/// Connect info for the Settings UI: the absolute binary path + a copy-paste
/// MCP client config (Claude Desktop / Cursor / Claude Code all use this shape).
#[tauri::command]
pub fn mcp_connect_info() -> Result<Value, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let path = exe.to_string_lossy().to_string();
    let config = serde_json::to_string_pretty(&json!({
        "mcpServers": { "memosa": { "command": path, "args": ["mcp"] } }
    }))
    .unwrap_or_default();
    Ok(json!({ "binaryPath": path, "config": config }))
}

fn initialize_result() -> Value {
    json!({
        "protocolVersion": PROTOCOL_VERSION,
        "capabilities": { "tools": {} },
        "serverInfo": { "name": "memosa", "version": env!("CARGO_PKG_VERSION") }
    })
}

fn tool_specs() -> Value {
    json!([
        {
            "name": "list_meetings",
            "description": "List recorded meetings (most recent first) with title, date, duration, and summary.",
            "inputSchema": {
                "type": "object",
                "properties": { "limit": { "type": "integer", "description": "Max meetings to return (default 25)." } }
            }
        },
        {
            "name": "search_meetings",
            "description": "Full-text search across all meeting transcripts. Returns matching meetings with a snippet.",
            "inputSchema": {
                "type": "object",
                "properties": { "query": { "type": "string" }, "limit": { "type": "integer" } },
                "required": ["query"]
            }
        },
        {
            "name": "get_meeting",
            "description": "Get one meeting's full metadata: summary, action items, decisions, tags, people, attendees.",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string", "description": "Meeting id." } },
                "required": ["id"]
            }
        },
        {
            "name": "get_transcript",
            "description": "Get the full transcript text for a meeting by id.",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"]
            }
        }
    ])
}

fn handle_tool_call(id: Option<Value>, req: &Value, enabled: bool) -> Value {
    if !enabled {
        return ok(
            id,
            text_content(
                "The Memosa MCP server is disabled. Enable it in Memosa → Settings → AI Insights → MCP server.",
                true,
            ),
        );
    }
    let params = req.get("params").cloned().unwrap_or(json!({}));
    let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
    let args = params.get("arguments").cloned().unwrap_or(json!({}));

    let result = match name {
        "list_meetings" => tool_list_meetings(&args),
        "search_meetings" => tool_search_meetings(&args),
        "get_meeting" => tool_get_meeting(&args),
        "get_transcript" => tool_get_transcript(&args),
        _ => Err(format!("Unknown tool: {name}")),
    };

    match result {
        Ok(text) => ok(id, text_content(&text, false)),
        Err(e) => ok(id, text_content(&format!("Error: {e}"), true)),
    }
}

// ─── DB access (read-only) ───────────────────────────────────────────────────

fn open_db() -> Result<Connection, String> {
    let path = crate::paths::app_data_dir().join("memosa.db");
    Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|e| format!("cannot open meeting database at {}: {e}", path.display()))
}

fn tool_list_meetings(args: &Value) -> Result<String, String> {
    let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(25).clamp(1, 200);
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, date, start_time, duration_seconds, summary, transcription_status
             FROM meetings ORDER BY date DESC, start_time DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([limit], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "title": r.get::<_, String>(1)?,
                "date": r.get::<_, String>(2)?,
                "start_time": r.get::<_, String>(3)?,
                "duration_seconds": r.get::<_, i64>(4)?,
                "summary": r.get::<_, Option<String>>(5)?,
                "transcription_status": r.get::<_, String>(6)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let out: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(serde_json::to_string_pretty(&json!({ "meetings": out })).unwrap_or_default())
}

fn tool_search_meetings(args: &Value) -> Result<String, String> {
    let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("").trim();
    if query.is_empty() {
        return Err("query is required".into());
    }
    let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(20).clamp(1, 100);
    let conn = open_db()?;
    let mut stmt = conn
        .prepare(
            "SELECT m.id, m.title, m.date, snippet(transcripts_fts, 2, '[', ']', '…', 14)
             FROM transcripts_fts JOIN meetings m ON m.id = transcripts_fts.meeting_id
             WHERE transcripts_fts MATCH ?1 ORDER BY rank LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![query, limit], |r| {
            Ok(json!({
                "id": r.get::<_, String>(0)?,
                "title": r.get::<_, String>(1)?,
                "date": r.get::<_, String>(2)?,
                "snippet": r.get::<_, String>(3)?,
            }))
        })
        .map_err(|e| e.to_string())?;
    let out: Vec<Value> = rows.filter_map(|r| r.ok()).collect();
    Ok(serde_json::to_string_pretty(&json!({ "results": out })).unwrap_or_default())
}

fn tool_get_meeting(args: &Value) -> Result<String, String> {
    let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
    if id.is_empty() {
        return Err("id is required".into());
    }
    let conn = open_db()?;
    let row = conn
        .query_row(
            "SELECT title, date, start_time, duration_seconds, summary, attendees,
                    tags, people, themes, keywords, action_items, decisions
             FROM meetings WHERE id = ?1",
            [id],
            |r| {
                Ok(json!({
                    "id": id,
                    "title": r.get::<_, String>(0)?,
                    "date": r.get::<_, String>(1)?,
                    "start_time": r.get::<_, String>(2)?,
                    "duration_seconds": r.get::<_, i64>(3)?,
                    "summary": r.get::<_, Option<String>>(4)?,
                    "attendees": parse_json_array(r.get::<_, Option<String>>(5)?),
                    "tags": parse_json_array(r.get::<_, Option<String>>(6)?),
                    "people": parse_json_array(r.get::<_, Option<String>>(7)?),
                    "themes": parse_json_array(r.get::<_, Option<String>>(8)?),
                    "keywords": parse_json_array(r.get::<_, Option<String>>(9)?),
                    "action_items": parse_json_array(r.get::<_, Option<String>>(10)?),
                    "decisions": parse_json_array(r.get::<_, Option<String>>(11)?),
                }))
            },
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => format!("no meeting with id {id}"),
            other => other.to_string(),
        })?;
    Ok(serde_json::to_string_pretty(&row).unwrap_or_default())
}

fn tool_get_transcript(args: &Value) -> Result<String, String> {
    let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
    if id.is_empty() {
        return Err("id is required".into());
    }
    let conn = open_db()?;
    let path: Option<String> = conn
        .query_row("SELECT transcript_path FROM meetings WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => format!("no meeting with id {id}"),
            other => other.to_string(),
        })?;
    match path {
        Some(p) if !p.is_empty() => {
            std::fs::read_to_string(&p).map_err(|e| format!("cannot read transcript at {p}: {e}"))
        }
        _ => Err("this meeting has no transcript yet".into()),
    }
}

// ─── JSON-RPC + MCP helpers ──────────────────────────────────────────────────

fn parse_json_array(s: Option<String>) -> Value {
    s.and_then(|s| serde_json::from_str::<Value>(&s).ok())
        .unwrap_or_else(|| json!([]))
}

fn text_content(text: &str, is_error: bool) -> Value {
    json!({ "content": [{ "type": "text", "text": text }], "isError": is_error })
}

fn ok(id: Option<Value>, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id.unwrap_or(Value::Null), "result": result })
}

fn err(id: Option<Value>, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id.unwrap_or(Value::Null),
            "error": { "code": code, "message": message } })
}
