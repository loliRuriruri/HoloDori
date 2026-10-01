use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SteamDetectionSource {
    Registry,
    LibraryFolders,
    CommonDefault,
    ManualFallback,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SteamDetectionResult {
    pub found: bool,
    pub install_path: Option<String>,
    pub octocache_path: Option<String>,
    pub source: Option<SteamDetectionSource>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCatalogEntry {
    pub asset_name: String,
    pub object_name: String,
    pub character_id: String,
    pub style: String,
    pub outfit_token: String,
    pub size_bytes: u64,
    pub md5: String,
    pub is_cached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MotionCatalogEntry {
    pub asset_name: String,
    pub object_name: String,
    pub name: String,
    pub category: String,
    pub size_bytes: u64,
    pub md5: String,
    pub is_cached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExpressionCatalogEntry {
    pub asset_name: String,
    pub object_name: String,
    pub name: String,
    pub character_id: String,
    pub outfit_token: String,
    pub size_bytes: u64,
    pub md5: String,
    pub is_cached: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelAnimationMetadata {
    pub character_id: String,
    pub expressions: Vec<ExpressionCatalogEntry>,
    pub motions: Vec<MotionCatalogEntry>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportPhase {
    Idle,
    Downloading,
    Verifying,
    Extracting,
    BuildingManifest,
    Validating,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportProgress {
    pub total_models: usize,
    pub current_model_index: usize,
    pub current_model_name: String,
    pub phase: ImportPhase,
    pub bytes_received: u64,
    pub bytes_total: u64,
    pub overall_percentage: f32,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportedModelSummary {
    pub asset_name: String,
    pub character_id: String,
    pub outfit_id: String,
    pub moc3_file: String,
    pub textures: Vec<String>,
    pub manifest_file: String,
    pub output_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FailedModelSummary {
    pub asset_name: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportExecutionResult {
    pub succeeded: Vec<ImportedModelSummary>,
    pub failed: Vec<FailedModelSummary>,
    pub total_processed: usize,
    pub cancelled: bool,
}

/// Extracted intermediate representation before pipeline build.
#[derive(Debug, Clone)]
pub struct ExtractedLive2DAsset {
    pub asset_name: String,
    pub model_name: String,
    pub character_id: String,
    pub outfit_id: String,
    pub moc3_bytes: Vec<u8>,
    pub textures: Vec<ExtractedTexture>,
}

#[derive(Debug, Clone)]
pub struct ExtractedTexture {
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub png_bytes: Vec<u8>,
}
