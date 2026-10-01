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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum MocVersion {
    /// Known official Live2D Cubism version (1..=5)
    Known(u8),
    /// Syntactically valid MOC3 with unverified/future version identifier
    Unknown(u8),
    /// Invalid candidate (missing magic or invalid header)
    #[default]
    Invalid,
}

impl MocVersion {
    pub fn from_header(bytes: &[u8]) -> Self {
        if bytes.len() < 5 || &bytes[0..4] != b"MOC3" {
            return MocVersion::Invalid;
        }
        match bytes[4] {
            1..=5 => MocVersion::Known(bytes[4]),
            raw if raw > 0 => MocVersion::Unknown(raw),
            _ => MocVersion::Invalid,
        }
    }

    pub fn version_label(&self) -> Option<&'static str> {
        match self {
            MocVersion::Known(1) => Some("Cubism 3.00"),
            MocVersion::Known(2) => Some("Cubism 3.03"),
            MocVersion::Known(3) => Some("Cubism 4.00"),
            MocVersion::Known(4) => Some("Cubism 4.02"),
            MocVersion::Known(5) => Some("Cubism 5.00"),
            _ => None,
        }
    }

    pub fn is_known(&self) -> bool {
        matches!(self, MocVersion::Known(_))
    }

    pub fn is_valid_candidate(&self) -> bool {
        !matches!(self, MocVersion::Invalid)
    }

    pub fn raw_byte(&self) -> Option<u8> {
        match self {
            MocVersion::Known(raw) => Some(*raw),
            MocVersion::Unknown(raw) => Some(*raw),
            MocVersion::Invalid => None,
        }
    }

    pub fn display_label(&self) -> String {
        match self {
            MocVersion::Known(raw) => {
                let label = self.version_label().unwrap_or("Cubism Known");
                format!("{} (0x{:02x})", label, raw)
            }
            MocVersion::Unknown(raw) => {
                format!("Unknown/Future Version (0x{:02x})", raw)
            }
            MocVersion::Invalid => "Invalid MOC3".to_string(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum RuntimeValidationStatus {
    #[default]
    NotTested,
    Pass,
    Fail,
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
    pub moc_version: MocVersion,
    pub runtime_validation: RuntimeValidationStatus,
    pub runtime_details: Option<String>,
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
