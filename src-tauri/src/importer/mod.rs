pub mod acquisition;
pub mod cache;
pub mod catalog;
pub mod steam;
pub mod types;
pub mod unity;

use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tracing::{error, info};

use crate::domain::error::{DomainError, ErrorCode};
use crate::domain::types::{ConflictPolicy, MatchConfidence};
use crate::domain::{ConversionPipeline, PipelineConfig};

pub use acquisition::AssetAcquisition;
pub use cache::{CacheStats, ImporterCacheManager};
pub use catalog::CatalogLoader;
pub use steam::SteamDetector;
pub use types::*;
pub use unity::UnityExtractor;

pub struct ImporterCoordinator {
    cache_manager: ImporterCacheManager,
    acquisition: AssetAcquisition,
    cancel_token: Arc<AtomicBool>,
}

impl Default for ImporterCoordinator {
    fn default() -> Self {
        Self::new()
    }
}

impl ImporterCoordinator {
    pub fn new() -> Self {
        Self {
            cache_manager: ImporterCacheManager::new(),
            acquisition: AssetAcquisition::new(),
            cancel_token: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn with_cache_root(cache_root: impl AsRef<Path>) -> Self {
        Self {
            cache_manager: ImporterCacheManager::with_root(cache_root),
            acquisition: AssetAcquisition::new(),
            cancel_token: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cache_manager(&self) -> &ImporterCacheManager {
        &self.cache_manager
    }

    pub fn cancel_token(&self) -> Arc<AtomicBool> {
        self.cancel_token.clone()
    }

    pub fn cancel(&self) {
        info!("Cancellation requested for ongoing import operations");
        self.cancel_token.store(true, Ordering::SeqCst);
    }

    pub fn reset_cancel(&self) {
        self.cancel_token.store(false, Ordering::SeqCst);
    }

    /// Auto-detect Steam game installation.
    pub fn detect_steam() -> SteamDetectionResult {
        SteamDetector::auto_detect()
    }

    /// Validate a manual user-selected folder path.
    pub fn validate_game_path(path: &Path) -> SteamDetectionResult {
        SteamDetector::validate_path(path)
    }

    /// Load and filter catalog from an octocacheevai file.
    pub fn load_catalog(
        &self,
        octocache_path: &Path,
    ) -> Result<Vec<ModelCatalogEntry>, DomainError> {
        CatalogLoader::load_from_file(octocache_path, &self.cache_manager)
    }

    /// Get current cache usage statistics.
    pub fn cache_stats(&self) -> CacheStats {
        self.cache_manager.get_stats()
    }

    /// Clear cached raw bundles.
    pub fn clear_cache(&self) -> Result<u64, DomainError> {
        self.cache_manager.clear_cache()
    }

    /// Loads animation metadata (character expressions + all motions) from octocache.
    pub fn get_model_animations(
        &self,
        character_id: &str,
        octocache_path: Option<&Path>,
    ) -> Result<ModelAnimationMetadata, DomainError> {
        let octo_path_buf;
        let path = if let Some(p) = octocache_path {
            p
        } else {
            let detection = Self::detect_steam();
            if let Some(p_str) = detection.octocache_path {
                octo_path_buf = std::path::PathBuf::from(p_str);
                &octo_path_buf
            } else {
                return Err(DomainError::importer(
                    ErrorCode::ErrImporterFailed,
                    "No HoloDori octocache catalog found on system",
                ));
            }
        };

        let bytes = fs::read(path).map_err(|e| {
            DomainError::io(
                path,
                format!("Failed to read octocache file {}: {e}", path.display()),
            )
        })?;

        CatalogLoader::get_model_animations_from_bytes(&bytes, character_id, &self.cache_manager)
    }

    /// Acquires expression bundle (cache or CDN) and extracts .exp3.json bytes.
    pub async fn acquire_and_extract_expression(
        &self,
        object_name: &str,
        asset_name: &str,
        md5: &str,
        expected_size: Option<u64>,
    ) -> Result<Vec<u8>, DomainError> {
        let cancel_clone = self.cancel_token.clone();
        let bundle_path = self
            .acquisition
            .acquire_bundle(
                object_name,
                md5,
                expected_size,
                &self.cache_manager,
                cancel_clone,
                |_rec, _tot| {},
            )
            .await?;

        UnityExtractor::extract_expression(&bundle_path, asset_name)
    }

    /// Acquires motion bundle (cache or CDN) and extracts .motion3.json bytes.
    pub async fn acquire_and_extract_motion(
        &self,
        object_name: &str,
        asset_name: &str,
        md5: &str,
        expected_size: Option<u64>,
    ) -> Result<Vec<u8>, DomainError> {
        let cancel_clone = self.cancel_token.clone();
        let bundle_path = self
            .acquisition
            .acquire_bundle(
                object_name,
                md5,
                expected_size,
                &self.cache_manager,
                cancel_clone,
                |_rec, _tot| {},
            )
            .await?;

        UnityExtractor::extract_motion(&bundle_path, asset_name)
    }

    /// Acquires model bundle (cache or CDN) and extracts .physics3.json bytes if available.
    pub async fn acquire_and_extract_physics(
        &self,
        object_name: &str,
        asset_name: &str,
        md5: &str,
        expected_size: Option<u64>,
    ) -> Result<Option<Vec<u8>>, DomainError> {
        let cancel_clone = self.cancel_token.clone();
        let bundle_path = self
            .acquisition
            .acquire_bundle(
                object_name,
                md5,
                expected_size,
                &self.cache_manager,
                cancel_clone,
                |_rec, _tot| {},
            )
            .await?;

        Ok(UnityExtractor::extract_physics(&bundle_path, asset_name))
    }

    /// Imports selected models from the catalog into the destination directory.
    pub async fn import_models<F>(
        &self,
        entries: &[ModelCatalogEntry],
        destination_root: &Path,
        conflict_policy: ConflictPolicy,
        mut on_progress: F,
    ) -> Result<ImportExecutionResult, DomainError>
    where
        F: FnMut(ImportProgress),
    {
        self.reset_cancel();
        let total = entries.len();
        info!(
            "Starting import of {} selected models into {}",
            total,
            destination_root.display()
        );

        let pipeline = ConversionPipeline::new(PipelineConfig {
            conflict_policy,
            ..Default::default()
        });

        let mut succeeded = Vec::new();
        let mut failed = Vec::new();
        let mut was_cancelled = false;

        for (idx, entry) in entries.iter().enumerate() {
            if self.cancel_token.load(Ordering::SeqCst) {
                info!("Import loop cancelled at model {}/{}", idx + 1, total);
                was_cancelled = true;
                break;
            }

            on_progress(ImportProgress {
                total_models: total,
                current_model_index: idx + 1,
                current_model_name: entry.asset_name.clone(),
                phase: ImportPhase::Downloading,
                bytes_received: 0,
                bytes_total: entry.size_bytes,
                overall_percentage: (idx as f32 / total as f32) * 100.0,
                error_message: None,
            });

            // 1. Acquire raw bundle
            let cancel_clone = self.cancel_token.clone();
            let bundle_result = self
                .acquisition
                .acquire_bundle(
                    &entry.object_name,
                    &entry.md5,
                    Some(entry.size_bytes),
                    &self.cache_manager,
                    cancel_clone,
                    |received, total_bytes| {
                        on_progress(ImportProgress {
                            total_models: total,
                            current_model_index: idx + 1,
                            current_model_name: entry.asset_name.clone(),
                            phase: ImportPhase::Downloading,
                            bytes_received: received,
                            bytes_total: total_bytes,
                            overall_percentage: ((idx as f32
                                + (received as f32 / total_bytes.max(1) as f32))
                                / total as f32)
                                * 100.0,
                            error_message: None,
                        });
                    },
                )
                .await;

            let bundle_path = match bundle_result {
                Ok(path) => path,
                Err(e) => {
                    if e.code() == ErrorCode::ErrCancelled {
                        was_cancelled = true;
                        break;
                    }
                    error!("Failed to acquire bundle for {}: {}", entry.asset_name, e);
                    failed.push(FailedModelSummary {
                        asset_name: entry.asset_name.clone(),
                        error: e.to_string(),
                    });
                    continue;
                }
            };

            // 2. Extract Live2D assets from bundle
            on_progress(ImportProgress {
                total_models: total,
                current_model_index: idx + 1,
                current_model_name: entry.asset_name.clone(),
                phase: ImportPhase::Extracting,
                bytes_received: entry.size_bytes,
                bytes_total: entry.size_bytes,
                overall_percentage: ((idx as f32 + 0.6) / total as f32) * 100.0,
                error_message: None,
            });

            let extracted = match UnityExtractor::extract_bundle(&bundle_path, &entry.asset_name) {
                Ok(data) => data,
                Err(e) => {
                    error!("Extraction failed for {}: {}", entry.asset_name, e);
                    failed.push(FailedModelSummary {
                        asset_name: entry.asset_name.clone(),
                        error: e.to_string(),
                    });
                    continue;
                }
            };

            // 3. Stage extracted files in temporary directory
            on_progress(ImportProgress {
                total_models: total,
                current_model_index: idx + 1,
                current_model_name: entry.asset_name.clone(),
                phase: ImportPhase::BuildingManifest,
                bytes_received: entry.size_bytes,
                bytes_total: entry.size_bytes,
                overall_percentage: ((idx as f32 + 0.8) / total as f32) * 100.0,
                error_message: None,
            });

            let staging_dir = match tempfile::tempdir() {
                Ok(t) => t,
                Err(e) => {
                    failed.push(FailedModelSummary {
                        asset_name: entry.asset_name.clone(),
                        error: format!("Failed creating staging directory: {e}"),
                    });
                    continue;
                }
            };

            let moc3_filename = format!("{}.moc3", extracted.model_name);
            let moc3_path = staging_dir.path().join(&moc3_filename);
            if let Err(e) = fs::write(&moc3_path, &extracted.moc3_bytes) {
                failed.push(FailedModelSummary {
                    asset_name: entry.asset_name.clone(),
                    error: format!("Failed writing staged MOC3: {e}"),
                });
                continue;
            }

            let mut texture_filenames = Vec::new();
            for tex in &extracted.textures {
                let tex_filename = format!("{}.png", tex.name);
                let tex_path = staging_dir.path().join(&tex_filename);
                if let Err(e) = fs::write(&tex_path, &tex.png_bytes) {
                    failed.push(FailedModelSummary {
                        asset_name: entry.asset_name.clone(),
                        error: format!("Failed writing staged texture {}: {e}", tex.name),
                    });
                    continue;
                }
                texture_filenames.push(tex_filename);
            }

            // 4. Feed staged files through existing AGENT.1 / AGENT.2 conversion pipeline
            let build_res = (|| -> Result<ImportedModelSummary, DomainError> {
                let mut scanned = pipeline.scan_inputs(&[staging_dir.path().to_path_buf()])?;
                pipeline.classify_candidates(&mut scanned)?;
                let (pairs, _hashes) = pipeline.match_pairs(&scanned)?;

                let matched_pair = pairs
                    .into_iter()
                    .find(|p| p.match_confidence != MatchConfidence::Ambiguous)
                    .ok_or_else(|| DomainError::AmbiguousNaming {
                        code: ErrorCode::ErrAmbiguousNaming,
                        name: extracted.model_name.clone(),
                        reason: format!(
                            "Failed to match staged model and textures for {}",
                            extracted.model_name
                        ),
                    })?;

                let mut source_hashes = std::collections::HashMap::new();
                if let Ok(hash) = crate::domain::scanner::compute_sha256(&matched_pair.model_source)
                {
                    source_hashes.insert(matched_pair.model_source.clone(), hash);
                }
                for tex in &matched_pair.textures {
                    if let Ok(hash) = crate::domain::scanner::compute_sha256(tex) {
                        source_hashes.insert(tex.clone(), hash);
                    }
                }

                let report =
                    pipeline.build_and_validate(&matched_pair, destination_root, &source_hashes);
                if report.status == crate::domain::types::BuildStatus::Fail {
                    return Err(DomainError::ValidationFailed {
                        code: ErrorCode::ErrValidationFailed,
                        stage: "Package Validation".to_string(),
                        reason: format!("{:?}", report.errors),
                    });
                }

                let out_dir = report
                    .output_directory
                    .unwrap_or_else(|| destination_root.join(&matched_pair.id));
                let moc3_full = out_dir.join(format!("{}.moc3", extracted.model_name));
                let manifest_full = out_dir.join(format!("{}.model3.json", extracted.model_name));
                let package_textures: Vec<String> = (0..extracted.textures.len())
                    .map(|i| {
                        out_dir
                            .join("textures")
                            .join(format!("texture_{:02}.png", i))
                            .to_string_lossy()
                            .to_string()
                    })
                    .collect();

                let mut physics_file = None;
                if let Some(phys_bytes) = &extracted.physics3_bytes {
                    let phys_filename = format!("{}.physics3.json", extracted.model_name);
                    let phys_full = out_dir.join(&phys_filename);
                    if fs::write(&phys_full, phys_bytes).is_ok() {
                        if let Ok(manifest_content) = fs::read_to_string(&manifest_full) {
                            if let Ok(manifest) =
                                crate::domain::manifest::Model3Manifest::from_json_str(
                                    &manifest_content,
                                )
                            {
                                if let Ok(updated_manifest) = manifest.with_physics(&phys_filename)
                                {
                                    if let Ok(json_str) = updated_manifest.to_json_pretty() {
                                        let _ = fs::write(&manifest_full, json_str);
                                    }
                                }
                            }
                        }
                        physics_file = Some(phys_filename);
                    }
                }

                Ok(ImportedModelSummary {
                    asset_name: entry.asset_name.clone(),
                    character_id: extracted.character_id.clone(),
                    outfit_id: extracted.outfit_id.clone(),
                    moc3_file: moc3_full.to_string_lossy().to_string(),
                    textures: package_textures,
                    physics_file,
                    manifest_file: manifest_full.to_string_lossy().to_string(),
                    output_dir: out_dir.to_string_lossy().to_string(),
                })
            })();

            match build_res {
                Ok(summary) => {
                    info!(
                        "Successfully imported model {}: {}",
                        entry.asset_name, summary.output_dir
                    );
                    succeeded.push(summary);
                }
                Err(e) => {
                    error!("Pipeline build failed for {}: {}", entry.asset_name, e);
                    failed.push(FailedModelSummary {
                        asset_name: entry.asset_name.clone(),
                        error: e.to_string(),
                    });
                }
            }
        }

        on_progress(ImportProgress {
            total_models: total,
            current_model_index: total,
            current_model_name: "".to_string(),
            phase: if was_cancelled {
                ImportPhase::Cancelled
            } else {
                ImportPhase::Completed
            },
            bytes_received: 0,
            bytes_total: 0,
            overall_percentage: 100.0,
            error_message: None,
        });

        Ok(ImportExecutionResult {
            succeeded,
            failed,
            total_processed: total,
            cancelled: was_cancelled,
        })
    }
}
