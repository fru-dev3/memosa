use super::StorageProvider;
use crate::types::{ExportAssetType, ExportRequest, ExportResult};
use serde_json::json;

pub struct LocalStubProvider;

impl StorageProvider for LocalStubProvider {
    fn id(&self) -> &'static str {
        "local_stub"
    }

    fn export(&self, request: &ExportRequest, context: &crate::export::ExportContext) -> Result<ExportResult, String> {
        std::fs::create_dir_all(&context.output_dir)
            .map_err(|e| format!("Failed to create export output directory: {}", e))?;

        let export_path = context
            .output_dir
            .join(format!("{}-export.json", context.meeting.id));

        let transcript = context.transcript.as_ref().map(|text| {
            if request.asset_types.contains(&ExportAssetType::Transcript) {
                text.clone()
            } else {
                String::new()
            }
        });

        let payload = json!({
            "meeting": context.meeting,
            "requested_assets": request.asset_types,
            "audio_path": request.asset_types.contains(&ExportAssetType::Audio).then_some(&context.meeting.audio_path),
            "transcript": transcript,
            "summary": request.asset_types.contains(&ExportAssetType::Summary).then_some(&context.meeting.summary),
            "metadata_path": request.asset_types.contains(&ExportAssetType::Metadata).then_some(context.folder.join("metadata.json").to_string_lossy().into_owned()),
            "note": "Local stub export. This validates export packaging without sending data to an external provider.",
        });

        let json = serde_json::to_string_pretty(&payload)
            .map_err(|e| format!("Failed to serialize export payload: {}", e))?;
        std::fs::write(&export_path, json)
            .map_err(|e| format!("Failed to write export payload: {}", e))?;

        Ok(ExportResult {
            provider_id: self.id().to_string(),
            output_path: Some(export_path.to_string_lossy().into_owned()),
            exported_assets: request.asset_types.clone(),
            note: "Saved a local stub export bundle. Cloud providers are not active yet.".to_string(),
        })
    }
}
