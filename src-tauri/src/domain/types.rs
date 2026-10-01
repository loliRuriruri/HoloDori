use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum FileClassification {
    ModelResourceJson,
    TextureImage,
    RawMoc,
    OtherJson,
    Ignored,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedFile {
    pub path: PathBuf,
    pub relative_path: PathBuf,
    pub file_name: String,
    pub size_bytes: u64,
    pub sha256: String,
    pub classification: FileClassification,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum ConflictPolicy {
    #[default]
    Skip,
    UniqueSuffix,
    Overwrite,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum MatchConfidence {
    NoMatch,
    Ambiguous,
    High,
    Exact,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedIdentity {
    pub character_id: String,
    pub outfit_id: String,
    pub style_tag: Option<String>,
    pub confidence: MatchConfidence,
    pub evidence: Vec<String>,
    pub source_stem: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ModelSourceType {
    JsonBytes,
    RawMoc,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MatchedPair {
    pub id: String,
    pub model_source: PathBuf,
    pub model_type: ModelSourceType,
    pub identity: ParsedIdentity,
    pub textures: Vec<PathBuf>,
    pub match_confidence: MatchConfidence,
    pub evidence: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationStageResult {
    pub stage_name: String,
    pub passed: bool,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BuildStatus {
    Pass,
    PassWithWarnings,
    Fail,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelBuildReport {
    pub model_id: String,
    pub status: BuildStatus,
    pub input_files: Vec<PathBuf>,
    pub output_files: Vec<PathBuf>,
    pub output_directory: Option<PathBuf>,
    pub validation_stages: Vec<ValidationStageResult>,
    pub warnings: Vec<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BatchBuildReport {
    pub total_models: usize,
    pub passed: usize,
    pub passed_with_warnings: usize,
    pub failed: usize,
    pub reports: Vec<ModelBuildReport>,
    pub overall_status: BuildStatus,
}
