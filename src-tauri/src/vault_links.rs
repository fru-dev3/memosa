//! Links on a conversation: people, accounts and topic tags, plus suggested links
//! the person confirms with a tap. People and accounts are notes in the vault
//! (`vault::entities`); naming one on a call creates its note if there is none.

use crate::vault::entities::{self, Entity, Index, Kind};
use crate::vault::{ConvMeta, Suggested, Vault};
use crate::vault_cmds::vault;
use serde::Serialize;

#[derive(Serialize)]
pub struct EntityRow {
    #[serde(flatten)]
    pub entity: Entity,
    /// Conversations linked to it (an account counts its people's calls too).
    pub count: usize,
}

#[derive(Serialize)]
pub struct TagRow {
    pub name: String,
    pub count: usize,
}

#[derive(Serialize)]
pub struct Directory {
    pub entities: Vec<EntityRow>,
    pub tags: Vec<TagRow>,
}

fn index(v: &Vault) -> (Vec<Entity>, Index) {
    let all = entities::list(v.root());
    let ix = Index::new(&all);
    (all, ix)
}

/// Create a stub note for each name that has none yet.
fn ensure_notes(v: &Vault, ix: &Index, kind: Kind, names: &[String]) -> Result<(), String> {
    for n in names {
        if !ix.known(kind, n) {
            entities::save(v.root(), &Entity::new(kind, n), None).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Drop from the suggestions anything that is now linked.
fn prune(meta: &mut ConvMeta) {
    let has = |list: &[String], x: &String| list.iter().any(|y| y.eq_ignore_ascii_case(x));
    let (p, a, t) = (meta.people.clone(), meta.accounts.clone(), meta.tags.clone());
    meta.suggested.people.retain(|x| !has(&p, x));
    meta.suggested.accounts.retain(|x| !has(&a, x));
    meta.suggested.tags.retain(|x| !has(&t, x));
}

/// People, accounts and tags with how many calls each has: the sidebar and the
/// tag pickers.
#[tauri::command]
pub fn vault_directory() -> Result<Directory, String> {
    let v = vault()?;
    let (all, ix) = index(&v);
    let metas = v.all_metas();
    let entities = all
        .into_iter()
        .map(|e| {
            let count = metas.iter().filter(|m| ix.links(m, e.kind, &e.name)).count();
            EntityRow { entity: e, count }
        })
        .collect();
    let mut counts: std::collections::BTreeMap<String, usize> = Default::default();
    for m in &metas {
        for t in &m.tags {
            *counts.entry(t.clone()).or_default() += 1;
        }
    }
    let mut tags: Vec<TagRow> = counts.into_iter().map(|(name, count)| TagRow { name, count }).collect();
    tags.sort_by(|a, b| b.count.cmp(&a.count).then(a.name.cmp(&b.name)));
    Ok(Directory { entities, tags })
}

/// The conversations linked to a person, an account, or (kind "tag") a topic tag.
#[tauri::command]
pub fn vault_linked(kind: String, name: String) -> Result<Vec<ConvMeta>, String> {
    let v = vault()?;
    let (_, ix) = index(&v);
    let metas = v.all_metas();
    Ok(match kind.as_str() {
        "person" => metas.into_iter().filter(|m| ix.links(m, Kind::Person, &name)).collect(),
        "account" => metas.into_iter().filter(|m| ix.links(m, Kind::Account, &name)).collect(),
        _ => metas.into_iter().filter(|m| m.tags.iter().any(|t| t.eq_ignore_ascii_case(&name))).collect(),
    })
}

/// Set a conversation's people, accounts and tags. New names get a note.
#[tauri::command]
pub fn vault_set_links(id: String, people: Vec<String>, accounts: Vec<String>, tags: Vec<String>) -> Result<ConvMeta, String> {
    let v = vault()?;
    let (_, ix) = index(&v);
    let mut meta = v.read_meta(&id).map_err(|e| e.to_string())?;
    meta.people = entities::tidy(&ix, Kind::Person, &people);
    meta.accounts = entities::tidy(&ix, Kind::Account, &accounts);
    meta.tags = entities::tidy_tags(&tags);
    ensure_notes(&v, &ix, Kind::Person, &meta.people)?;
    ensure_notes(&v, &ix, Kind::Account, &meta.accounts)?;
    prune(&mut meta);
    v.write_meta(&meta).map_err(|e| e.to_string())?;
    Ok(meta)
}

/// Accept or dismiss one suggestion (kind: person, account, tag).
#[tauri::command]
pub fn vault_answer_suggestion(id: String, kind: String, name: String, accept: bool) -> Result<ConvMeta, String> {
    let v = vault()?;
    let mut meta = v.read_meta(&id).map_err(|e| e.to_string())?;
    let drop = |list: &mut Vec<String>| list.retain(|x| !x.eq_ignore_ascii_case(&name));
    match kind.as_str() {
        "person" => drop(&mut meta.suggested.people),
        "account" => drop(&mut meta.suggested.accounts),
        _ => drop(&mut meta.suggested.tags),
    }
    if !accept {
        meta.suggested.dismissed.push(name);
        v.write_meta(&meta).map_err(|e| e.to_string())?;
        return Ok(meta);
    }
    let (mut people, mut accounts, mut tags) = (meta.people.clone(), meta.accounts.clone(), meta.tags.clone());
    match kind.as_str() {
        "person" => people.push(name),
        "account" => accounts.push(name),
        _ => tags.push(name),
    }
    v.write_meta(&meta).map_err(|e| e.to_string())?;
    vault_set_links(id, people, accounts, tags)
}

/// Create or edit a person or account note. Renaming rewrites the links in every
/// conversation and, for an account, in every person who works there.
#[tauri::command]
pub fn vault_save_entity(entity: Entity, old_name: Option<String>) -> Result<(), String> {
    let v = vault()?;
    let mut e = entity;
    e.name = entities::clean_name(&e.name);
    e.aliases = e.aliases.iter().map(|a| a.trim().to_string()).filter(|a| !a.is_empty()).collect();
    e.account = e.account.map(|a| a.trim().to_string()).filter(|a| !a.is_empty() && e.kind == Kind::Person);
    entities::save(v.root(), &e, old_name.as_deref()).map_err(|e| e.to_string())?;
    if let Some(acc) = &e.account {
        let (_, ix) = index(&v);
        ensure_notes(&v, &ix, Kind::Account, std::slice::from_ref(acc))?;
    }
    let Some(old) = old_name.filter(|o| !o.eq_ignore_ascii_case(&e.name)) else { return Ok(()) };
    let swap = |list: &mut Vec<String>| {
        for x in list.iter_mut() {
            if x.eq_ignore_ascii_case(&old) {
                *x = e.name.clone();
            }
        }
    };
    for mut m in v.all_metas() {
        let before = (m.people.clone(), m.accounts.clone());
        match e.kind {
            Kind::Person => swap(&mut m.people),
            Kind::Account => swap(&mut m.accounts),
        }
        if before != (m.people.clone(), m.accounts.clone()) {
            v.write_meta(&m).map_err(|e| e.to_string())?;
        }
    }
    if e.kind == Kind::Account {
        for mut p in entities::list(v.root()).into_iter().filter(|p| p.kind == Kind::Person) {
            if p.account.as_deref().is_some_and(|a| a.eq_ignore_ascii_case(&old)) {
                p.account = Some(e.name.clone());
                entities::save(v.root(), &p, None).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

// ---- suggestions ----

/// What the AI read in a transcript.
#[derive(Default, serde::Deserialize)]
struct Heard {
    #[serde(default)]
    people: Vec<String>,
    #[serde(default)]
    companies: Vec<String>,
    #[serde(default)]
    topics: Vec<String>,
}

const SUGGEST_CHARS: usize = 6_000;

fn suggest_prompt(text: &str) -> String {
    let body: String = text.chars().take(SUGGEST_CHARS).collect();
    format!(
        "Read this conversation transcript and list who and what it is about.\n\
Respond with ONLY a JSON object, no prose:\n\
{{\"people\": [\"full names of people who speak or are discussed\"], \
\"companies\": [\"companies, clients or organizations discussed\"], \
\"topics\": [\"up to 3 short topic words, like pricing or hiring\"]}}\n\
Only include names that appear in the transcript. Use empty arrays when there are none.\n\n\
TRANSCRIPT:\n{body}\n\nJSON:"
    )
}

fn parse_heard(raw: &str) -> Heard {
    let (Some(a), Some(b)) = (raw.find('{'), raw.rfind('}')) else { return Heard::default() };
    if b < a {
        return Heard::default();
    }
    serde_json::from_str(&raw[a..=b]).unwrap_or_default()
}

/// Work out suggestions from what is known (notes whose name or alias is said in
/// the call, and their accounts) and, when local AI answers, from names it heard.
/// AI names are kept only when the transcript really says them.
fn suggestions(meta: &ConvMeta, text: &str, entities: &[Entity], ix: &Index, heard: Heard) -> Suggested {
    let hay = format!("{}\n{}", meta.title, text).to_lowercase();
    let mut s = Suggested { dismissed: meta.suggested.dismissed.clone(), ..Default::default() };
    let taken = |s: &Suggested, list: &[String], x: &str| {
        list.iter().chain(s.dismissed.iter()).any(|y| y.eq_ignore_ascii_case(x))
    };
    let add = |s: &mut Suggested, kind: Kind, name: String| {
        let linked = if kind == Kind::Person { &meta.people } else { &meta.accounts };
        if name.is_empty() || taken(s, linked, &name) {
            return;
        }
        let out = match kind {
            Kind::Person => &mut s.people,
            Kind::Account => &mut s.accounts,
        };
        if !out.iter().any(|y| y.eq_ignore_ascii_case(&name)) {
            out.push(name);
        }
    };

    for e in entities {
        if e.aliases.iter().chain(std::iter::once(&e.name)).any(|n| entities::mentions(&hay, &n.to_lowercase())) {
            add(&mut s, e.kind, e.name.clone());
        }
    }
    for p in heard.people {
        if entities::mentions(&hay, &p.trim().to_lowercase()) {
            add(&mut s, Kind::Person, ix.canonical(Kind::Person, &entities::clean_name(&p)));
        }
    }
    for c in heard.companies {
        if entities::mentions(&hay, &c.trim().to_lowercase()) {
            add(&mut s, Kind::Account, ix.canonical(Kind::Account, &entities::clean_name(&c)));
        }
    }
    // A suggested or linked person brings their account along.
    let people: Vec<String> = meta.people.iter().chain(s.people.clone().iter()).cloned().collect();
    for p in people {
        if let Some(acc) = ix.account_of(&p) {
            add(&mut s, Kind::Account, acc.clone());
        }
    }
    for t in entities::tidy_tags(&heard.topics).into_iter().take(3) {
        if !taken(&s, &meta.tags, &t) && !s.tags.contains(&t) {
            s.tags.push(t);
        }
    }
    s
}

/// Suggest links for a conversation and save them on it. Local AI is optional:
/// without it the suggestions come from the notes alone.
pub async fn suggest(id: &str) -> Result<ConvMeta, String> {
    let v = vault()?;
    let text = v.transcript(id).map_err(|e| e.to_string())?.to_plaintext();
    let heard = if text.trim().is_empty() {
        Heard::default()
    } else {
        match crate::insights::generate_text(&suggest_prompt(&text)).await {
            Ok(raw) => parse_heard(&raw),
            Err(e) => {
                crate::diagnostics::log(format!("suggest {id}: notes only ({e})"));
                Heard::default()
            }
        }
    };
    let (all, ix) = index(&v);
    let mut meta = v.read_meta(id).map_err(|e| e.to_string())?;
    meta.suggested = suggestions(&meta, &text, &all, &ix, heard);
    v.write_meta(&meta).map_err(|e| e.to_string())?;
    Ok(meta)
}

#[tauri::command]
pub async fn vault_suggest(id: String) -> Result<ConvMeta, String> {
    suggest(&id).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suggestions_come_from_notes_and_checked_ai_names() {
        let mut sam = Entity::new(Kind::Person, "Sam Lee");
        sam.account = Some("Acme".into());
        let notes = vec![sam, Entity::new(Kind::Account, "Acme")];
        let ix = Index::new(&notes);
        let mut meta = ConvMeta::new("Work/c", "Weekly sync", "2026-10-25T00:00:00Z");
        meta.suggested.dismissed = vec!["Globex".into()];
        let heard = Heard {
            people: vec!["Kim Park".into(), "Made Up Person".into()],
            companies: vec!["Globex".into()],
            topics: vec!["Pricing".into(), "q4 renewal".into(), "a".into(), "b".into()],
        };
        let s = suggestions(&meta, "Sam Lee and Kim Park talked about Globex pricing.", &notes, &ix, heard);
        assert_eq!(s.people, vec!["Sam Lee", "Kim Park"], "known name found, AI name kept only if said");
        assert_eq!(s.accounts, vec!["Acme"], "Sam brings Acme; dismissed Globex stays gone");
        assert_eq!(s.tags, vec!["pricing", "q4-renewal", "a"]);

        meta.people = vec!["Sam Lee".into()];
        let s = suggestions(&meta, "Sam Lee again.", &notes, &ix, Heard::default());
        assert!(s.people.is_empty(), "already linked is not suggested");
        assert_eq!(s.accounts, vec!["Acme"]);
    }

    #[test]
    fn parse_heard_tolerates_prose() {
        let h = parse_heard("Sure! {\"people\":[\"Kim Park\"],\"companies\":[]} hope that helps");
        assert_eq!(h.people, vec!["Kim Park"]);
        assert!(parse_heard("no json").people.is_empty());
    }
}
