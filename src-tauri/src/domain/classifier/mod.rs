use std::fs::File;
use std::io::BufReader;
use serde_json::Value;

use crate::domain::error::{DomainError, ErrorCode};
use crate::domain::types::{FileClassification, ScannedFile};

pub fn classify_file(scanned: &mut ScannedFile) -> Result<(), DomainError> {
    match scanned.classification {
        FileClassification::OtherJson => {
            // Check if this JSON contains a `_bytes` key
            let file = File::open(&scanned.path).map_err(|e| DomainError::IoError {
                code: ErrorCode::ErrIo,
                path: scanned.path.clone(),
                message: e.to_string(),
            })?;

            let reader = BufReader::new(file);
            let json_val: Value = serde_json::from_reader(reader).map_err(|e| DomainError::JsonSyntaxError {
                code: ErrorCode::ErrJsonSyntax,
                path: scanned.path.clone(),
                message: e.to_string(),
            })?;

            if contains_bytes_candidate(&json_val) {
                scanned.classification = FileClassification::ModelResourceJson;
            }
        }
        _ => {}
    }
    Ok(())
}

pub fn classify_all(files: &mut [ScannedFile]) -> Result<(), DomainError> {
    for file in files.iter_mut() {
        if file.classification == FileClassification::OtherJson {
            // Silently allow JSON syntax errors during classification to mark as OtherJson
            // or let extractor catch it strictly when targeted.
            if let Ok(file_handle) = File::open(&file.path) {
                let reader = BufReader::new(file_handle);
                if let Ok(json_val) = serde_json::from_reader::<_, Value>(reader) {
                    if contains_bytes_candidate(&json_val) {
                        file.classification = FileClassification::ModelResourceJson;
                    }
                }
            }
        }
    }
    Ok(())
}

fn contains_bytes_candidate(val: &Value) -> bool {
    match val {
        Value::Object(map) => {
            for (k, v) in map {
                if k == "_bytes" && v.is_array() {
                    return true;
                }
                if contains_bytes_candidate(v) {
                    return true;
                }
            }
            false
        }
        Value::Array(arr) => {
            for item in arr {
                if contains_bytes_candidate(item) {
                    return true;
                }
            }
            false
        }
        _ => false,
    }
}
