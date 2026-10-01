use md5::{Digest, Md5};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use tracing::info;

use crate::domain::error::DomainError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CacheStats {
    pub cached_bundles_count: usize,
    pub total_bytes: u64,
    pub cache_directory: String,
}

pub struct ImporterCacheManager {
    cache_root: PathBuf,
}

impl Default for ImporterCacheManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ImporterCacheManager {
    pub fn new() -> Self {
        let base = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir)
            .join("HoloDoriLive2DManager")
            .join("cache");
        Self { cache_root: base }
    }

    pub fn with_root(root: impl AsRef<Path>) -> Self {
        Self {
            cache_root: root.as_ref().to_path_buf(),
        }
    }

    pub fn cache_root(&self) -> &Path {
        &self.cache_root
    }

    pub fn bundles_dir(&self) -> PathBuf {
        self.cache_root.join("bundles")
    }

    pub fn ensure_dirs(&self) -> Result<(), DomainError> {
        let dir = self.bundles_dir();
        fs::create_dir_all(&dir).map_err(|e| {
            DomainError::io(
                &dir,
                format!("Failed to create bundle cache directory: {e}"),
            )
        })
    }

    pub fn get_bundle_path(&self, object_name: &str) -> PathBuf {
        self.bundles_dir().join(object_name)
    }

    pub fn is_bundle_cached(&self, object_name: &str, expected_md5: &str) -> bool {
        let path = self.get_bundle_path(object_name);
        if !path.is_file() {
            return false;
        }

        let Ok(bytes) = fs::read(&path) else {
            return false;
        };

        let mut hasher = Md5::new();
        hasher.update(&bytes);
        let actual_md5 = format!("{:x}", hasher.finalize());

        actual_md5.eq_ignore_ascii_case(expected_md5)
    }

    pub fn get_stats(&self) -> CacheStats {
        let bundles = self.bundles_dir();
        let mut count = 0;
        let mut total_bytes = 0;

        if let Ok(entries) = fs::read_dir(&bundles) {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    if meta.is_file() {
                        count += 1;
                        total_bytes += meta.len();
                    }
                }
            }
        }

        CacheStats {
            cached_bundles_count: count,
            total_bytes,
            cache_directory: self.cache_root.to_string_lossy().to_string(),
        }
    }

    pub fn clear_cache(&self) -> Result<u64, DomainError> {
        let stats = self.get_stats();
        let bundles = self.bundles_dir();
        if bundles.exists() {
            fs::remove_dir_all(&bundles).map_err(|e| {
                DomainError::io(
                    &bundles,
                    format!("Failed to clear bundle cache directory: {e}"),
                )
            })?;
        }
        self.ensure_dirs()?;
        info!("Cleared {} bytes from bundle cache", stats.total_bytes);
        Ok(stats.total_bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_cache_manager() {
        let dir = tempdir().unwrap();
        let cache = ImporterCacheManager::with_root(dir.path().join("cache"));
        cache.ensure_dirs().unwrap();

        let obj_name = "test_bundle_123";
        let content = b"bundle content";
        let mut hasher = Md5::new();
        hasher.update(content);
        let expected_md5 = format!("{:x}", hasher.finalize());

        assert!(!cache.is_bundle_cached(obj_name, &expected_md5));

        let bundle_path = cache.get_bundle_path(obj_name);
        fs::write(&bundle_path, content).unwrap();

        assert!(cache.is_bundle_cached(obj_name, &expected_md5));
        assert!(!cache.is_bundle_cached(obj_name, "wrongmd5"));

        let stats = cache.get_stats();
        assert_eq!(stats.cached_bundles_count, 1);
        assert_eq!(stats.total_bytes, content.len() as u64);

        let reclaimed = cache.clear_cache().unwrap();
        assert_eq!(reclaimed, content.len() as u64);
        assert_eq!(cache.get_stats().cached_bundles_count, 0);
    }
}
