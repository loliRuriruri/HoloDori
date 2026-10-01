use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use crate::domain::error::DomainError;
use crate::domain::types::{FileClassification, ScannedFile};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CachedFileEntry {
    pub path: PathBuf,
    pub relative_path: PathBuf,
    pub file_name: String,
    pub size_bytes: u64,
    pub modified_unix_secs: u64,
    pub sha256: String,
    pub classification: FileClassification,
}

impl From<&CachedFileEntry> for ScannedFile {
    fn from(cached: &CachedFileEntry) -> Self {
        Self {
            path: cached.path.clone(),
            relative_path: cached.relative_path.clone(),
            file_name: cached.file_name.clone(),
            size_bytes: cached.size_bytes,
            sha256: cached.sha256.clone(),
            classification: cached.classification.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LibraryScanCache {
    pub version: u32,
    pub entries: HashMap<PathBuf, CachedFileEntry>,
}

impl LibraryScanCache {
    pub fn new() -> Self {
        Self {
            version: 1,
            entries: HashMap::new(),
        }
    }

    pub fn load_from_file(path: &Path) -> Self {
        if !path.exists() {
            return Self::new();
        }
        match fs::read_to_string(path) {
            Ok(content) => serde_json::from_str(&content).unwrap_or_else(|_| Self::new()),
            Err(_) => Self::new(),
        }
    }

    pub fn save_to_file(&self, path: &Path) -> Result<(), DomainError> {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let json =
            serde_json::to_string_pretty(self).map_err(|e| DomainError::JsonSyntaxError {
                code: crate::domain::error::ErrorCode::ErrJsonSyntax,
                path: path.to_path_buf(),
                message: e.to_string(),
            })?;
        let temp_path = path.with_extension("tmp");
        fs::write(&temp_path, &json).map_err(|e| DomainError::IoError {
            code: crate::domain::error::ErrorCode::ErrIo,
            path: temp_path.clone(),
            message: e.to_string(),
        })?;
        fs::rename(&temp_path, path).map_err(|e| DomainError::IoError {
            code: crate::domain::error::ErrorCode::ErrIo,
            path: path.to_path_buf(),
            message: e.to_string(),
        })?;
        Ok(())
    }

    pub fn lookup(
        &self,
        path: &Path,
        size_bytes: u64,
        mtime_secs: u64,
    ) -> Option<&CachedFileEntry> {
        if let Some(entry) = self.entries.get(path) {
            if entry.size_bytes == size_bytes && entry.modified_unix_secs == mtime_secs {
                return Some(entry);
            }
        }
        None
    }

    pub fn insert(&mut self, entry: CachedFileEntry) {
        self.entries.insert(entry.path.clone(), entry);
    }

    pub fn remove(&mut self, path: &Path) {
        self.entries.remove(path);
    }

    pub fn clear(&mut self) {
        self.entries.clear();
    }

    pub fn entry_count(&self) -> usize {
        self.entries.len()
    }

    /// Extract mtime unix seconds from path metadata safely.
    pub fn get_mtime_secs(path: &Path) -> u64 {
        fs::metadata(path)
            .and_then(|m| m.modified())
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }
}
