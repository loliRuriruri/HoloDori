use std::fs::File;
use std::io::{BufReader, Write};
use std::path::{Path, PathBuf};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;

use crate::domain::error::{DomainError, ErrorCode};

pub const MOC3_MAGIC: &[u8; 4] = b"MOC3";
pub const MIN_MOC3_SIZE_BYTES: usize = 64;

#[derive(Debug, Clone)]
pub struct ExtractedBinary {
    pub bytes: Vec<u8>,
    pub temp_path: PathBuf,
    pub sha256: String,
    pub version: u8,
}

/// Recursively traverses a JSON Value looking for any key named `_bytes` with an array value.
fn find_bytes_arrays<'a>(val: &'a Value, found: &mut Vec<&'a Vec<Value>>) {
    match val {
        Value::Object(map) => {
            for (k, v) in map {
                if k == "_bytes" {
                    if let Value::Array(arr) = v {
                        found.push(arr);
                    }
                } else {
                    find_bytes_arrays(v, found);
                }
            }
        }
        Value::Array(arr) => {
            for item in arr {
                find_bytes_arrays(item, found);
            }
        }
        _ => {}
    }
}

/// Extracts the raw binary bytes from a JSON resource file containing `_bytes`.
/// Never clamps or silently truncates invalid values.
pub fn extract_bytes(json_path: &Path) -> Result<Vec<u8>, DomainError> {
    let file = File::open(json_path).map_err(|e| DomainError::IoError {
        code: ErrorCode::ErrIo,
        path: json_path.to_path_buf(),
        message: e.to_string(),
    })?;

    let reader = BufReader::new(file);
    let json_val: Value = serde_json::from_reader(reader).map_err(|e| DomainError::JsonSyntaxError {
        code: ErrorCode::ErrJsonSyntax,
        path: json_path.to_path_buf(),
        message: e.to_string(),
    })?;

    let mut found = Vec::new();
    find_bytes_arrays(&json_val, &mut found);

    if found.is_empty() {
        return Err(DomainError::NoBytesFound {
            code: ErrorCode::ErrNoBytesFound,
            path: json_path.to_path_buf(),
        });
    }

    if found.len() > 1 {
        return Err(DomainError::MultipleBytesCandidates {
            code: ErrorCode::ErrMultipleBytesCandidates,
            path: json_path.to_path_buf(),
            count: found.len(),
        });
    }

    let raw_arr = found[0];
    let mut bytes = Vec::with_capacity(raw_arr.len());

    for (index, item) in raw_arr.iter().enumerate() {
        match item {
            Value::Number(num) => {
                if let Some(val_i64) = num.as_i64() {
                    if (0..=255).contains(&val_i64) {
                        bytes.push(val_i64 as u8);
                    } else {
                        return Err(DomainError::InvalidByteValue {
                            code: ErrorCode::ErrInvalidByteValue,
                            path: json_path.to_path_buf(),
                            index,
                            value: val_i64,
                        });
                    }
                } else if let Some(val_u64) = num.as_u64() {
                    if val_u64 <= 255 {
                        bytes.push(val_u64 as u8);
                    } else {
                        return Err(DomainError::InvalidByteValue {
                            code: ErrorCode::ErrInvalidByteValue,
                            path: json_path.to_path_buf(),
                            index,
                            value: val_u64 as i64,
                        });
                    }
                } else {
                    return Err(DomainError::MalformedBytesArray {
                        code: ErrorCode::ErrMalformedBytesArray,
                        path: json_path.to_path_buf(),
                        index,
                        details: format!("non-integer float number: {}", num),
                    });
                }
            }
            other => {
                return Err(DomainError::MalformedBytesArray {
                    code: ErrorCode::ErrMalformedBytesArray,
                    path: json_path.to_path_buf(),
                    index,
                    details: format!("expected byte integer, found {:?}", other),
                });
            }
        }
    }

    Ok(bytes)
}

/// Validates binary candidate against confirmed Live2D Cubism MOC3 specifications:
/// - Minimum payload length (>= 64 bytes)
/// - MOC3 magic bytes (ASCII: "MOC3")
/// - Supported Cubism version byte (0x01..=0x06)
pub fn validate_moc3_candidate(bytes: &[u8], path_context: &Path) -> Result<u8, DomainError> {
    if bytes.len() < MIN_MOC3_SIZE_BYTES {
        return Err(DomainError::InvalidMocHeader {
            code: ErrorCode::ErrMocHeaderInvalid,
            path: path_context.to_path_buf(),
            reason: format!(
                "Payload size ({} bytes) is smaller than minimum MOC3 header ({} bytes)",
                bytes.len(),
                MIN_MOC3_SIZE_BYTES
            ),
        });
    }

    if &bytes[0..4] != MOC3_MAGIC {
        return Err(DomainError::InvalidMocHeader {
            code: ErrorCode::ErrMocHeaderInvalid,
            path: path_context.to_path_buf(),
            reason: format!(
                "Invalid magic header: expected {:?}, got {:?}",
                MOC3_MAGIC,
                &bytes[0..4]
            ),
        });
    }

    let version = bytes[4];
    if !(1..=6).contains(&version) {
        return Err(DomainError::InvalidMocHeader {
            code: ErrorCode::ErrMocHeaderInvalid,
            path: path_context.to_path_buf(),
            reason: format!("Unsupported Cubism version byte: 0x{:02x}", version),
        });
    }

    Ok(version)
}

/// Complete safe extraction and staging pipeline:
/// 1. Extracts bytes from JSON
/// 2. Validates MOC3 candidate header
/// 3. Writes to temporary file
/// 4. Never overwrites or modifies source file
pub fn extract_and_stage_moc(json_path: &Path) -> Result<ExtractedBinary, DomainError> {
    let bytes = extract_bytes(json_path)?;
    let version = validate_moc3_candidate(&bytes, json_path)?;

    let mut temp_file = NamedTempFile::new().map_err(|e| DomainError::IoError {
        code: ErrorCode::ErrIo,
        path: json_path.to_path_buf(),
        message: format!("Failed to create temp file: {}", e),
    })?;

    temp_file.write_all(&bytes).map_err(|e| DomainError::IoError {
        code: ErrorCode::ErrIo,
        path: json_path.to_path_buf(),
        message: format!("Failed to write to temp file: {}", e),
    })?;

    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    let sha256 = format!("{:x}", hasher.finalize());

    // Keep temp file alive and get path
    let (_, path) = temp_file.keep().map_err(|e| DomainError::IoError {
        code: ErrorCode::ErrIo,
        path: json_path.to_path_buf(),
        message: format!("Failed to persist temp file: {}", e),
    })?;

    Ok(ExtractedBinary {
        bytes,
        temp_path: path,
        sha256,
        version,
    })
}
