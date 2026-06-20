//! Files-only MCP server (Memosa 3.0): exposes the **vault** to external AI agents
//! (Claude Desktop / Claude Code / Cursor / any MCP client) over stdio.
//!
//! Launched as a subcommand: `memosa mcp`. It reads the same file vault the app
//! uses, READ-ONLY (no DB, no writes), and never sends anything anywhere itself —
//! the connected AI client decides what to do with what it retrieves. This is the
//! "context layer for your intelligence" surface: your conversations, queryable by
//! your AI, with the corpus staying on disk.
//!
//! Protocol: JSON-RPC 2.0 over newline-delimited stdio (MCP stdio transport).
//! Hand-rolled (no MCP crate dep) — methods: initialize, tools/list, tools/call, ping.
//! The framing mirrors the legacy `mcp` module exactly; only the data source changed.

use crate::vault::{NodeKind, TreeNode, Vault};
use crate::vault_cmds::vault_root;
use serde_json::{json, Value};
use std::io::{BufRead, Write};

const PROTOCOL_VERSION: &str = "2024-11-05";

/// Reminder appended to retrieved content: a connected cloud client may forward text.
const CLOUD_NOTE: &str =
    "Note: this content was read from your local Memosa vault. If the connected client \
is a cloud AI, anything above may be forwarded to that provider.";

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
            "name": "list_domains",
            "description": "List the vault folder tree (domains and folders) with conversation counts.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "list_conversations",
            "description": "List conversations (newest first) with title, date, people, and tags. Optionally scope to a folder/domain path.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "folder": { "type": "string", "description": "Vault-relative folder path, e.g. \"Life/Dad\". Omit for the whole vault." },
                    "limit": { "type": "integer", "description": "Max conversations to return (default 25)." }
                }
            }
        },
        {
            "name": "get_conversation",
            "description": "Get one conversation's metadata plus its notes (summary, decisions, action items) by id.",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string", "description": "Conversation id (vault-relative path)." } },
                "required": ["id"]
            }
        },
        {
            "name": "get_transcript",
            "description": "Get the full transcript for a conversation by id (speaker map + timestamped segments).",
            "inputSchema": {
                "type": "object",
                "properties": { "id": { "type": "string" } },
                "required": ["id"]
            }
        },
        {
            "name": "search",
            "description": "Keyword search across conversation transcripts and notes. Returns matching conversations with a snippet. (mode/scope accepted for forward-compat; semantic is a later hook.)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string" },
                    "mode": { "type": "string", "description": "exact | semantic | hybrid (only keyword/exact implemented in 3.0)." },
                    "scope": { "type": "string", "description": "Vault-relative folder to restrict the search to." },
                    "limit": { "type": "integer" }
                },
                "required": ["query"]
            }
        },
        {
            "name": "get_speakers",
            "description": "Get the speaker map and speaker-attributed segments (who said what) for a conversation by id.",
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
        "list_domains" => tool_list_domains(&args),
        "list_conversations" => tool_list_conversations(&args),
        "get_conversation" => tool_get_conversation(&args),
        "get_transcript" => tool_get_transcript(&args),
        "search" => tool_search(&args),
        "get_speakers" => tool_get_speakers(&args),
        _ => Err(format!("Unknown tool: {name}")),
    };

    match result {
        Ok(text) => ok(id, text_content(&format!("{text}\n\n{CLOUD_NOTE}"), false)),
        Err(e) => ok(id, text_content(&format!("Error: {e}"), true)),
    }
}

// ─── Vault access (read-only) ────────────────────────────────────────────────

fn vault() -> Vault {
    Vault::new(vault_root())
}

/// Validate a caller-supplied conversation/folder id. Ids are vault-relative paths
/// with `/` separators; reject anything that could escape the vault root.
fn safe_id(args: &Value) -> Result<String, String> {
    let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("").trim();
    validate_path(id)?;
    if id.is_empty() {
        return Err("id is required".into());
    }
    Ok(id.to_string())
}

/// Reject path traversal / absolute paths / drive-style prefixes. Empty is allowed
/// (means "whole vault") so callers pass folders too; the id-required check is separate.
fn validate_path(p: &str) -> Result<(), String> {
    if p.is_empty() {
        return Ok(());
    }
    if p.starts_with('/') || p.starts_with('\\') || p.contains(':') || p.contains('\\') {
        return Err("invalid path (must be a vault-relative path)".into());
    }
    for part in p.split('/') {
        if part == ".." || part == "." {
            return Err("invalid path (traversal not allowed)".into());
        }
    }
    Ok(())
}

fn tool_list_domains(_args: &Value) -> Result<String, String> {
    let v = vault();
    let tree = v.tree().map_err(|e| e.to_string())?;
    // Strip conversation leaves: domains/folders + counts only.
    let out = folders_only(&tree);
    Ok(serde_json::to_string_pretty(&out).unwrap_or_default())
}

/// Recursively keep only domain/folder nodes (with counts); drop conversation leaves.
fn folders_only(node: &TreeNode) -> Value {
    let children: Vec<Value> = node
        .children
        .iter()
        .filter(|c| c.kind != NodeKind::Conversation)
        .map(folders_only)
        .collect();
    json!({
        "name": node.name,
        "path": node.path,
        "kind": kind_str(node.kind),
        "count": node.count,
        "children": children,
    })
}

fn kind_str(k: NodeKind) -> &'static str {
    match k {
        NodeKind::Domain => "domain",
        NodeKind::Folder => "folder",
        NodeKind::Conversation => "conversation",
    }
}

fn tool_list_conversations(args: &Value) -> Result<String, String> {
    let folder = args.get("folder").and_then(|v| v.as_str()).unwrap_or("").trim();
    validate_path(folder)?;
    let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(25).clamp(1, 200) as usize;

    let v = vault();
    let mut metas = if folder.is_empty() {
        all_conversations(&v)
    } else {
        v.list(folder).map_err(|e| e.to_string())?
    };
    metas.sort_by(|a, b| b.created.cmp(&a.created));
    metas.truncate(limit);

    let out: Vec<Value> = metas.iter().map(meta_row).collect();
    Ok(serde_json::to_string_pretty(&json!({ "conversations": out })).unwrap_or_default())
}

fn meta_row(m: &crate::vault::ConvMeta) -> Value {
    json!({
        "id": m.id,
        "title": m.title,
        "created": m.created,
        "duration_sec": m.duration_sec,
        "people": m.people,
        "tags": m.tags,
        "source": m.source,
    })
}

/// Walk the tree and read every conversation's meta across the whole vault.
fn all_conversations(v: &Vault) -> Vec<crate::vault::ConvMeta> {
    let mut out = Vec::new();
    if let Ok(tree) = v.tree() {
        collect_convs(v, &tree, &mut out);
    }
    out
}

fn collect_convs(v: &Vault, node: &TreeNode, out: &mut Vec<crate::vault::ConvMeta>) {
    match node.kind {
        NodeKind::Conversation => {
            if let Ok(meta) = v.read_meta(&node.path) {
                out.push(meta);
            }
        }
        _ => {
            for child in &node.children {
                collect_convs(v, child, out);
            }
        }
    }
}

fn tool_get_conversation(args: &Value) -> Result<String, String> {
    let id = safe_id(args)?;
    let v = vault();
    let (meta, notes) = v.get(&id).map_err(|e| match_not_found(e, &id))?;
    let out = json!({
        "id": meta.id,
        "title": meta.title,
        "created": meta.created,
        "duration_sec": meta.duration_sec,
        "people": meta.people,
        "tags": meta.tags,
        "source": meta.source,
        "summary": notes.summary,
        "decisions": notes.decisions,
        "actions": notes.actions,
        "notes_markdown": notes.markdown,
    });
    Ok(serde_json::to_string_pretty(&out).unwrap_or_default())
}

fn tool_get_transcript(args: &Value) -> Result<String, String> {
    let id = safe_id(args)?;
    let v = vault();
    // Confirm the conversation exists first (transcript() returns empty for missing files).
    v.read_meta(&id).map_err(|e| match_not_found(e, &id))?;
    let t = v.transcript(&id).map_err(|e| e.to_string())?;
    if t.segments.is_empty() {
        return Err("this conversation has no transcript yet".into());
    }
    let segments: Vec<Value> = t
        .segments
        .iter()
        .map(|s| {
            json!({
                "start": s.start,
                "end": s.end,
                "speaker": s.speaker,
                "text": s.text,
            })
        })
        .collect();
    let out = json!({
        "id": id,
        "language": t.language,
        "model": t.model,
        "speakers": t.speakers,
        "segments": segments,
        "plaintext": t.to_plaintext(),
    });
    Ok(serde_json::to_string_pretty(&out).unwrap_or_default())
}

fn tool_get_speakers(args: &Value) -> Result<String, String> {
    let id = safe_id(args)?;
    let v = vault();
    v.read_meta(&id).map_err(|e| match_not_found(e, &id))?;
    let t = v.transcript(&id).map_err(|e| e.to_string())?;
    if t.speakers.is_empty() && t.segments.iter().all(|s| s.speaker.is_empty()) {
        return Err("this conversation has no speaker information yet (not diarized).".into());
    }
    let segments: Vec<Value> = t
        .segments
        .iter()
        .map(|s| {
            let name = t.speakers.get(&s.speaker).cloned().unwrap_or_else(|| s.speaker.clone());
            json!({
                "start": s.start,
                "end": s.end,
                "speaker": s.speaker,
                "speaker_name": name,
                "text": s.text,
            })
        })
        .collect();
    let out = json!({
        "id": id,
        "speakers": t.speakers,
        "segments": segments,
    });
    Ok(serde_json::to_string_pretty(&out).unwrap_or_default())
}

fn tool_search(args: &Value) -> Result<String, String> {
    let query = args.get("query").and_then(|v| v.as_str()).unwrap_or("").trim();
    if query.is_empty() {
        return Err("query is required".into());
    }
    let scope = args.get("scope").and_then(|v| v.as_str()).unwrap_or("").trim();
    validate_path(scope)?;
    let limit = args.get("limit").and_then(|v| v.as_i64()).unwrap_or(20).clamp(1, 100) as usize;
    let needle = query.to_lowercase();

    let v = vault();
    let metas = if scope.is_empty() {
        all_conversations(&v)
    } else {
        // Within a scope, include conversations in nested folders too.
        let tree = v.tree().map_err(|e| e.to_string())?;
        match find_node(&tree, scope) {
            Some(node) => {
                let mut out = Vec::new();
                collect_convs(&v, node, &mut out);
                out
            }
            None => Vec::new(),
        }
    };

    let mut results: Vec<Value> = Vec::new();
    for meta in &metas {
        if results.len() >= limit {
            break;
        }
        let id = &meta.id;
        let mut hit_where: Option<&str> = None;
        let mut snippet = String::new();

        // Match title/tags/people cheaply first.
        if meta.title.to_lowercase().contains(&needle)
            || meta.tags.iter().any(|t| t.to_lowercase().contains(&needle))
            || meta.people.iter().any(|p| p.to_lowercase().contains(&needle))
        {
            hit_where = Some("meta");
            snippet = meta.title.clone();
        }

        // Transcript text.
        if hit_where.is_none() {
            if let Ok(t) = v.transcript(id) {
                let plain = t.to_plaintext();
                if let Some(s) = snippet_around(&plain, &needle) {
                    hit_where = Some("transcript");
                    snippet = s;
                }
            }
        }

        // Notes markdown.
        if hit_where.is_none() {
            if let Ok(notes) = v.notes(id) {
                if let Some(s) = snippet_around(&notes.markdown, &needle) {
                    hit_where = Some("notes");
                    snippet = s;
                }
            }
        }

        if let Some(where_) = hit_where {
            results.push(json!({
                "id": meta.id,
                "title": meta.title,
                "created": meta.created,
                "matched_in": where_,
                "snippet": snippet,
            }));
        }
    }

    Ok(serde_json::to_string_pretty(&json!({
        "query": query,
        "mode": "keyword",
        "results": results,
    }))
    .unwrap_or_default())
}

/// Find a tree node by its vault-relative path.
fn find_node<'a>(node: &'a TreeNode, path: &str) -> Option<&'a TreeNode> {
    if node.path == path {
        return Some(node);
    }
    for child in &node.children {
        if let Some(found) = find_node(child, path) {
            return Some(found);
        }
    }
    None
}

/// Case-insensitive substring search; returns a trimmed window around the first hit.
fn snippet_around(haystack: &str, needle_lower: &str) -> Option<String> {
    let lower = haystack.to_lowercase();
    let pos = lower.find(needle_lower)?;
    // Work on byte offsets aligned to char boundaries.
    let start = haystack[..pos]
        .char_indices()
        .rev()
        .nth(40)
        .map(|(i, _)| i)
        .unwrap_or(0);
    let end_from = pos + needle_lower.len();
    let end = haystack[end_from..]
        .char_indices()
        .nth(80)
        .map(|(i, _)| end_from + i)
        .unwrap_or(haystack.len());
    let mut s = haystack[start..end].replace('\n', " ").trim().to_string();
    if start > 0 {
        s.insert_str(0, "… ");
    }
    if end < haystack.len() {
        s.push_str(" …");
    }
    Some(s)
}

// ─── JSON-RPC + MCP helpers ──────────────────────────────────────────────────

fn match_not_found(e: std::io::Error, id: &str) -> String {
    if e.kind() == std::io::ErrorKind::NotFound {
        format!("no conversation with id {id}")
    } else {
        e.to_string()
    }
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
