pub mod local_stub;

use crate::types::{ExportRequest, ExportResult};

pub trait StorageProvider {
    fn id(&self) -> &'static str;
    fn export(&self, request: &ExportRequest, context: &crate::export::ExportContext) -> Result<ExportResult, String>;
}
