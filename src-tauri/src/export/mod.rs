pub mod providers;

use crate::storage::Database;
use crate::types::{ExportRequest, ExportResult};
use providers::local_stub::LocalStubProvider;
use providers::StorageProvider;
use std::path::PathBuf;

pub struct ExportContext {
    pub meeting: crate::types::Meeting,
    pub folder: PathBuf,
    pub transcript: Option<String>,
    pub output_dir: PathBuf,
}

fn build_export_context(request: &ExportRequest, db: &Database) -> Result<ExportContext, String> {
    let meeting = db
        .get_meeting(&request.meeting_id)?
        .ok_or_else(|| "Meeting not found".to_string())?;
    let folder = db
        .get_folder_path(&request.meeting_id)?
        .map(PathBuf::from)
        .ok_or_else(|| "Meeting folder not found".to_string())?;
    let transcript = meeting
        .transcript_path
        .as_ref()
        .and_then(|path| std::fs::read_to_string(path).ok());

    let output_dir = dirs::home_dir()
        .unwrap_or_default()
        .join(".memosa")
        .join("exports")
        .join(chrono::Local::now().format("%Y-%m").to_string());

    Ok(ExportContext {
        meeting,
        folder,
        transcript,
        output_dir,
    })
}

fn resolve_provider(id: &str) -> Result<Box<dyn StorageProvider>, String> {
    match id {
        "local_stub" => Ok(Box::new(LocalStubProvider)),
        "google_drive" | "box" | "dropbox" | "snowflake" | "supabase" | "mysql" | "postgresql" | "s3" | "webhook" => {
            Err(format!("{id} is not active yet. Use local_stub to validate export packaging."))
        }
        _ => Err(format!("Unknown export provider: {id}")),
    }
}

#[tauri::command]
pub async fn export_meeting_bundle(
    request: ExportRequest,
    db: tauri::State<'_, Database>,
) -> Result<ExportResult, String> {
    let context = build_export_context(&request, db.inner())?;
    let provider = resolve_provider(&request.provider_id)?;
    provider.export(&request, &context)
}
