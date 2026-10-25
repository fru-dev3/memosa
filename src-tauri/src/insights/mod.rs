//! AI insight generation: summary, decisions, and action items.
//!
//! Three engines, chosen in Settings (`AppSettings::insight_engine`):
//!   * `Heuristic` — rule-based, handled in the frontend (`src/lib/insights.ts`).
//!     This module returns an error for it so the caller falls back.
//!   * `Ollama`    — local LLM; nothing leaves the machine (privacy default).
//!   * `Byok`      — user's own Anthropic/OpenAI key; sends transcript text to
//!     that provider, only after the user explicitly opts in.

use crate::storage::SettingsManager;
use crate::types::{AppSettings, ByokProvider, InsightEngine, MeetingInsights};
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
            detail: "Apple's on-device model (Apple Intelligence). Nothing leaves this Mac.".into(),
        }),
        InsightEngine::Ollama => {
            if let Err(e) = ensure_ollama_allowed(&settings) {
                return Ok(InsightEngineStatus { engine: "ollama".into(), available: false, detail: e });
            }
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
        InsightEngine::Ollama => {
            ensure_ollama_allowed(&settings)?;
            call_ollama(&settings.ollama_url, &settings.ollama_model, &prompt).await?
        }
        InsightEngine::Byok => {
            ensure_cloud_allowed(&settings)?;
            let key = load_byok_key().ok_or_else(|| "No API key set for BYOK engine.".to_string())?;
            let prompt = maybe_redact(&settings, &prompt);
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
    // Memosa runs on this Mac only: every summary, answer and suggestion comes from
    // Apple's on-device model. The Ollama and cloud engines stay in the code but are
    // not offered.
    call_apple(prompt).await
}

/// Error text when a prompt is too long for the on-device model; callers that can
/// split their input (summaries) look for it.
pub const TOO_LONG: &str = "too long for on-device AI";

/// The bundled `memosa-ai` helper (Apple's model and speech recognition).
pub fn ai_helper() -> Result<std::path::PathBuf, String> {
    let helper = std::env::current_exe().map_err(|e| e.to_string())?.with_file_name("memosa-ai");
    if helper.exists() { Ok(helper) } else { Err("On-device AI isn't part of this build.".into()) }
}

/// Apple's on-device model through the bundled `memosa-ai` helper (Swift only, so a
/// separate binary next to the app's own). Nothing leaves the Mac.
pub async fn call_apple(prompt: &str) -> Result<String, String> {
    let helper = ai_helper()?;
    let prompt = prompt.to_string();
    let out = tokio::task::spawn_blocking(move || {
        use std::io::Write;
        let mut child = std::process::Command::new(helper)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()?;
        child.stdin.take().expect("stdin").write_all(prompt.as_bytes())?;
        child.wait_with_output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("On-device AI didn't start: {e}"))?;
    match out.status.code() {
        Some(0) => Ok(String::from_utf8_lossy(&out.stdout).trim().to_string()),
        Some(3) => Err(TOO_LONG.into()),
        _ => Err(String::from_utf8_lossy(&out.stderr).trim().to_string()),
    }
}

/// Scrub secrets/PII from a prompt before it leaves the device, if enabled.
fn maybe_redact(settings: &AppSettings, prompt: &str) -> String {
    if settings.redact_secrets {
        crate::privacy::redact(prompt)
    } else {
        prompt.to_string()
    }
}

/// True when an Ollama address is this Mac (loopback).
pub fn is_loopback_url(url: &str) -> bool {
    let rest = url.trim().split("://").nth(1).unwrap_or(url.trim());
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = if let Some(v6) = authority.strip_prefix('[') {
        v6.split(']').next().unwrap_or("")
    } else {
        authority.rsplit_once(':').map(|(h, _)| h).unwrap_or(authority)
    };
    let host = host.to_ascii_lowercase();
    host == "localhost" || host == "::1" || host.starts_with("127.")
}

/// Bunker keeps every AI call on this Mac: an Ollama address on another machine is
/// refused until the user switches to Cloud mode. The one chokepoint for every
/// Ollama request (summaries, Ask, embeddings, status).
pub fn ensure_ollama_allowed(settings: &AppSettings) -> Result<(), String> {
    if settings.app_mode == crate::types::AppMode::Bunker && !is_loopback_url(&settings.ollama_url) {
        return Err(format!(
            "Bunker mode keeps AI on this Mac, so Ollama at {} is not used. Use an address on this Mac, or switch to Cloud mode.",
            settings.ollama_url
        ));
    }
    Ok(())
}

/// Fail-closed cloud guard. In Bunker mode every cloud/BYOK path is refused,
/// no matter what engine is configured — this is the single chokepoint.
fn ensure_cloud_allowed(settings: &AppSettings) -> Result<(), String> {
    if settings.app_mode == crate::types::AppMode::Bunker {
        return Err(
            "Bunker mode is on, so cloud AI is disabled. Switch to Cloud mode in \
             Settings, or use the local Ollama engine to keep everything on-device."
                .into(),
        );
    }
    Ok(())
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

#[cfg(test)]
mod mode_tests {
    use super::*;
    use crate::types::AppMode;

    #[test]
    fn bunker_keeps_ollama_on_this_mac() {
        assert!(is_loopback_url("http://localhost:11434"));
        assert!(is_loopback_url("http://127.0.0.1:11434/"));
        assert!(is_loopback_url("http://[::1]:11434"));
        assert!(!is_loopback_url("http://10.0.0.5:11434"));
        assert!(!is_loopback_url("http://localhost.example.com:11434"));
        assert!(!is_loopback_url("https://studio:11434"));
        let mut s = AppSettings::default();
        s.app_mode = AppMode::Bunker;
        s.ollama_url = "http://10.0.0.5:11434".into();
        assert!(ensure_ollama_allowed(&s).is_err());
        s.ollama_url = "http://localhost:11434".into();
        assert!(ensure_ollama_allowed(&s).is_ok());
        s.app_mode = AppMode::Cloud;
        s.ollama_url = "http://10.0.0.5:11434".into();
        assert!(ensure_ollama_allowed(&s).is_ok());
    }

    #[test]
    fn bunker_refuses_cloud_cloud_allows() {
        let mut s = AppSettings::default();
        s.app_mode = AppMode::Bunker;
        assert!(ensure_cloud_allowed(&s).is_err(), "bunker must refuse cloud");
        s.app_mode = AppMode::Cloud;
        assert!(ensure_cloud_allowed(&s).is_ok(), "cloud must allow");
    }
}
