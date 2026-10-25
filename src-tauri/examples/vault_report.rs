//! Prints what Memosa reads from a vault, as JSON, so another reader (Jot Studio's
//! Swift core) can be checked against it: `MEMOSA_VAULT=<dir> cargo run --example
//! vault_report -- <search phrase>...`
use memosa_lib::vault::Vault;
use serde_json::json;

fn main() {
    let v = Vault::new(memosa_lib::vault_cmds::vault_root());
    let convs: Vec<_> = v
        .all_metas()
        .into_iter()
        .map(|m| {
            let notes = v.notes(&m.id).unwrap_or_default();
            let segments = v.transcript(&m.id).map(|t| t.segments.len()).unwrap_or(0);
            json!({
                "id": m.id, "title": m.title, "created": m.created, "duration_sec": m.duration_sec,
                "people": m.people, "accounts": m.accounts, "tags": m.tags,
                "summary": notes.summary, "decisions": notes.decisions.len(),
                "actions": notes.actions.iter().map(|a| json!({"text": a.text, "done": a.done, "owner": a.owner, "due": a.due})).collect::<Vec<_>>(),
                "segments": segments,
            })
        })
        .collect();
    let dir = memosa_lib::vault_links::vault_directory().expect("directory");
    let entities: Vec<_> = dir.entities.iter().map(|r| json!({
        "kind": r.entity.kind, "name": r.entity.name, "aliases": r.entity.aliases,
        "account": r.entity.account, "count": r.count,
    })).collect();
    let tags: Vec<_> = dir.tags.iter().map(|t| json!({"name": t.name, "count": t.count})).collect();
    let searches: Vec<_> = std::env::args().skip(1).map(|q| {
        let mut ids: Vec<String> = memosa_lib::vault_search::search_in(&v, &q, "exact", None).into_iter().map(|h| h.conv).collect();
        ids.sort();
        json!({"query": q, "hits": ids})
    }).collect();
    println!("{}", serde_json::to_string_pretty(&json!({
        "conversations": convs, "entities": entities, "tags": tags, "searches": searches,
    })).unwrap());
}
