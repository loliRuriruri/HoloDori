use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ErrorCode {
    ErrIo,
    ErrJsonSyntax,
    ErrNoBytesFound,
    ErrInvalidByteValue,
    ErrMalformedBytesArray,
    ErrMultipleBytesCandidates,
    ErrMocHeaderInvalid,
    ErrTextureNotFound,
    ErrTextureAmbiguous,
    ErrAmbiguousNaming,
    ErrPathTraversalDetected,
    ErrOutputCollision,
    ErrManifestInvalid,
    ErrSourceIntegrityFailed,
    ErrMaxSizeExceeded,
    ErrValidationFailed,
}

impl ErrorCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            ErrorCode::ErrIo => "ERR_IO",
            ErrorCode::ErrJsonSyntax => "ERR_JSON_SYNTAX",
            ErrorCode::ErrNoBytesFound => "ERR_NO_BYTES_FOUND",
            ErrorCode::ErrInvalidByteValue => "ERR_INVALID_BYTE_VALUE",
            ErrorCode::ErrMalformedBytesArray => "ERR_MALFORMED_BYTES_ARRAY",
            ErrorCode::ErrMultipleBytesCandidates => "ERR_MULTIPLE_BYTES_CANDIDATES",
            ErrorCode::ErrMocHeaderInvalid => "ERR_MOC_HEADER_INVALID",
            ErrorCode::ErrTextureNotFound => "ERR_TEXTURE_NOT_FOUND",
            ErrorCode::ErrTextureAmbiguous => "ERR_TEXTURE_AMBIGUOUS",
            ErrorCode::ErrAmbiguousNaming => "ERR_AMBIGUOUS_NAMING",
            ErrorCode::ErrPathTraversalDetected => "ERR_PATH_TRAVERSAL_DETECTED",
            ErrorCode::ErrOutputCollision => "ERR_OUTPUT_COLLISION",
            ErrorCode::ErrManifestInvalid => "ERR_MANIFEST_INVALID",
            ErrorCode::ErrSourceIntegrityFailed => "ERR_SOURCE_INTEGRITY_FAILED",
            ErrorCode::ErrMaxSizeExceeded => "ERR_MAX_SIZE_EXCEEDED",
            ErrorCode::ErrValidationFailed => "ERR_VALIDATION_FAILED",
        }
    }
}

#[derive(Error, Debug, Clone, Serialize, Deserialize)]
pub enum DomainError {
    #[error("[{code}] I/O error on {path}: {message}", code = .code.as_str())]
    IoError {
        code: ErrorCode,
        path: PathBuf,
        message: String,
    },

    #[error("[{code}] JSON parse error in {path}: {message}", code = .code.as_str())]
    JsonSyntaxError {
        code: ErrorCode,
        path: PathBuf,
        message: String,
    },

    #[error("[{code}] No valid '_bytes' array found in {path}", code = .code.as_str())]
    NoBytesFound {
        code: ErrorCode,
        path: PathBuf,
    },

    #[error("[{code}] Invalid byte value {value} at index {index} in {path} (must be 0..=255)", code = .code.as_str())]
    InvalidByteValue {
        code: ErrorCode,
        path: PathBuf,
        index: usize,
        value: i64,
    },

    #[error("[{code}] Malformed '_bytes' array in {path} at index {index}: {details}", code = .code.as_str())]
    MalformedBytesArray {
        code: ErrorCode,
        path: PathBuf,
        index: usize,
        details: String,
    },

    #[error("[{code}] Multiple candidate '_bytes' arrays found ({count}) in {path}", code = .code.as_str())]
    MultipleBytesCandidates {
        code: ErrorCode,
        path: PathBuf,
        count: usize,
    },

    #[error("[{code}] Invalid MOC3 binary header in {path}: {reason}", code = .code.as_str())]
    InvalidMocHeader {
        code: ErrorCode,
        path: PathBuf,
        reason: String,
    },

    #[error("[{code}] No texture image matching model {model_name}", code = .code.as_str())]
    TextureNotFound {
        code: ErrorCode,
        model_name: String,
    },

    #[error("[{code}] Ambiguous texture matches for model {model_name}: {candidates:?}", code = .code.as_str())]
    TextureAmbiguous {
        code: ErrorCode,
        model_name: String,
        candidates: Vec<PathBuf>,
    },

    #[error("[{code}] Ambiguous or unparseable naming pattern in {name}: {reason}", code = .code.as_str())]
    AmbiguousNaming {
        code: ErrorCode,
        name: String,
        reason: String,
    },

    #[error("[{code}] Path traversal attempt detected: {path}", code = .code.as_str())]
    PathTraversalDetected {
        code: ErrorCode,
        path: PathBuf,
    },

    #[error("[{code}] Output target already exists: {path}", code = .code.as_str())]
    OutputCollision {
        code: ErrorCode,
        path: PathBuf,
    },

    #[error("[{code}] Manifest validation failed for {manifest_path}: {reason}", code = .code.as_str())]
    ManifestInvalid {
        code: ErrorCode,
        manifest_path: PathBuf,
        reason: String,
    },

    #[error("[{code}] Source file integrity compromised for {path} (checksum mismatch)", code = .code.as_str())]
    SourceIntegrityFailed {
        code: ErrorCode,
        path: PathBuf,
    },

    #[error("[{code}] File {path} exceeds maximum configured size limit of {limit_bytes} bytes", code = .code.as_str())]
    MaxSizeExceeded {
        code: ErrorCode,
        path: PathBuf,
        limit_bytes: u64,
    },

    #[error("[{code}] Validation failed: {stage}: {reason}", code = .code.as_str())]
    ValidationFailed {
        code: ErrorCode,
        stage: String,
        reason: String,
    },
}

impl DomainError {
    pub fn code(&self) -> ErrorCode {
        match self {
            DomainError::IoError { code, .. } => *code,
            DomainError::JsonSyntaxError { code, .. } => *code,
            DomainError::NoBytesFound { code, .. } => *code,
            DomainError::InvalidByteValue { code, .. } => *code,
            DomainError::MalformedBytesArray { code, .. } => *code,
            DomainError::MultipleBytesCandidates { code, .. } => *code,
            DomainError::InvalidMocHeader { code, .. } => *code,
            DomainError::TextureNotFound { code, .. } => *code,
            DomainError::TextureAmbiguous { code, .. } => *code,
            DomainError::AmbiguousNaming { code, .. } => *code,
            DomainError::PathTraversalDetected { code, .. } => *code,
            DomainError::OutputCollision { code, .. } => *code,
            DomainError::ManifestInvalid { code, .. } => *code,
            DomainError::SourceIntegrityFailed { code, .. } => *code,
            DomainError::MaxSizeExceeded { code, .. } => *code,
            DomainError::ValidationFailed { code, .. } => *code,
        }
    }
}
