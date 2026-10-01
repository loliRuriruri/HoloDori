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

    /// Parses octocache bytes and extracts `live2d_exp_*` catalog entries.
    pub fn load_expressions_from_bytes(
        data: &[u8],
        cache_manager: &ImporterCacheManager,
    ) -> Result<Vec<super::types::ExpressionCatalogEntry>, DomainError> {
        let db = parse_octocache_bytes(data).map_err(|e| {
            DomainError::importer(
                ErrorCode::ErrCorruptedData,
                format!("Octocache parse error: {e}"),
            )
        })?;

        // Pattern for live2d_exp_{name}_{charId}_{outfitToken}
        // e.g. live2d_exp_anger-01_00007_000
        let re = Regex::new(
            r"^live2d_exp_(?P<name>[a-zA-Z0-9-]+)_(?P<char>\d{5})_(?P<outfit>\d{3})(?:_test)?$",
        )
        .map_err(|e| {
            DomainError::importer(
                ErrorCode::ErrImporterFailed,
                format!("Invalid expression regex: {e}"),
            )
        })?;

        let re_fallback_char = Regex::new(r"\d{5}").map_err(|e| {
            DomainError::importer(
                ErrorCode::ErrImporterFailed,
                format!("Invalid fallback regex: {e}"),
            )
        })?;

        let mut entries = Vec::new();

        for item in db.asset_bundles {
            if !item.name.starts_with("live2d_exp_") {
                continue;
            }

            let mut name = item.name.trim_start_matches("live2d_exp_").to_string();
            let mut char_id = String::new();
            let mut outfit_token = "000".to_string();

            if let Some(caps) = re.captures(&item.name) {
                if let Some(n) = caps.name("name") {
                    name = n.as_str().to_string();
                }
                if let Some(c) = caps.name("char") {
                    char_id = c.as_str().to_string();
                }
                if let Some(o) = caps.name("outfit") {
                    outfit_token = o.as_str().to_string();
                }
            } else if let Some(m) = re_fallback_char.find(&item.name) {
                // Fallback for non-standard naming
                char_id = m.as_str().to_string();
            }

            let is_cached = cache_manager.is_bundle_cached(&item.object_name, &item.md5);

            entries.push(super::types::ExpressionCatalogEntry {
                asset_name: item.name,
                object_name: item.object_name,
                name,
                character_id: char_id,
                outfit_token,
                size_bytes: item.size as u64,
                md5: item.md5,
                is_cached,
            });
        }

        // Sort deterministically: by character_id asc, then name asc
        entries.sort_by(|a, b| {
            a.character_id
                .cmp(&b.character_id)
                .then_with(|| a.name.cmp(&b.name))
        });

        debug!(
            "Discovered {} Live2D expression assets in catalog",
            entries.len()
        );
        Ok(entries)
    }

    /// Parses octocache bytes and extracts `live2d_mot_*` catalog entries.
    pub fn load_motions_from_bytes(
        data: &[u8],
        cache_manager: &ImporterCacheManager,
    ) -> Result<Vec<super::types::MotionCatalogEntry>, DomainError> {
        let db = parse_octocache_bytes(data).map_err(|e| {
            DomainError::importer(
                ErrorCode::ErrCorruptedData,
                format!("Octocache parse error: {e}"),
            )
        })?;

        let mut entries = Vec::new();

        for item in db.asset_bundles {
            if !item.name.starts_with("live2d_mot_") {
                continue;
            }

            let name = item.name.trim_start_matches("live2d_mot_").to_string();
            let category = name.split('-').next().unwrap_or(&name).to_string();

            let is_cached = cache_manager.is_bundle_cached(&item.object_name, &item.md5);

            entries.push(super::types::MotionCatalogEntry {
                asset_name: item.name,
                object_name: item.object_name,
                name,
                category,
                size_bytes: item.size as u64,
                md5: item.md5,
                is_cached,
            });
        }

        // Sort deterministically: by category asc, then name asc
        entries.sort_by(|a, b| {
            a.category
                .cmp(&b.category)
                .then_with(|| a.name.cmp(&b.name))
        });

        debug!(
            "Discovered {} Live2D motion assets in catalog",
            entries.len()
        );
        Ok(entries)
    }

    /// Loads model animation metadata (associated expressions + shared motions) for a character.
    pub fn get_model_animations_from_bytes(
        data: &[u8],
        character_id: &str,
        cache_manager: &ImporterCacheManager,
    ) -> Result<super::types::ModelAnimationMetadata, DomainError> {
        let all_expressions = Self::load_expressions_from_bytes(data, cache_manager)?;
        let expressions: Vec<_> = all_expressions
            .into_iter()
            .filter(|e| e.character_id == character_id)
            .collect();

        let motions = Self::load_motions_from_bytes(data, cache_manager)?;

        Ok(super::types::ModelAnimationMetadata {
            character_id: character_id.to_string(),
            expressions,
            motions,
        })
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

    #[test]
    fn test_load_expressions_and_motions_synthetic() {
        let dir = tempdir().unwrap();
        let cache = ImporterCacheManager::with_root(dir.path().join("cache"));
        cache.ensure_dirs().unwrap();

        let items = vec![
            OctoItem {
                id: 1,
                name: "live2d_exp_smile-01_00007_000".to_string(),
                object_name: "exp_007_smile".to_string(),
                size: 2000,
                crc: 0,
                md5: "md5_exp_1".to_string(),
                dependencies: vec![],
                addresses: vec![],
            },
            OctoItem {
                id: 2,
                name: "live2d_exp_anger-01_00007_000".to_string(),
                object_name: "exp_007_anger".to_string(),
                size: 2100,
                crc: 0,
                md5: "md5_exp_2".to_string(),
                dependencies: vec![],
                addresses: vec![],
            },
            OctoItem {
                id: 3,
                name: "live2d_exp_smile-01_00010_000".to_string(),
                object_name: "exp_010_smile".to_string(),
                size: 2200,
                crc: 0,
                md5: "md5_exp_3".to_string(),
                dependencies: vec![],
                addresses: vec![],
            },
            OctoItem {
                id: 4,
                name: "live2d_mot_joy-01_lv01".to_string(),
                object_name: "mot_joy".to_string(),
                size: 9000,
                crc: 0,
                md5: "md5_mot_1".to_string(),
                dependencies: vec![],
                addresses: vec![],
            },
            OctoItem {
                id: 5,
                name: "live2d_mot_smile-01_lv01".to_string(),
                object_name: "mot_smile".to_string(),
                size: 9100,
                crc: 0,
                md5: "md5_mot_2".to_string(),
                dependencies: vec![],
                addresses: vec![],
            },
        ];

        let payload =
            build_synthetic_octocache(20, "https://asset.example.com/{objectName}", &items);

        let expressions = CatalogLoader::load_expressions_from_bytes(&payload, &cache).unwrap();
        assert_eq!(expressions.len(), 3);
        assert_eq!(expressions[0].character_id, "00007");
        assert_eq!(expressions[0].name, "anger-01");
        assert_eq!(expressions[1].character_id, "00007");
        assert_eq!(expressions[1].name, "smile-01");
        assert_eq!(expressions[2].character_id, "00010");

        let motions = CatalogLoader::load_motions_from_bytes(&payload, &cache).unwrap();
        assert_eq!(motions.len(), 2);
        assert_eq!(motions[0].category, "joy");
        assert_eq!(motions[0].name, "joy-01_lv01");
        assert_eq!(motions[1].category, "smile");

        let meta_00007 =
            CatalogLoader::get_model_animations_from_bytes(&payload, "00007", &cache).unwrap();
        assert_eq!(meta_00007.character_id, "00007");
        assert_eq!(meta_00007.expressions.len(), 2);
        assert_eq!(meta_00007.motions.len(), 2);
    }
}
