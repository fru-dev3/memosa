//! AI insight generation: summary, decisions, and action items.
//!
//! Three engines, chosen in Settings (`AppSettings::insight_engine`):
//!   * `Heuristic` — rule-based, handled in the frontend (`src/lib/insights.ts`).
//!     This module returns an error for it so the caller falls back.
//!   * `Ollama`    — local LLM; nothing leaves the machine (privacy default).
//!   * `Byok`      — user's own Anthropic/OpenAI key; sends transcript text to
//!     that provider, only after the user explicitly opts in.

use crate::storage::SettingsManager;
use crate::types::{ByokProvider, InsightEngine, MeetingInsights};
use keyring::Entry;
use serde::Serialize;
use serde_json::Value;

const KEYCHAIN_SERVICE: &str = "com.memosa.app";
const BYOK_ACCOUNT: &str = "byok_api_key";

/// Transcripts are capped before prompting to keep within local-model context
/// windows and to bound cost. Long meetings are truncated with a marker.
const MAX_TRANSCRIPT_CHARS: usize = 24_000;

const ANTHROPIC_MODEL: &str = "claude-haiku-4-5";
const OPENAI_MODEL: &str = "gpt-4o-mini";

#[derive(Serialize, Clone, Debug)]
pub struct InsightEngineStatus {
    pub engine: String,
    /// True when the selected engine is ready to use right now.
    pub available: bool,
    /// Human-readable detail (e.g. "Ollama not reachable at …", "No API key set").
    pub detail: String,
}

// ─── Keychain helpers for the BYOK key ──────────────────────────────────────

fn byok_entry() -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, BYOK_ACCOUNT).map_err(|e| format!("Keychain entry error: {e}"))
}

fn load_byok_key() -> Option<String> {
    byok_entry().ok()?.get_password().ok().filter(|k| !k.is_empty())
}

/// Store (or clear, when empty) the BYOK API key in the macOS Keychain.
#[tauri::command]
pub async fn set_byok_api_key(key: String) -> Result<(), String> {
    let entry = byok_entry()?;
    if key.trim().is_empty() {
        return match entry.delete_password() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("Keychain delete error: {e}")),
        };
    }
    entry
        .set_password(key.trim())
        .map_err(|e| format!("Keychain save error: {e}"))
}

// ─── Status ─────────────────────────────────────────────────────────────────

/// Report whether the currently-selected engine is ready, so the UI can guide
/// the user (start Ollama, paste a key, etc.).
#[tauri::command]
pub async fn get_insight_engine_status() -> Result<InsightEngineStatus, String> {
    let settings = SettingsManager::load();
    match settings.insight_engine {
        InsightEngine::Heuristic => Ok(InsightEngineStatus {
            engine: "heuristic".into(),
            available: true,
            detail: "Built-in offline extraction.".into(),
        }),
        InsightEngine::Ollama => {
            let reachable = reqwest::Client::new()
                .get(format!("{}/api/tags", settings.ollama_url.trim_end_matches('/')))
                .send()
                .await
                .map(|r| r.status().is_success())
                .unwrap_or(false);
            Ok(InsightEngineStatus {
                engine: "ollama".into(),
                available: reachable,
                detail: if reachable {
                    format!("Ollama ready ({}).", settings.ollama_model)
                } else {
                    format!("Ollama not reachable at {}. Is it running?", settings.ollama_url)
                },
            })
        }
        InsightEngine::Byok => {
            let has_key = load_byok_key().is_some();
            let provider = match settings.byok_provider {
                ByokProvider::Anthropic => "Anthropic",
                ByokProvider::OpenAI => "OpenAI",
            };
            Ok(InsightEngineStatus {
                engine: "byok".into(),
                available: has_key,
                detail: if has_key {
                    format!("{provider} key set. Transcript text is sent to {provider}.")
                } else {
                    format!("No {provider} API key set.")
                },
            })
        }
    }
}

// ─── Generation ─────────────────────────────────────────────────────────────

/// Generate insights for a transcript using the configured engine.
///
/// `custom_prompt` is an optional extra instruction (e.g. a template prompt) the
/// caller wants to steer the summary with.
#[tauri::command]
pub async fn generate_insights(
    transcript: String,
    custom_prompt: Option<String>,
) -> Result<MeetingInsights, String> {
    generate(transcript, custom_prompt).await
}

/// Returns true when an AI engine (Ollama/BYOK) is selected, i.e. the caller
/// should route through [`generate`] rather than the heuristic builder.
pub fn ai_engine_selected() -> bool {
    !matches!(SettingsManager::load().insight_engine, InsightEngine::Heuristic)
}

/// Core generation routine, callable from non-command code (e.g. the
/// transcription job). Routes to the engine configured in settings.
pub async fn generate(
    transcript: String,
    custom_prompt: Option<String>,
) -> Result<MeetingInsights, String> {
    let settings = SettingsManager::load();
    if transcript.trim().is_empty() {
        return Err("Transcript is empty.".into());
    }

    let transcript = truncate(&transcript, MAX_TRANSCRIPT_CHARS);
    let prompt = build_prompt(&transcript, custom_prompt.as_deref());

    let raw = match settings.insight_engine {
        InsightEngine::Heuristic => {
            return Err("Heuristic engine is handled by the frontend.".into())
        }
        InsightEngine::Ollama => call_ollama(&settings.ollama_url, &settings.ollama_model, &prompt).await?,
        InsightEngine::Byok => {
            let key = load_byok_key().ok_or_else(|| "No API key set for BYOK engine.".to_string())?;
            match settings.byok_provider {
                ByokProvider::Anthropic => call_anthropic(&key, &prompt).await?,
                ByokProvider::OpenAI => call_openai(&key, &prompt).await?,
            }
        }
    };

    parse_insights(&raw)
}

/// Generate free-form text (not JSON) with the configured AI engine. Errors on
/// the heuristic engine, which has no language model.
pub async fn generate_text(prompt: &str) -> Result<String, String> {
    let settings = SettingsManager::load();
    match settings.insight_engine {
        InsightEngine::Heuristic => {
            Err("This feature needs a local (Ollama) or cloud AI engine. Enable one in Settings → AI Insights.".into())
        }
        InsightEngine::Ollama => call_ollama_text(&settings.ollama_url, &settings.ollama_model, prompt).await,
        InsightEngine::Byok => {
            let key = load_byok_key().ok_or_else(|| "No API key set for the cloud engine.".to_string())?;
            match settings.byok_provider {
                ByokProvider::Anthropic => call_anthropic(&key, prompt).await,
                ByokProvider::OpenAI => call_openai_text(&key, prompt).await,
            }
        }
    }
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let head: String = s.chars().take(max).collect();
    format!("{head}\n\n[transcript truncated for length]")
}

fn build_prompt(transcript: &str, custom: Option<&str>) -> String {
    let extra = custom
        .map(|c| format!("\n\nAdditional guidance for the summary:\n{c}\n"))
        .unwrap_or_default();
    format!(
        r#"You are an assistant that turns a meeting transcript into structured notes.
Return ONLY a JSON object (no prose, no code fences) with exactly these keys:
- "summary": a thorough paragraph summary of the meeting
- "brief_summary": one sentence capturing the essence
- "meeting_notes": markdown bullet notes of the key discussion points
- "themes": array of short topic strings
- "people": array of names of people mentioned or speaking
- "tags": array of short keyword tags
- "keywords": array of important keywords
- "action_items": array of concrete action items (include owner/deadline if stated)
- "decisions": array of decisions made
Use empty arrays/strings when something is absent. Do not invent facts.{extra}

TRANSCRIPT:
{transcript}"#
    )
}

/// Pull a JSON object out of a model response (tolerates stray prose / code fences)
/// and map it onto `MeetingInsights`.
fn parse_insights(raw: &str) -> Result<MeetingInsights, String> {
    let json_slice = extract_json_object(raw)
        .ok_or_else(|| format!("Model did not return JSON. Got: {}", truncate(raw, 200)))?;
    let v: Value = serde_json::from_str(json_slice)
        .map_err(|e| format!("Failed to parse model JSON: {e}"))?;

    let str_field = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or_default().to_string();
    let arr_field = |k: &str| {
        v.get(k)
            .and_then(|x| x.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|i| i.as_str().map(|s| s.to_string()))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default()
    };

    Ok(MeetingInsights {
        summary: str_field("summary"),
        brief_summary: str_field("brief_summary"),
        meeting_notes: str_field("meeting_notes"),
        themes: arr_field("themes"),
        people: arr_field("people"),
        tags: arr_field("tags"),
        keywords: arr_field("keywords"),
        action_items: arr_field("action_items"),
        decisions: arr_field("decisions"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_bare_json() {
        let v = extract_json_object(r#"{"a":1}"#).unwrap();
        assert_eq!(v, r#"{"a":1}"#);
    }

    #[test]
    fn extracts_json_from_code_fence_and_prose() {
        let raw = "Here you go:\n```json\n{\"summary\":\"hi\"}\n```\nThanks!";
        let v = extract_json_object(raw).unwrap();
        assert_eq!(v, r#"{"summary":"hi"}"#);
    }

    #[test]
    fn extracts_nested_and_ignores_braces_in_strings() {
        let raw = r#"prefix {"a": {"b": "}"}} suffix"#;
        let v = extract_json_object(raw).unwrap();
        assert_eq!(v, r#"{"a": {"b": "}"}}"#);
    }

    #[test]
    fn returns_none_without_object() {
        assert!(extract_json_object("no json here").is_none());
    }

    #[test]
    fn truncate_marks_long_input() {
        let out = truncate("abcdef", 3);
        assert!(out.starts_with("abc"));
        assert!(out.contains("truncated"));
        assert_eq!(truncate("ab", 5), "ab");
    }
}

/// Find the first balanced top-level `{...}` block in a string.
fn extract_json_object(s: &str) -> Option<&str> {
    let start = s.find('{')?;
    let mut depth = 0usize;
    let mut in_str = false;
    let mut escaped = false;
    for (i, c) in s[start..].char_indices() {
        if in_str {
            match c {
                '\\' if !escaped => escaped = true,
                '"' if !escaped => in_str = false,
                _ => escaped = false,
            }
            continue;
        }
        match c {
            '"' => in_str = true,
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(&s[start..=start + i]);
                }
            }
            _ => {}
        }
    }
    None
}

// ─── Engine calls ────────────────────────────────────────────────────────────

async fn call_ollama(base_url: &str, model: &str, prompt: &str) -> Result<String, String> {
    let url = format!("{}/api/generate", base_url.trim_end_matches('/'));
    let body = serde_json::json!({
        "model": model,
        "prompt": prompt,
        "stream": false,
        "format": "json",
    });
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {e}. Is Ollama running?"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama error ({status}): {text}"));
    }
    let v: Value = resp.json().await.map_err(|e| format!("Ollama parse error: {e}"))?;
    v.get("response")
        .and_then(|r| r.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Ollama response missing 'response' field.".to_string())
}

async fn call_ollama_text(base_url: &str, model: &str, prompt: &str) -> Result<String, String> {
    let url = format!("{}/api/generate", base_url.trim_end_matches('/'));
    let body = serde_json::json!({ "model": model, "prompt": prompt, "stream": false });
    let resp = reqwest::Client::new()
        .post(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Ollama request failed: {e}. Is Ollama running?"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Ollama error ({status}): {text}"));
    }
    let v: Value = resp.json().await.map_err(|e| format!("Ollama parse error: {e}"))?;
    v.get("response")
        .and_then(|r| r.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Ollama response missing 'response' field.".to_string())
}

async fn call_openai_text(api_key: &str, prompt: &str) -> Result<String, String> {
    let body = serde_json::json!({
        "model": OPENAI_MODEL,
        "messages": [{ "role": "user", "content": prompt }],
    });
    let resp = reqwest::Client::new()
        .post("https://api.openai.com/v1/chat/completions")
        .header("authorization", format!("Bearer {api_key}"))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI request failed: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("OpenAI error ({status}): {text}"));
    }
    let v: Value = resp.json().await.map_err(|e| format!("OpenAI parse error: {e}"))?;
    v.get("choices")
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .and_then(|m| m.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "OpenAI response missing message content.".to_string())
}

async fn call_anthropic(api_key: &str, prompt: &str) -> Result<String, String> {
    let body = serde_json::json!({
        "model": ANTHROPIC_MODEL,
        "max_tokens": 2048,
        "messages": [{ "role": "user", "content": prompt }],
    });
    let resp = reqwest::Client::new()
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Anthropic request failed: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("Anthropic error ({status}): {text}"));
    }
    let v: Value = resp.json().await.map_err(|e| format!("Anthropic parse error: {e}"))?;
    v.get("content")
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .and_then(|m| m.get("text"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Anthropic response missing text content.".to_string())
}

async fn call_openai(api_key: &str, prompt: &str) -> Result<String, String> {
    let body = serde_json::json!({
        "model": OPENAI_MODEL,
        "messages": [{ "role": "user", "content": prompt }],
        "response_format": { "type": "json_object" },
    });
    let resp = reqwest::Client::new()
        .post("https://api.openai.com/v1/chat/completions")
        .header("authorization", format!("Bearer {api_key}"))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("OpenAI request failed: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("OpenAI error ({status}): {text}"));
    }
    let v: Value = resp.json().await.map_err(|e| format!("OpenAI parse error: {e}"))?;
    v.get("choices")
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .and_then(|m| m.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "OpenAI response missing message content.".to_string())
}
