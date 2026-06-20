//! Parse/serialize `notes.md` (spec 01). Markdown is the source of truth for the
//! summary, decisions, and action items. Action items are GFM checkboxes with an
//! optional trailing HTML-comment carrying machine metadata (owner, due).

use super::types::{Notes, Task};

/// Parse a `notes.md` string into a structured `Notes` (keeping the raw markdown).
pub fn parse(md: &str, conv: &str) -> Notes {
    let body = strip_front_matter(md);
    let mut notes = Notes {
        markdown: md.to_string(),
        ..Default::default()
    };

    let mut section = String::new();
    for line in body.lines() {
        let trimmed = line.trim();
        if let Some(h) = trimmed.strip_prefix("## ") {
            section = h.trim().to_lowercase();
            continue;
        }
        match section.as_str() {
            "summary" => {
                if !trimmed.is_empty() {
                    if !notes.summary.is_empty() {
                        notes.summary.push(' ');
                    }
                    notes.summary.push_str(trimmed);
                }
            }
            "decisions" => {
                if let Some(item) = bullet(trimmed) {
                    notes.decisions.push(item.to_string());
                }
            }
            "action items" | "actions" => {
                if let Some(task) = parse_task(trimmed, conv) {
                    notes.actions.push(task);
                }
            }
            _ => {}
        }
    }
    notes
}

/// Serialize a `Notes` back to a `notes.md` string with YAML front-matter.
pub fn serialize(notes: &Notes, title: &str, date: &str, people: &[String], tags: &[String]) -> String {
    let mut out = String::new();
    out.push_str("---\n");
    out.push_str(&format!("title: {}\n", title));
    out.push_str(&format!("date: {}\n", date));
    out.push_str(&format!("people: [{}]\n", people.join(", ")));
    out.push_str(&format!("tags: [{}]\n", tags.join(", ")));
    out.push_str("---\n\n");

    out.push_str("## Summary\n");
    out.push_str(notes.summary.trim());
    out.push_str("\n\n");

    if !notes.decisions.is_empty() {
        out.push_str("## Decisions\n");
        for d in &notes.decisions {
            out.push_str(&format!("- {}\n", d));
        }
        out.push('\n');
    }

    out.push_str("## Action items\n");
    for t in &notes.actions {
        out.push_str(&render_task(t));
    }
    out
}

/// Flip a single action item's checkbox in raw markdown, preserving everything else.
/// Matches by the visible task text. Returns the new markdown, or None if not found.
pub fn toggle_task(md: &str, text: &str, done: bool) -> Option<String> {
    let needle = text.trim();
    let mut changed = false;
    let out: Vec<String> = md
        .lines()
        .map(|line| {
            if !changed && is_task_line(line) && line.contains(needle) {
                changed = true;
                set_checkbox(line, done)
            } else {
                line.to_string()
            }
        })
        .collect();
    if changed {
        let mut s = out.join("\n");
        if md.ends_with('\n') {
            s.push('\n');
        }
        Some(s)
    } else {
        None
    }
}

// ---- helpers ----

fn strip_front_matter(md: &str) -> &str {
    if let Some(rest) = md.strip_prefix("---\n") {
        if let Some(end) = rest.find("\n---") {
            let after = &rest[end + 4..];
            return after.trim_start_matches('\n');
        }
    }
    md
}

fn bullet(line: &str) -> Option<&str> {
    line.strip_prefix("- ").or_else(|| line.strip_prefix("* ")).map(|s| s.trim())
}

fn is_task_line(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("- [ ]") || t.starts_with("- [x]") || t.starts_with("- [X]")
}

fn set_checkbox(line: &str, done: bool) -> String {
    let mark = if done { "[x]" } else { "[ ]" };
    // replace the first "[ ]" / "[x]" / "[X]" occurrence
    for pat in ["[ ]", "[x]", "[X]"] {
        if let Some(pos) = line.find(pat) {
            let mut s = line.to_string();
            s.replace_range(pos..pos + 3, mark);
            return s;
        }
    }
    line.to_string()
}

fn parse_task(line: &str, conv: &str) -> Option<Task> {
    if !is_task_line(line) {
        return None;
    }
    let t = line.trim_start();
    let done = t.starts_with("- [x]") || t.starts_with("- [X]");
    let rest = &t[5..]; // after "- [ ]"
    // split off trailing HTML comment metadata
    let (visible, meta) = match rest.find("<!--") {
        Some(i) => (rest[..i].trim(), Some(rest[i..].to_string())),
        None => (rest.trim(), None),
    };
    let mut task = Task {
        conv: conv.to_string(),
        text: visible.to_string(),
        done,
        owner: None,
        due: None,
    };
    if let Some(m) = meta {
        let inner = m.trim_start_matches("<!--").trim_end_matches("-->");
        for kv in inner.split(';') {
            let mut it = kv.splitn(2, ':');
            let k = it.next().unwrap_or("").trim();
            let v = it.next().unwrap_or("").trim();
            match k {
                "owner" if !v.is_empty() => task.owner = Some(v.to_string()),
                "due" if !v.is_empty() => task.due = Some(v.to_string()),
                _ => {}
            }
        }
    }
    Some(task)
}

fn render_task(t: &Task) -> String {
    let box_ = if t.done { "[x]" } else { "[ ]" };
    let mut meta_parts = Vec::new();
    if let Some(o) = &t.owner {
        meta_parts.push(format!("owner: {}", o));
    }
    if let Some(d) = &t.due {
        meta_parts.push(format!("due: {}", d));
    }
    if meta_parts.is_empty() {
        format!("- {} {}\n", box_, t.text)
    } else {
        format!("- {} {}  <!-- {} -->\n", box_, t.text, meta_parts.join("; "))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "---\ntitle: Obie Insurance review\ndate: 2026-06-17\npeople: [Sarah, Fru]\ntags: [insurance]\n---\n\n## Summary\nCompared three policies.\nThe rider is the deciding factor.\n\n## Decisions\n- Proceed with Obie including the rider.\n\n## Action items\n- [ ] Send Obie the signed W-9  <!-- owner: Fru; due: 2026-06-19 -->\n- [x] Request estate inventory\n";

    #[test]
    fn parses_sections_and_tasks() {
        let n = parse(SAMPLE, "Life/Dad/obie");
        assert!(n.summary.contains("Compared three policies"));
        assert!(n.summary.contains("deciding factor"));
        assert_eq!(n.decisions.len(), 1);
        assert_eq!(n.actions.len(), 2);
        assert_eq!(n.actions[0].text, "Send Obie the signed W-9");
        assert_eq!(n.actions[0].owner.as_deref(), Some("Fru"));
        assert_eq!(n.actions[0].due.as_deref(), Some("2026-06-19"));
        assert!(!n.actions[0].done);
        assert!(n.actions[1].done);
    }

    #[test]
    fn toggles_a_task_in_place() {
        let out = toggle_task(SAMPLE, "Send Obie the signed W-9", true).unwrap();
        assert!(out.contains("- [x] Send Obie the signed W-9"));
        // metadata preserved
        assert!(out.contains("owner: Fru; due: 2026-06-19"));
        // other lines untouched
        assert!(out.contains("- [x] Request estate inventory"));
    }

    #[test]
    fn round_trips() {
        let n = parse(SAMPLE, "c");
        let md = serialize(&n, "Obie Insurance review", "2026-06-17", &["Sarah".into()], &["insurance".into()]);
        let n2 = parse(&md, "c");
        assert_eq!(n2.actions.len(), 2);
        assert_eq!(n2.decisions.len(), 1);
    }
}
