//! Ask-your-memory over the vault (spec 05). Retrieval (vault_search) + grounded
//! generation through the existing local engine (insights::generate_text, which is
//! gated by Bunker mode and uses Ollama), returning inline citations to source
//! conversations. Degrades gracefully to "here are the relevant conversations" when
//! no local model is reachable — it never silently reaches for a cloud model.

use crate::vault::Vault;
use crate::vault_cmds::vault_root;
use serde::Serialize;

#[derive(Serialize)]
pub struct Citation {
    pub n: usize,
    pub conv: String,
    pub title: String,
    pub path: String,
    pub quote: String,
}

#[derive(Serialize)]
pub struct AskAnswer {
    pub text: String,
    pub citations: Vec<Citation>,
    /// true when a local model actually wrote the answer; false = retrieval-only fallback.
    pub grounded: bool,
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

#[tauri::command]
pub async fn vault_ask(q: String, scope: Option<String>) -> Result<AskAnswer, String> {
    // 1. retrieve the most relevant conversations from the files
    let hits: Vec<_> = crate::vault_search::search(&q, "hybrid", scope.as_deref())
        .into_iter()
        .take(5)
        .collect();

    let v = Vault::new(vault_root());
    let mut context = String::new();
    let mut citations = Vec::new();
    for (i, h) in hits.iter().enumerate() {
        let n = i + 1;
        let summary = v.notes(&h.conv).map(|x| x.summary).unwrap_or_default();
        let body = if summary.trim().is_empty() { h.snippet.clone() } else { summary };
        context.push_str(&format!(
            "[{}] {} ({})\n{}\n\n",
            n,
            h.title,
            h.conv,
            truncate_chars(&body, 600)
        ));
        citations.push(Citation {
            n,
            conv: h.conv.clone(),
            title: h.title.clone(),
            path: h.conv.clone(),
            quote: h.snippet.clone(),
        });
    }

    if citations.is_empty() {
        return Ok(AskAnswer {
            text: "I couldn't find anything in your vault about that yet.".into(),
            citations,
            grounded: false,
        });
    }

    // 2. grounded local generation
    let prompt = format!(
        "You are Memosa. Answer the question using ONLY the user's own conversation notes below. \
Be concise. Cite sources inline as [n] matching the numbered sources. If the notes don't \
contain the answer, say so.\n\nSOURCES:\n{}\nQUESTION: {}\n\nAnswer:",
        context, q
    );

    match crate::insights::generate_text(&prompt).await {
        Ok(text) if !text.trim().is_empty() => Ok(AskAnswer {
            text,
            citations,
            grounded: true,
        }),
        _ => Ok(AskAnswer {
            text: format!(
                "A local model isn't running, so I can't write a synthesized answer — but here are the \
most relevant conversations in your vault for \u{201c}{}\u{201d}. Start Ollama to get a written, cited answer.",
                q
            ),
            citations,
            grounded: false,
        }),
    }
}
