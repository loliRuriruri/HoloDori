use std::fs::File;
use std::io::Read;
use std::path::Path;
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use crate::domain::error::{DomainError, ErrorCode};
use crate::domain::types::{FileClassification, ScannedFile};

pub const DEFAULT_MAX_FILE_SIZE_BYTES: u64 = 500 * 1024 * 1024; // 500 MB safety cap

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct ScannerOptions {
    pub recursive: bool,
    pub max_file_size_bytes: u64,
}

impl Default for ScannerOptions {
    fn default() -> Self {
        Self {
            recursive: true,
            max_file_size_bytes: DEFAULT_MAX_FILE_SIZE_BYTES,
        }
    }
}

pub fn compute_sha256(path: &Path) -> Result<String, DomainError> {
    let mut file = File::open(path).map_err(|e| DomainError::IoError {
        code: ErrorCode::ErrIo,
        path: path.to_path_buf(),
        message: e.to_string(),
    })?;

    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let n = file.read(&mut buffer).map_err(|e| DomainError::IoError {
            code: ErrorCode::ErrIo,
            path: path.to_path_buf(),
            message: e.to_string(),
        })?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

/// Scans given paths (files or directories) and returns a list of candidate files.
/// Source files are NEVER modified.
pub fn scan_paths<P: AsRef<Path>>(
    paths: &[P],
    options: &ScannerOptions,
) -> Result<Vec<ScannedFile>, DomainError> {
    let mut results = Vec::new();

    for p in paths {
        let target_path = p.as_ref();
        if !target_path.exists() {
            return Err(DomainError::IoError {
                code: ErrorCode::ErrIo,
                path: target_path.to_path_buf(),
                message: "Target path does not exist".to_string(),
            });
        }

        if target_path.is_file() {
            if let Some(scanned) = scan_single_file(target_path, target_path.parent().unwrap_or(target_path), options)? {
                results.push(scanned);
            }
        } else if target_path.is_dir() {
            let max_depth = if options.recursive { usize::MAX } else { 1 };
            for entry in WalkDir::new(target_path)
                .max_depth(max_depth)
                .into_iter()
                .filter_entry(|e| !is_hidden(e))
            {
                let entry = entry.map_err(|e| DomainError::IoError {
                    code: ErrorCode::ErrIo,
                    path: target_path.to_path_buf(),
                    message: e.to_string(),
                })?;

                if entry.file_type().is_file() {
                    if let Some(scanned) = scan_single_file(entry.path(), target_path, options)? {
                        results.push(scanned);
                    }
                }
            }
        }
    }

    Ok(results)
}

fn is_hidden(entry: &walkdir::DirEntry) -> bool {
    if entry.depth() == 0 {
        return false;
    }
    entry.file_name()
        .to_str()
        .map(|s| s.starts_with('.'))
        .unwrap_or(false)
}

fn scan_single_file(
    path: &Path,
    base_dir: &Path,
    options: &ScannerOptions,
) -> Result<Option<ScannedFile>, DomainError> {
    let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let classification = match ext.as_str() {
        "json" => FileClassification::OtherJson, // Will be refined by classifier
        "png" => FileClassification::TextureImage,
        "moc3" => FileClassification::RawMoc,
        _ => return Ok(None), // Non-candidate extension
    };

    let metadata = std::fs::metadata(path).map_err(|e| DomainError::IoError {
        code: ErrorCode::ErrIo,
        path: path.to_path_buf(),
        message: e.to_string(),
    })?;

    let size = metadata.len();
    if size > options.max_file_size_bytes {
        return Err(DomainError::MaxSizeExceeded {
            code: ErrorCode::ErrMaxSizeExceeded,
            path: path.to_path_buf(),
            limit_bytes: options.max_file_size_bytes,
        });
    }

    let sha256 = compute_sha256(path)?;
    let relative_path = path.strip_prefix(base_dir).unwrap_or(path).to_path_buf();
    let file_name = path.file_name().and_then(|f| f.to_str()).unwrap_or("").to_string();

    Ok(Some(ScannedFile {
        path: path.to_path_buf(),
        relative_path,
        file_name,
        size_bytes: size,
        sha256,
        classification,
    }))
}
