use regex::Regex;
use std::fs;
use std::path::Path;
use tracing::{debug, info};

use super::cache::ImporterCacheManager;
use super::types::ModelCatalogEntry;
use crate::domain::error::{DomainError, ErrorCode};
use crate::domain::octo::parse_octocache_bytes;

pub struct CatalogLoader;

impl CatalogLoader {
    /// Loads and filters Live2D model assets from an `octocacheevai` file.
    pub fn load_from_file(
        octocache_path: &Path,
        cache_manager: &ImporterCacheManager,
    ) -> Result<Vec<ModelCatalogEntry>, DomainError> {
        info!(
            "Loading HoloDori catalog from: {}",
            octocache_path.display()
        );
        let data = fs::read(octocache_path).map_err(|e| {
            DomainError::io(
                octocache_path,
                format!(
                    "Failed to read octocache file {}: {e}",
                    octocache_path.display()
                ),
            )
        })?;

        Self::load_from_bytes(&data, cache_manager)
    }

    /// Parses octocache bytes and extracts `live2d_mdl_*` catalog entries.
    pub fn load_from_bytes(
        data: &[u8],
        cache_manager: &ImporterCacheManager,
    ) -> Result<Vec<ModelCatalogEntry>, DomainError> {
        let db = parse_octocache_bytes(data).map_err(|e| {
            DomainError::importer(
                ErrorCode::ErrCorruptedData,
                format!("Octocache parse error: {e}"),
            )
        })?;
        debug!(
            "Octocache revision: {}, total bundles: {}",
            db.revision_id,
            db.asset_bundles.len()
        );

        // Pattern for live2d_mdl_{char}-{style}-{outfit_code}-{seq}
        // e.g. live2d_mdl_00007-nrml-0008-00
        let re = Regex::new(r"^live2d_mdl_(?P<char>\d{5})(?:-(?P<style>[a-zA-Z]+))?(?:-(?P<outfit>[0-9a-zA-Z_-]+))?$")
            .map_err(|e| DomainError::importer(ErrorCode::ErrImporterFailed, format!("Invalid catalog regex: {e}")))?;

        let mut entries = Vec::new();

        for item in db.asset_bundles {
            if !item.name.starts_with("live2d_mdl_") {
                continue;
            }

            let mut char_id = String::new();
            let mut style = "nrml".to_string();
            let mut outfit_token = String::new();

            if let Some(caps) = re.captures(&item.name) {
                if let Some(c) = caps.name("char") {
                    char_id = c.as_str().to_string();
                }
                if let Some(s) = caps.name("style") {
                    style = s.as_str().to_string();
                }
                if let Some(o) = caps.name("outfit") {
                    outfit_token = o.as_str().to_string();
                }
            } else {
                // Fallback for non-standard naming
                char_id = item
                    .name
                    .chars()
                    .filter(|c| c.is_ascii_digit())
                    .take(5)
                    .collect();
            }

            let is_cached = cache_manager.is_bundle_cached(&item.object_name, &item.md5);

            entries.push(ModelCatalogEntry {
                asset_name: item.name,
                object_name: item.object_name,
                character_id: char_id,
                style,
                outfit_token,
                size_bytes: item.size as u64,
                md5: item.md5,
                is_cached,
            });
        }

        // Sort deterministically: by character_id asc, then style asc, then asset_name asc
        entries.sort_by(|a, b| {
            a.character_id
                .cmp(&b.character_id)
                .then_with(|| a.style.cmp(&b.style))
                .then_with(|| a.asset_name.cmp(&b.asset_name))
        });

        info!(
            "Discovered {} Live2D model assets in catalog",
            entries.len()
        );
        Ok(entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::octo::{build_synthetic_octocache, OctoItem};
    use tempfile::tempdir;

    #[test]
    fn test_catalog_loader_synthetic() {
        let dir = tempdir().unwrap();
        let cache = ImporterCacheManager::with_root(dir.path().join("cache"));
        cache.ensure_dirs().unwrap();

        let items = vec![
            OctoItem {
                id: 1,
                name: "live2d_mdl_00010-uniq-0069-00".to_string(),
                object_name: "Cfywj9".to_string(),
                size: 4084627,
                crc: 0,
                md5: "5cae6384d2502c8968d5461455ba91e1".to_string(),
                dependencies: vec![],
                addresses: vec![],
            },
            OctoItem {
                id: 2,
                name: "live2d_mdl_00007-nrml-0008-00".to_string(),
                object_name: "DCgZ7m".to_string(),
                size: 3265045,
                crc: 0,
                md5: "a163f3d6bfb59ba534ab1afbd3896120".to_string(),
                dependencies: vec![],
                addresses: vec![],
            },
            OctoItem {
                id: 3,
                name: "live2d_mot_00007-idle-01".to_string(), // Motion: should be filtered out
                object_name: "mot_obj".to_string(),
                size: 1024,
                crc: 0,
                md5: "abc".to_string(),
                dependencies: vec![],
                addresses: vec![],
            },
            OctoItem {
                id: 4,
                name: "bg_stage_01".to_string(), // Unrelated asset
                object_name: "bg_obj".to_string(),
                size: 2048,
                crc: 0,
                md5: "def".to_string(),
                dependencies: vec![],
                addresses: vec![],
            },
        ];

        let payload =
            build_synthetic_octocache(20, "https://asset.example.com/{objectName}", &items);
        let catalog = CatalogLoader::load_from_bytes(&payload, &cache).unwrap();

        assert_eq!(catalog.len(), 2);
        // Sorted by char_id: 00007 first, then 00010
        assert_eq!(catalog[0].character_id, "00007");
        assert_eq!(catalog[0].asset_name, "live2d_mdl_00007-nrml-0008-00");
        assert_eq!(catalog[0].style, "nrml");
        assert_eq!(catalog[0].outfit_token, "0008-00");
        assert_eq!(catalog[0].size_bytes, 3265045);
        assert!(!catalog[0].is_cached);

        assert_eq!(catalog[1].character_id, "00010");
        assert_eq!(catalog[1].asset_name, "live2d_mdl_00010-uniq-0069-00");
        assert_eq!(catalog[1].style, "uniq");
        assert_eq!(catalog[1].outfit_token, "0069-00");
    }
}
