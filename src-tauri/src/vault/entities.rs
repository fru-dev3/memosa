//! People and accounts as plain notes: `People/<Name>.md` and `Accounts/<Name>.md`
//! at the vault root. A short front matter holds `aliases` and, for a person, the
//! `account` they work at; the rest of the file is free notes. Conversations link to
//! them by name in meta.json (`people`, `accounts`). A call with John is also a call
//! with John's account: that is worked out when reading, never written into the call.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::types::ConvMeta;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Person,
    Account,
}

impl Kind {
    fn dir(self) -> &'static str {
        match self {
            Kind::Person => "People",
            Kind::Account => "Accounts",
        }
    }
}

/// The top-level folders that hold notes, not conversations.
pub fn is_entity_dir(name: &str) -> bool {
    name == "People" || name == "Accounts"
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Entity {
    pub kind: Kind,
    pub name: String,
    #[serde(default)]
    pub aliases: Vec<String>,
    /// A person's account (company). Always None for an account.
    #[serde(default)]
    pub account: Option<String>,
    /// The note below the front matter.
    #[serde(default)]
    pub body: String,
}

/// A name that is safe as a file name: no path separators, no leading dot.
pub fn clean_name(name: &str) -> String {
    let n: String = name.chars().map(|c| if c == '/' || c == '\\' || c == ':' { '-' } else { c }).collect();
    n.trim().trim_start_matches('.').trim().to_string()
}

fn path_for(root: &Path, kind: Kind, name: &str) -> PathBuf {
    root.join(kind.dir()).join(format!("{}.md", clean_name(name)))
}

fn parse_list(v: &str) -> Vec<String> {
    let v = v.trim().trim_start_matches('[').trim_end_matches(']');
    v.split(',').map(unquote).filter(|s| !s.is_empty()).collect()
}

fn unquote(s: &str) -> String {
    s.trim().trim_matches('"').trim_matches('\'').trim().to_string()
}

impl Entity {
    pub fn new(kind: Kind, name: &str) -> Self {
        Entity { kind, name: clean_name(name), aliases: Vec::new(), account: None, body: String::new() }
    }

    /// Read a note. Only `aliases` and `account` are read from the front matter;
    /// a file without one is all body.
    pub fn parse(kind: Kind, name: &str, text: &str) -> Self {
        let mut e = Entity::new(kind, name);
        let rest = match text.strip_prefix("---\n").and_then(|r| r.split_once("\n---")) {
            Some((front, after)) => {
                for line in front.lines() {
                    let Some((k, v)) = line.split_once(':') else { continue };
                    match k.trim() {
                        "aliases" => e.aliases = parse_list(v),
                        "account" if kind == Kind::Person => {
                            let a = unquote(v);
                            e.account = (!a.is_empty()).then_some(a);
                        }
                        _ => {}
                    }
                }
                after.strip_prefix('\n').unwrap_or(after)
            }
            None => text,
        };
        e.body = rest.trim_start_matches('\n').to_string();
        e
    }

    pub fn render(&self) -> String {
        let mut front = format!("---\nkind: {}\n", if self.kind == Kind::Person { "person" } else { "account" });
        if let Some(a) = self.account.as_deref().filter(|a| !a.is_empty()) {
            front.push_str(&format!("account: {a}\n"));
        }
        if !self.aliases.is_empty() {
            front.push_str(&format!("aliases: [{}]\n", self.aliases.join(", ")));
        }
        front.push_str("---\n\n");
        front + self.body.trim_start_matches('\n')
    }
}

/// Every person and account note, sorted by name.
pub fn list(root: &Path) -> Vec<Entity> {
    let mut out = Vec::new();
    for kind in [Kind::Person, Kind::Account] {
        let Ok(entries) = fs::read_dir(root.join(kind.dir())) else { continue };
        for entry in entries.flatten() {
            let p = entry.path();
            if p.extension().and_then(|e| e.to_str()) != Some("md") {
                continue;
            }
            let Some(name) = p.file_stem().map(|s| s.to_string_lossy().to_string()) else { continue };
            if name.starts_with('.') {
                continue;
            }
            if let Ok(text) = fs::read_to_string(&p) {
                out.push(Entity::parse(kind, &name, &text));
            }
        }
    }
    out.sort_by_key(|e| e.name.to_lowercase());
    out
}

/// Write a note. With `old_name` set and different, the old file is renamed away
/// first (the caller rewrites the links in conversations).
pub fn save(root: &Path, e: &Entity, old_name: Option<&str>) -> io::Result<()> {
    if e.name.is_empty() {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "A name is needed."));
    }
    let dest = path_for(root, e.kind, &e.name);
    if let Some(old) = old_name.filter(|o| clean_name(o) != e.name) {
        if dest.exists() {
            return Err(io::Error::new(io::ErrorKind::AlreadyExists, format!("{} already exists.", e.name)));
        }
        let from = path_for(root, e.kind, old);
        if from.exists() {
            fs::create_dir_all(dest.parent().unwrap())?;
            fs::rename(&from, &dest)?;
        }
    }
    fs::create_dir_all(dest.parent().unwrap())?;
    super::store::atomic_write(&dest, e.render().as_bytes())
}

/// Resolves names and aliases to the note they belong to.
pub struct Index {
    names: HashMap<(Kind, String), String>,
    person_account: HashMap<String, String>,
}

impl Index {
    pub fn new(entities: &[Entity]) -> Self {
        let mut names = HashMap::new();
        let mut person_account = HashMap::new();
        for e in entities {
            for a in e.aliases.iter().chain(std::iter::once(&e.name)) {
                names.insert((e.kind, a.to_lowercase()), e.name.clone());
            }
            if let Some(acc) = &e.account {
                person_account.insert(e.name.to_lowercase(), acc.clone());
            }
        }
        let mut ix = Index { names, person_account };
        // A person's account may itself be written as an alias.
        let resolved: Vec<(String, String)> =
            ix.person_account.iter().map(|(p, a)| (p.clone(), ix.canonical(Kind::Account, a))).collect();
        ix.person_account = resolved.into_iter().collect();
        ix
    }

    /// The note's name for `name` (or an alias of it); the trimmed name if unknown.
    pub fn canonical(&self, kind: Kind, name: &str) -> String {
        let n = name.trim();
        self.names.get(&(kind, n.to_lowercase())).cloned().unwrap_or_else(|| n.to_string())
    }

    pub fn known(&self, kind: Kind, name: &str) -> bool {
        self.names.contains_key(&(kind, name.trim().to_lowercase()))
    }

    pub fn account_of(&self, person: &str) -> Option<&String> {
        self.person_account.get(&self.canonical(Kind::Person, person).to_lowercase())
    }

    /// Whether a conversation links to this person or account. An account also
    /// matches every call with one of its people.
    pub fn links(&self, meta: &ConvMeta, kind: Kind, name: &str) -> bool {
        let want = self.canonical(kind, name).to_lowercase();
        let is = |k: Kind, n: &String| self.canonical(k, n).to_lowercase() == want;
        match kind {
            Kind::Person => meta.people.iter().any(|p| is(Kind::Person, p)),
            Kind::Account => {
                meta.accounts.iter().any(|a| is(Kind::Account, a))
                    || meta.people.iter().any(|p| self.account_of(p).is_some_and(|a| a.to_lowercase() == want))
            }
        }
    }
}

/// Canonical, de-duplicated names, first spelling wins.
pub fn tidy(ix: &Index, kind: Kind, names: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for n in names {
        let c = ix.canonical(kind, &clean_name(n));
        if !c.is_empty() && !out.iter().any(|o| o.eq_ignore_ascii_case(&c)) {
            out.push(c);
        }
    }
    out
}

/// Topic tags: lower case, no `#`, words joined by `-`.
pub fn tidy_tags(tags: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for t in tags {
        let t = t.trim().trim_start_matches('#').trim().to_lowercase().split_whitespace().collect::<Vec<_>>().join("-");
        if !t.is_empty() && !out.contains(&t) {
            out.push(t);
        }
    }
    out
}

/// Where `needle` appears in `hay` as whole words (both already lower case).
pub fn mentions(hay: &str, needle: &str) -> bool {
    if needle.chars().count() < 2 {
        return false;
    }
    let ok = |c: Option<char>| c.is_none_or(|c| !c.is_alphanumeric());
    hay.match_indices(needle).any(|(i, _)| ok(hay[..i].chars().next_back()) && ok(hay[i + needle.len()..].chars().next()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("memosa-ent-{}", std::process::id() as u128 * 1000 + rand_suffix()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }
    fn rand_suffix() -> u128 {
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().subsec_nanos() as u128
    }

    #[test]
    fn notes_round_trip_and_links_follow_aliases_and_accounts() {
        let root = tmp();
        let mut john = Entity::new(Kind::Person, "Sam Lee");
        john.aliases = vec!["Sammy".into()];
        john.account = Some("Acme".into());
        john.body = "Runs procurement.\n".into();
        save(&root, &john, None).unwrap();
        let mut acme = Entity::new(Kind::Account, "Acme Corp");
        acme.aliases = vec!["Acme".into()];
        save(&root, &acme, None).unwrap();

        let all = list(&root);
        assert_eq!(all.len(), 2);
        let back = all.iter().find(|e| e.kind == Kind::Person).unwrap();
        assert_eq!(back, &john, "a note reads back as written");

        let ix = Index::new(&all);
        assert_eq!(ix.canonical(Kind::Person, "sammy"), "Sam Lee");
        assert_eq!(ix.account_of("Sammy").map(String::as_str), Some("Acme Corp"), "account alias resolved");

        let mut m = ConvMeta::new("Work/x", "Call", "2026-10-25T00:00:00Z");
        m.people = vec!["Sammy".into()];
        assert!(ix.links(&m, Kind::Person, "Sam Lee"));
        assert!(ix.links(&m, Kind::Account, "Acme"), "a call with Sam is a call with Acme");
        assert!(!ix.links(&m, Kind::Account, "Globex"));

        // Rename keeps the note and refuses to overwrite another.
        let mut renamed = john.clone();
        renamed.name = "Samuel Lee".into();
        save(&root, &renamed, Some("Sam Lee")).unwrap();
        assert!(!root.join("People/Sam Lee.md").exists());
        assert!(root.join("People/Samuel Lee.md").exists());
        let mut clash = acme.clone();
        clash.name = "Acme Corp".into();
        save(&root, &Entity::new(Kind::Account, "Globex"), None).unwrap();
        assert!(save(&root, &clash, Some("Globex")).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn hand_written_note_without_front_matter_is_all_body() {
        let e = Entity::parse(Kind::Account, "Globex", "Big client.\n");
        assert_eq!(e.body, "Big client.\n");
        assert!(e.aliases.is_empty());
    }

    #[test]
    fn tidy_and_mentions() {
        assert_eq!(tidy_tags(&["#Pricing".into(), "Q4 renewal".into(), "pricing".into()]), vec!["pricing", "q4-renewal"]);
        assert!(mentions("we spoke to sam lee today", "sam lee"));
        assert!(!mentions("samsung phones", "sam"), "whole words only");
        assert_eq!(clean_name(" ../a/b "), "-a-b");
    }
}
