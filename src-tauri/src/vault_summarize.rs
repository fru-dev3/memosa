//! Summarize a conversation into `notes.md` (spec 05).
//!
//! Reads the conversation transcript via the files-only Vault, asks the local
//! engine (`insights::generate_text`, routed to Ollama and gated by Bunker mode —
//! it never reaches cloud directly) for a concise Summary, Decisions, and Action
//! items, parses the model output into a `Notes` value, and writes it with
//! `write_notes`. The vault's notes serializer renders each `Task` as a GFM
//! checkbox with `owner`/`due` metadata automatically.
//!
//! The parser is deliberately robust: the model is asked for JSON, but if it
//! returns Markdown headings/bullets (or anything in between) we fall back to a
//! heuristic section/bullet parse so a summary still lands on disk.

use crate::vault::{Notes, Task, Vault};
use crate::vault_cmds::vault_root;

/// Build the prompt → call the local engine → parse → write `notes.md`.
/// Returns the parsed `Notes` that were written.
pub async fn summarize(id: &str) -> Result<Notes, String> {
    let v = Vault::new(vault_root());
    v.ensure().map_err(|e| e.to_string())?;

    let transcript = v.transcript(id).map_err(|e| e.to_string())?;
    let plain = transcript.to_plaintext();
    if plain.trim().is_empty() {
        return Err("This conversation has no transcript to summarize yet.".into());
    }

    let title = v.read_meta(id).map(|m| m.title).unwrap_or_default();
    let prompt = build_prompt(&title, &plain);

    let raw = crate::insights::generate_text(&prompt).await?;
    if raw.trim().is_empty() {
        return Err(
            "A local model isn't running, so I couldn't write a summary. Start Ollama and try again."
                .into(),
        );
    }

    let notes = parse_model_output(&raw, id);
    if notes.summary.trim().is_empty() && notes.decisions.is_empty() && notes.actions.is_empty() {
        return Err("The local model returned an empty summary.".into());
    }

    v.write_notes(id, &notes).map_err(|e| e.to_string())?;
    Ok(notes)
}

#[tauri::command]
pub async fn vault_summarize(id: String) -> Result<Notes, String> {
    summarize(&id).await
}

const MAX_TRANSCRIPT_CHARS: usize = 12_000;

fn build_prompt(title: &str, transcript: &str) -> String {
    let body = truncate_chars(transcript, MAX_TRANSCRIPT_CHARS);
    format!(
        "You are Memosa, summarizing the user's own recorded conversation titled \"{title}\".\n\
Read the transcript below and produce concise meeting notes.\n\n\
Respond with ONLY a JSON object, no prose before or after, in exactly this shape:\n\
{{\n  \"summary\": \"2-4 sentence overview\",\n  \"decisions\": [\"a decision that was made\"],\n  \
\"actions\": [{{\"text\": \"the task\", \"owner\": \"who owns it or null\", \"due\": \"YYYY-MM-DD or null\"}}]\n}}\n\n\
Rules: Capture every concrete decision as a short decision bullet. Capture every commitment, \
follow-up, or to-do as an action with its owner and due date when the transcript states them \
(use null when not stated). Do not invent owners or dates. If there are no decisions or actions, \
use empty arrays.\n\nTRANSCRIPT:\n{body}\n\nJSON:"
    )
}

/// Parse model output into `Notes`. Tries JSON first, then a Markdown/heuristic
/// fallback so a usable summary always lands even from a chatty model.
fn parse_model_output(raw: &str, conv: &str) -> Notes {
    if let Some(notes) = parse_json(raw, conv) {
        return notes;
    }
    parse_heuristic(raw, conv)
}

// ---- JSON path ----

fn parse_json(raw: &str, conv: &str) -> Option<Notes> {
    let slice = extract_json_object(raw)?;
    let val: serde_json::Value = serde_json::from_str(slice).ok()?;
    let obj = val.as_object()?;

    let summary = obj
        .get("summary")
        .and_then(value_to_text)
        .unwrap_or_default()
        .trim()
        .to_string();

    let mut decisions = Vec::new();
    if let Some(arr) = obj.get("decisions").and_then(|v| v.as_array()) {
        for d in arr {
            if let Some(s) = value_to_text(d) {
                let s = s.trim().to_string();
                if !s.is_empty() {
                    decisions.push(s);
                }
            }
        }
    }

    let mut actions = Vec::new();
    if let Some(arr) = obj.get("actions").and_then(|v| v.as_array()) {
        for a in arr {
            if let Some(task) = json_task(a, conv) {
                actions.push(task);
            }
        }
    }

    // Require at least a summary for the JSON path to count as a success.
    if summary.is_empty() && decisions.is_empty() && actions.is_empty() {
        return None;
    }

    Some(Notes {
        summary,
        decisions,
        actions,
        markdown: String::new(),
    })
}

fn json_task(v: &serde_json::Value, conv: &str) -> Option<Task> {
    // Accept either a plain string or an object {text, owner, due}.
    if let Some(s) = v.as_str() {
        let text = s.trim().to_string();
        if text.is_empty() {
            return None;
        }
        return Some(Task {
            conv: conv.to_string(),
            text,
            done: false,
            owner: None,
            due: None,
        });
    }
    let obj = v.as_object()?;
    let text = obj
        .get("text")
        .or_else(|| obj.get("task"))
        .or_else(|| obj.get("action"))
        .and_then(value_to_text)
        .unwrap_or_default()
        .trim()
        .to_string();
    if text.is_empty() {
        return None;
    }
    Some(Task {
        conv: conv.to_string(),
        text,
        done: obj.get("done").and_then(|d| d.as_bool()).unwrap_or(false),
        owner: clean_opt(obj.get("owner").and_then(value_to_text)),
        due: clean_opt(obj.get("due").and_then(value_to_text)),
    })
}

/// Turn a JSON scalar into a string; treat explicit null/empty as None.
fn value_to_text(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

/// Drop None / empty / literal "null"/"none"/"n/a" values.
fn clean_opt(v: Option<String>) -> Option<String> {
    let s = v?;
    let t = s.trim();
    let low = t.to_lowercase();
    if t.is_empty() || low == "null" || low == "none" || low == "n/a" || low == "tbd" {
        None
    } else {
        Some(t.to_string())
    }
}

/// Find the first balanced top-level `{ ... }` object in arbitrary text
/// (ignoring braces inside strings), tolerating ```json fences and prose.
fn extract_json_object(raw: &str) -> Option<&str> {
    let bytes = raw.as_bytes();
    let start = raw.find('{')?;
    let mut depth = 0usize;
    let mut in_str = false;
    let mut escaped = false;
    let mut i = start;
    while i < bytes.len() {
        let c = bytes[i] as char;
        if in_str {
            if escaped {
                escaped = false;
            } else if c == '\\' {
                escaped = true;
            } else if c == '"' {
                in_str = false;
            }
        } else {
            match c {
                '"' => in_str = true,
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(&raw[start..=i]);
                    }
                }
                _ => {}
            }
        }
        i += 1;
    }
    None
}

// ---- heuristic / Markdown fallback ----

#[derive(PartialEq)]
enum Section {
    None,
    Summary,
    Decisions,
    Actions,
}

fn parse_heuristic(raw: &str, conv: &str) -> Notes {
    let mut summary = String::new();
    let mut decisions: Vec<String> = Vec::new();
    let mut actions: Vec<Task> = Vec::new();
    let mut section = Section::Summary; // leading prose counts as summary

    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if let Some(heading) = heading_text(trimmed) {
            let low = heading.to_lowercase();
            if low.starts_with("summary") || low.starts_with("overview") {
                section = Section::Summary;
            } else if low.starts_with("decision") || low.starts_with("key point") {
                section = Section::Decisions;
            } else if low.starts_with("action")
                || low.starts_with("next step")
                || low.starts_with("to-do")
                || low.starts_with("todo")
                || low.starts_with("follow")
            {
                section = Section::Actions;
            } else {
                section = Section::None;
            }
            continue;
        }

        match section {
            Section::Summary => {
                let text = strip_bullet(trimmed);
                if !text.is_empty() {
                    if !summary.is_empty() {
                        summary.push(' ');
                    }
                    summary.push_str(text);
                }
            }
            Section::Decisions => {
                let text = strip_bullet(trimmed);
                if !text.is_empty() {
                    decisions.push(text.to_string());
                }
            }
            Section::Actions => {
                if let Some(task) = heuristic_task(trimmed, conv) {
                    actions.push(task);
                }
            }
            Section::None => {}
        }
    }

    Notes {
        summary: summary.trim().to_string(),
        decisions,
        actions,
        markdown: String::new(),
    }
}

/// Extract heading text from `# ...`, `## ...`, or `**Bold:**`-style lines.
fn heading_text(line: &str) -> Option<&str> {
    if let Some(rest) = line.trim_start_matches('#').strip_prefix(' ') {
        if line.starts_with('#') {
            return Some(rest.trim().trim_end_matches(':'));
        }
    }
    // **Summary** or **Summary:** on its own line — a short, label-only bold line.
    if line.starts_with("**") && (line.ends_with("**") || line.ends_with("**:")) {
        let label = line.trim_matches('*').trim_end_matches(':').trim();
        if !label.is_empty() && label.len() < 40 {
            return Some(label);
        }
    }
    None
}

/// Strip a leading `-`, `*`, `•`, or `1.` list marker.
fn strip_bullet(line: &str) -> &str {
    let t = line.trim_start_matches(['-', '*', '•']).trim_start();
    // numbered list "1." / "1)"
    if let Some((head, rest)) = t.split_once(['.', ')']) {
        if !head.is_empty() && head.chars().all(|c| c.is_ascii_digit()) {
            return rest.trim();
        }
    }
    t.trim()
}

/// Parse one action line into a Task, harvesting GFM checkbox state plus
/// inline `(owner: X)` / `owner: X` / `due: YYYY-MM-DD` / `by <date>` hints.
fn heuristic_task(line: &str, conv: &str) -> Option<Task> {
    let mut done = false;
    let mut text = line.trim();

    // GFM checkbox prefix
    if let Some(rest) = text
        .strip_prefix("- [x]")
        .or_else(|| text.strip_prefix("- [X]"))
    {
        done = true;
        text = rest.trim();
    } else if let Some(rest) = text.strip_prefix("- [ ]") {
        text = rest.trim();
    } else {
        text = strip_bullet(text);
    }

    if text.is_empty() {
        return None;
    }

    let mut owner = None;
    let mut due = None;
    let mut visible = text.to_string();

    // Pull "owner: X" and "due: Y" out of a trailing parenthetical or the tail.
    for key in ["owner", "due"] {
        if let Some((val, stripped)) = extract_kv(&visible, key) {
            match key {
                "owner" => owner = clean_opt(Some(val)),
                "due" => due = clean_opt(Some(val)),
                _ => {}
            }
            visible = stripped;
        }
    }

    // "... by 2026-06-19" → due date
    if due.is_none() {
        if let Some(d) = find_iso_date_after(&visible, "by ") {
            due = Some(d);
        }
    }
    // bare ISO date anywhere → due
    if due.is_none() {
        if let Some(d) = find_iso_date(&visible) {
            due = Some(d);
        }
    }

    let visible = visible
        .trim()
        .trim_matches(|c| c == '(' || c == ')' || c == '-' || c == ',')
        .trim()
        .to_string();
    if visible.is_empty() {
        return None;
    }

    Some(Task {
        conv: conv.to_string(),
        text: visible,
        done,
        owner,
        due,
    })
}

/// Find `key: value` (case-insensitive) and return (value, line_without_it).
/// Value runs to the next `;`, `)`, `,`, or end.
fn extract_kv(line: &str, key: &str) -> Option<(String, String)> {
    let low = line.to_lowercase();
    let pat = format!("{}:", key);
    let pos = low.find(&pat)?;
    let after = pos + pat.len();
    let tail = &line[after..];
    let end = tail
        .find(|c| c == ';' || c == ')' || c == ',' || c == '|')
        .unwrap_or(tail.len());
    let val = tail[..end].trim().to_string();
    let mut stripped = String::new();
    stripped.push_str(&line[..pos]);
    stripped.push_str(&tail[end..]);
    Some((val, stripped))
}

fn find_iso_date_after(line: &str, marker: &str) -> Option<String> {
    let low = line.to_lowercase();
    let pos = low.find(marker)?;
    let tail = &line[pos + marker.len()..];
    find_iso_date(tail)
}

/// Find the first `YYYY-MM-DD` token in a string.
fn find_iso_date(line: &str) -> Option<String> {
    let bytes = line.as_bytes();
    let n = bytes.len();
    let mut i = 0;
    while i + 10 <= n {
        let w = &line[i..i + 10];
        let b = w.as_bytes();
        if b[0].is_ascii_digit()
            && b[1].is_ascii_digit()
            && b[2].is_ascii_digit()
            && b[3].is_ascii_digit()
            && b[4] == b'-'
            && b[5].is_ascii_digit()
            && b[6].is_ascii_digit()
            && b[7] == b'-'
            && b[8].is_ascii_digit()
            && b[9].is_ascii_digit()
        {
            return Some(w.to_string());
        }
        i += 1;
    }
    None
}

fn truncate_chars(s: &str, max: usize) -> &str {
    if s.len() <= max {
        return s;
    }
    let mut end = max;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    &s[..end]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_clean_json() {
        let raw = r#"Sure! Here are the notes:
```json
{
  "summary": "Compared three insurance policies and chose Obie with the rider.",
  "decisions": ["Proceed with Obie including the rider."],
  "actions": [
    {"text": "Send Obie the signed W-9", "owner": "Fru", "due": "2026-06-19"},
    {"text": "Request estate inventory", "owner": null, "due": null}
  ]
}
```
Hope that helps!"#;
        let n = parse_model_output(raw, "Life/Dad/obie");
        assert!(n.summary.contains("Obie"));
        assert_eq!(n.decisions.len(), 1);
        assert_eq!(n.actions.len(), 2);
        assert_eq!(n.actions[0].text, "Send Obie the signed W-9");
        assert_eq!(n.actions[0].owner.as_deref(), Some("Fru"));
        assert_eq!(n.actions[0].due.as_deref(), Some("2026-06-19"));
        assert_eq!(n.actions[1].owner, None);
        assert_eq!(n.actions[1].due, None);
    }

    #[test]
    fn falls_back_to_markdown() {
        let raw = "## Summary\nWe discussed the budget and timeline.\nEveryone agreed to ship in July.\n\n## Decisions\n- Ship the beta in July\n- Freeze scope now\n\n## Action items\n- [ ] Draft the launch email (owner: Sarah, due: 2026-07-01)\n- [x] Book the venue\n- Send invites by 2026-06-30";
        let n = parse_model_output(raw, "c");
        assert!(n.summary.contains("budget"));
        assert!(n.summary.contains("July"));
        assert_eq!(n.decisions.len(), 2);
        assert_eq!(n.actions.len(), 3);
        assert_eq!(n.actions[0].owner.as_deref(), Some("Sarah"));
        assert_eq!(n.actions[0].due.as_deref(), Some("2026-07-01"));
        assert!(n.actions[1].done);
        assert_eq!(n.actions[2].due.as_deref(), Some("2026-06-30"));
    }

    #[test]
    fn plain_string_actions_in_json() {
        let raw = r#"{"summary":"Quick sync.","decisions":[],"actions":["Email the report","Schedule follow-up"]}"#;
        let n = parse_model_output(raw, "c");
        assert_eq!(n.summary, "Quick sync.");
        assert!(n.decisions.is_empty());
        assert_eq!(n.actions.len(), 2);
        assert_eq!(n.actions[0].text, "Email the report");
    }

    #[test]
    fn extracts_iso_date() {
        assert_eq!(
            find_iso_date("due 2026-06-19 ok").as_deref(),
            Some("2026-06-19")
        );
        assert_eq!(find_iso_date("no date here"), None);
    }

    #[test]
    fn no_section_prose_is_summary() {
        let raw = "The team reviewed Q3 numbers and agreed revenue is on track.";
        let n = parse_model_output(raw, "c");
        assert!(n.summary.contains("revenue is on track"));
    }
}
