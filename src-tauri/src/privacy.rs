//! Redaction: scrub likely secrets / PII from text before it can leave the
//! device. Applied to transcript/prompt text on the cloud (BYOK) path when
//! `AppSettings::redact_secrets` is on. In Bunker mode nothing leaves anyway;
//! this is the extra belt-and-braces for Cloud mode. Errs toward over-redaction.

use regex::Regex;
use std::sync::OnceLock;

fn patterns() -> &'static Vec<(Regex, &'static str)> {
    static P: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    P.get_or_init(|| {
        vec![
            // emails
            (Regex::new(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}").unwrap(), "[redacted-email]"),
            // provider API keys (OpenAI sk-/pk-, etc.)
            (Regex::new(r"\b[A-Za-z]{2,4}-[A-Za-z0-9]{20,}\b").unwrap(), "[redacted-key]"),
            // AWS access key id
            (Regex::new(r"\bAKIA[0-9A-Z]{16}\b").unwrap(), "[redacted-key]"),
            // Bearer tokens
            (Regex::new(r"\bBearer\s+[A-Za-z0-9._\-]{8,}").unwrap(), "[redacted-token]"),
            // US SSN
            (Regex::new(r"\b\d{3}-\d{2}-\d{4}\b").unwrap(), "[redacted-ssn]"),
            // card-like 13-19 digit runs (allowing space/dash groupings)
            (Regex::new(r"\b(?:\d[ \-]?){13,19}\b").unwrap(), "[redacted-number]"),
            // phone-ish
            (Regex::new(r"\+?\d[\d\s().\-]{8,}\d").unwrap(), "[redacted-phone]"),
        ]
    })
}

/// Replace likely secrets / PII with redaction markers.
pub fn redact(text: &str) -> String {
    let mut out = text.to_string();
    for (re, repl) in patterns() {
        out = re.replace_all(&out, *repl).into_owned();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redacts_common_secrets_and_pii() {
        let r = redact("email me at a.b@example.com or call 415-555-2671");
        assert!(!r.contains("a.b@example.com"));
        assert!(r.contains("[redacted-email]"));
        assert!(!r.contains("415-555-2671"));

        let r2 = redact("key sk-ABCDEFGHIJKLMNOPQRSTUVWX and ssn 123-45-6789");
        assert!(r2.contains("[redacted-key]"));
        assert!(r2.contains("[redacted-ssn]"));
        assert!(!r2.contains("123-45-6789"));
    }

    #[test]
    fn leaves_ordinary_text_intact() {
        let s = "We agreed to ship the feature on Tuesday and review next week.";
        assert_eq!(redact(s), s);
    }
}
