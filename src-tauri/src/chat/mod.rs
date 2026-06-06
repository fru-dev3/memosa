//! "Chat with your meetings" — local retrieval-augmented Q&A.
//!
//! Retrieval uses the existing FTS5 transcript index; generation uses the
//! configured AI engine (local Ollama or opt-in BYOK). Nothing leaves the
//! machine unless the user has chosen a cloud engine.

use crate::storage::Database;
use serde::Serialize;
use std::path::Path;

/// How many top-matching meetings to feed into the answer, and how much of each
/// transcript to include (chars). Bounds the prompt for local models.
const MAX_SOURCES: usize = 4;
const PER_TRANSCRIPT_CHARS: usize = 4_000;
const MAX_CONTEXT_CHARS: usize = 16_000;

#[derive(Serialize, Clone, Debug)]
pub struct ChatSource {
    pub meeting_id: String,
    pub title: String,
    pub date: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct ChatAnswer {
    pub answer: String,
    pub sources: Vec<ChatSource>,
}

const STOPWORDS: &[&str] = &[
    "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "for", "with", "what", "when",
    "where", "who", "why", "how", "did", "do", "does", "is", "are", "was", "were", "i", "we",
    "you", "they", "it", "this", "that", "about", "from", "my", "our", "me", "tell", "show",
];

/// Turn a natural-language question into an FTS5 MATCH query: keep significant
/// words, quote each (to neutralize FTS operators), and OR them together.
fn build_fts_query(question: &str) -> String {
    let terms: Vec<String> = question
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| w.len() > 2)
        .map(|w| w.to_lowercase())
        .filter(|w| !STOPWORDS.contains(&w.as_str()))
        .take(12)
        .map(|w| format!("\"{w}\""))
        .collect();
    terms.join(" OR ")
}

fn read_transcript(db: &Database, meeting_id: &str) -> Option<String> {
    let meeting = db.get_meeting(meeting_id).ok().flatten()?;
    let folder = db.get_folder_path(meeting_id).ok().flatten()?;
    let fallback = Path::new(&folder).join("transcript.md");
    let path = meeting
        .transcript_path
        .as_deref()
        .map(std::path::PathBuf::from)
        .filter(|p| p.exists())
        .unwrap_or(fallback);
    std::fs::read_to_string(&path).ok()
}

/// Answer a question using the user's meeting transcripts as context.
#[tauri::command]
pub async fn chat_with_meetings(
    question: String,
    db: tauri::State<'_, Database>,
) -> Result<ChatAnswer, String> {
    if !crate::insights::ai_engine_selected() {
        return Err("Chat needs a local (Ollama) or cloud AI engine. Enable one in Settings → AI Insights.".into());
    }
    let question = question.trim().to_string();
    if question.is_empty() {
        return Err("Ask a question first.".into());
    }

    // 1. Retrieve candidate meetings via FTS.
    let fts = build_fts_query(&question);
    let results = if fts.is_empty() {
        Vec::new()
    } else {
        db.search_meetings(&fts).unwrap_or_default()
    };

    if results.is_empty() {
        return Ok(ChatAnswer {
            answer: "I couldn't find anything in your meetings related to that. Try different keywords.".into(),
            sources: Vec::new(),
        });
    }

    // 2. Build bounded context from the top distinct meetings' transcripts.
    let mut sources: Vec<ChatSource> = Vec::new();
    let mut context = String::new();
    for result in results.into_iter().take(MAX_SOURCES) {
        let m = &result.meeting;
        let transcript = read_transcript(&db, &m.id).unwrap_or_else(|| result.snippet.clone());
        let snippet: String = transcript.chars().take(PER_TRANSCRIPT_CHARS).collect();
        context.push_str(&format!("--- Meeting: {} ({}) ---\n{}\n\n", m.title, m.date, snippet));
        sources.push(ChatSource {
            meeting_id: m.id.clone(),
            title: m.title.clone(),
            date: m.date.clone(),
        });
        if context.len() >= MAX_CONTEXT_CHARS {
            break;
        }
    }
    let context: String = context.chars().take(MAX_CONTEXT_CHARS).collect();

    // 3. Generate the answer grounded in the retrieved context.
    let prompt = format!(
        "You are answering a question using ONLY the meeting transcripts below. If the answer isn't \
        in them, say so plainly. Be concise and reference meeting titles where relevant. Do not \
        invent facts.\n\nQUESTION: {question}\n\nMEETING TRANSCRIPTS:\n{context}"
    );
    let answer = crate::insights::generate_text(&prompt).await?;

    Ok(ChatAnswer { answer, sources })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fts_query_drops_stopwords_and_quotes_terms() {
        let q = build_fts_query("What did we decide about the budget?");
        // "what", "did", "we", "the", "about" are stopwords; "decide"/"budget" remain.
        assert!(q.contains("\"decide\""));
        assert!(q.contains("\"budget\""));
        assert!(!q.contains("\"the\""));
        assert!(q.contains(" OR "));
    }

    #[test]
    fn fts_query_empty_when_only_stopwords() {
        assert_eq!(build_fts_query("what is the"), "");
    }

    #[test]
    fn fts_query_strips_punctuation() {
        let q = build_fts_query("roadmap, timeline & risks!");
        assert!(q.contains("\"roadmap\""));
        assert!(q.contains("\"timeline\""));
        assert!(q.contains("\"risks\""));
    }
}
