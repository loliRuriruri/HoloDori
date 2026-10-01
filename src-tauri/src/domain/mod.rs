//! Pure domain logic for HoloDori Live2D Manager.
//! Strictly decoupled from Tauri and GUI.

pub mod builder;
pub mod classifier;
pub mod error;
pub mod extractor;
pub mod library;
pub mod manifest;
pub mod matcher;
pub mod octo;
pub mod parser;
pub mod scanner;
pub mod types;
pub mod validator;

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use crate::domain::builder::PackageBuilder;
use crate::domain::classifier::classify_all;
use crate::domain::error::DomainError;
use crate::domain::library::cache::LibraryScanCache;
use crate::domain::matcher::TextureMatcher;
use crate::domain::parser::{IdentityParser, NamingRuleConfig};
use crate::domain::scanner::{scan_paths, ScannerOptions};
use crate::domain::types::{
    BatchBuildReport, BuildStatus, CharacterLibrary, ConflictPolicy, FileClassification,
    LibraryScanReport, MatchConfidence, MatchedPair, ModelBuildReport, ModelSourceType,
    ScannedFile, ValidationStageResult,
};
use crate::domain::validator::PackageValidator;

#[derive(Debug, Clone, Default)]
pub struct PipelineConfig {
    pub scanner_options: ScannerOptions,
    pub naming_rules: NamingRuleConfig,
    pub conflict_policy: ConflictPolicy,
}

pub struct ConversionPipeline {
    config: PipelineConfig,
}

impl ConversionPipeline {
    pub fn new(config: PipelineConfig) -> Self {
        Self { config }
    }

    /// Step 1: Scan input paths safely without modifying any source files.
    pub fn scan_inputs(&self, paths: &[PathBuf]) -> Result<Vec<ScannedFile>, DomainError> {
        scan_paths(paths, &self.config.scanner_options)
    }

    /// Step 2: Classify discovered candidate files based on actual structure.
    pub fn classify_candidates(&self, files: &mut [ScannedFile]) -> Result<(), DomainError> {
        classify_all(files)
    }

    /// Step 3 & 4: Parse identities and match models with texture candidates.
    pub fn match_pairs(
        &self,
        files: &[ScannedFile],
    ) -> Result<(Vec<MatchedPair>, HashMap<PathBuf, String>), DomainError> {
        let parser = IdentityParser::new(self.config.naming_rules.clone());
        let mut source_hashes = HashMap::new();
        let mut model_sources = Vec::new();
        let mut textures = Vec::new();

        for file in files {
            source_hashes.insert(file.path.clone(), file.sha256.clone());
            match file.classification {
                FileClassification::ModelResourceJson => {
                    model_sources.push((file.path.clone(), ModelSourceType::JsonBytes));
                }
                FileClassification::RawMoc => {
                    model_sources.push((file.path.clone(), ModelSourceType::RawMoc));
                }
                FileClassification::TextureImage => {
                    textures.push(file.clone());
                }
                _ => {}
            }
        }

        let mut matched_pairs = Vec::new();
        for (model_path, model_type) in model_sources {
            let identity = match parser.parse_path(&model_path) {
                Ok(id) => id,
                Err(e) => {
                    // For ambiguous or unrecognized naming, record ambiguous pair
                    crate::domain::types::ParsedIdentity {
                        character_id: "".to_string(),
                        outfit_id: "".to_string(),
                        style_tag: None,
                        confidence: MatchConfidence::Ambiguous,
                        evidence: vec![format!("Failed to parse identity: {}", e)],
                        source_stem: model_path
                            .file_stem()
                            .and_then(|s| s.to_str())
                            .unwrap_or("")
                            .to_string(),
                    }
                }
            };

            let pair = TextureMatcher::match_model(&model_path, model_type, &identity, &textures);
            matched_pairs.push(pair);
        }

        Ok((matched_pairs, source_hashes))
    }

    /// Step 5 & 6 & 7 & 8: Build package and execute 10-point validation.
    pub fn build_and_validate(
        &self,
        pair: &MatchedPair,
        output_root: &Path,
        source_hashes: &HashMap<PathBuf, String>,
    ) -> ModelBuildReport {
        // Ambiguous matches stop automatic building
        if pair.match_confidence == MatchConfidence::Ambiguous {
            return ModelBuildReport {
                model_id: pair.id.clone(),
                status: BuildStatus::Fail,
                moc_version: crate::domain::types::MocVersion::Invalid,
                runtime_validation: crate::domain::types::RuntimeValidationStatus::NotTested,
                runtime_details: None,
                input_files: vec![pair.model_source.clone()],
                output_files: Vec::new(),
                output_directory: None,
                validation_stages: vec![ValidationStageResult {
                    stage_name: "Texture Matching Guard".to_string(),
                    passed: false,
                    message: "Ambiguous texture match: requires manual user disambiguation"
                        .to_string(),
                }],
                warnings: pair.warnings.clone(),
                errors: vec!["Cannot build model with ambiguous texture association".to_string()],
            };
        }

        if pair.match_confidence == MatchConfidence::NoMatch {
            return ModelBuildReport {
                model_id: pair.id.clone(),
                status: BuildStatus::Fail,
                moc_version: crate::domain::types::MocVersion::Invalid,
                runtime_validation: crate::domain::types::RuntimeValidationStatus::NotTested,
                runtime_details: None,
                input_files: vec![pair.model_source.clone()],
                output_files: Vec::new(),
                output_directory: None,
                validation_stages: vec![ValidationStageResult {
                    stage_name: "Texture Matching Guard".to_string(),
                    passed: false,
                    message: "No matching texture image found for model".to_string(),
                }],
                warnings: pair.warnings.clone(),
                errors: vec!["No matching texture found".to_string()],
            };
        }

        match PackageBuilder::build_package(pair, output_root, self.config.conflict_policy) {
            Ok(build_result) => PackageValidator::validate_package(
                &build_result,
                pair,
                source_hashes,
                crate::domain::types::RuntimeValidationStatus::NotTested,
                None,
            ),
            Err(e) => ModelBuildReport {
                model_id: pair.id.clone(),
                status: BuildStatus::Fail,
                moc_version: crate::domain::types::MocVersion::Invalid,
                runtime_validation: crate::domain::types::RuntimeValidationStatus::NotTested,
                runtime_details: None,
                input_files: vec![pair.model_source.clone()],
                output_files: Vec::new(),
                output_directory: None,
                validation_stages: vec![ValidationStageResult {
                    stage_name: "Package Build".to_string(),
                    passed: false,
                    message: format!("Build failed: {}", e),
                }],
                warnings: pair.warnings.clone(),
                errors: vec![format!("{}", e)],
            },
        }
    }

    /// Executes full batch conversion pipeline on given input paths.
    /// Fault isolation: failure on one model never crashes the entire batch.
    pub fn run_batch(
        &self,
        input_paths: &[PathBuf],
        output_dir: &Path,
    ) -> Result<BatchBuildReport, DomainError> {
        let mut files = self.scan_inputs(input_paths)?;
        self.classify_candidates(&mut files)?;
        let (pairs, source_hashes) = self.match_pairs(&files)?;

        let mut reports = Vec::new();
        let mut passed = 0;
        let mut passed_with_warnings = 0;
        let mut failed = 0;

        for pair in &pairs {
            let report = self.build_and_validate(pair, output_dir, &source_hashes);
            match report.status {
                BuildStatus::Pass => passed += 1,
                BuildStatus::PassWithWarnings => passed_with_warnings += 1,
                BuildStatus::Fail => failed += 1,
            }
            reports.push(report);
        }

        let overall_status = if failed > 0 {
            if passed > 0 || passed_with_warnings > 0 {
                BuildStatus::PassWithWarnings
            } else {
                BuildStatus::Fail
            }
        } else if passed_with_warnings > 0 {
            BuildStatus::PassWithWarnings
        } else {
            BuildStatus::Pass
        };

        Ok(BatchBuildReport {
            total_models: pairs.len(),
            passed,
            passed_with_warnings,
            failed,
            reports,
            overall_status,
        })
    }

    /// Scans input paths into a CharacterLibrary, utilizing metadata caching.
    pub fn scan_library(
        &self,
        paths: &[PathBuf],
        cache_path: Option<&Path>,
        force_rescan: bool,
    ) -> Result<CharacterLibrary, DomainError> {
        let start_time = std::time::Instant::now();
        let mut cache = if let Some(cp) = cache_path {
            if force_rescan {
                LibraryScanCache::new()
            } else {
                LibraryScanCache::load_from_file(cp)
            }
        } else {
            LibraryScanCache::new()
        };

        // 1. Discover candidate files safely
        let raw_discovered = self.scan_inputs(paths)?;
        let mut scanned_files = Vec::new();
        let mut cache_hits = 0;
        let mut cache_misses = 0;
        let mut unclassified_files = Vec::new();

        for file in raw_discovered {
            let mtime = LibraryScanCache::get_mtime_secs(&file.path);
            if !force_rescan {
                if let Some(cached_entry) = cache.lookup(&file.path, file.size_bytes, mtime) {
                    scanned_files.push(ScannedFile::from(cached_entry));
                    cache_hits += 1;
                    continue;
                }
            }

            // Cache miss: needs classification
            cache_misses += 1;
            unclassified_files.push((file, mtime));
        }

        // 2. Classify unclassified candidates
        if !unclassified_files.is_empty() {
            let mut to_classify: Vec<ScannedFile> =
                unclassified_files.iter().map(|(f, _)| f.clone()).collect();
            self.classify_candidates(&mut to_classify)?;

            for (idx, classified) in to_classify.into_iter().enumerate() {
                let mtime = unclassified_files[idx].1;
                cache.insert(crate::domain::library::cache::CachedFileEntry {
                    path: classified.path.clone(),
                    relative_path: classified.relative_path.clone(),
                    file_name: classified.file_name.clone(),
                    size_bytes: classified.size_bytes,
                    modified_unix_secs: mtime,
                    sha256: classified.sha256.clone(),
                    classification: classified.classification.clone(),
                });
                scanned_files.push(classified);
            }
        }

        // 3. Save cache if path provided
        if let Some(cp) = cache_path {
            let _ = cache.save_to_file(cp);
        }

        // 4. Match pairs
        let (pairs, _hashes) = self.match_pairs(&scanned_files)?;

        // 5. Build CharacterLibrary
        let duration_ms = start_time.elapsed().as_millis() as u64;
        let model_resources_found = scanned_files
            .iter()
            .filter(|f| {
                matches!(
                    f.classification,
                    FileClassification::ModelResourceJson | FileClassification::RawMoc
                )
            })
            .count();
        let textures_found = scanned_files
            .iter()
            .filter(|f| matches!(f.classification, FileClassification::TextureImage))
            .count();
        let matched_outfits = pairs
            .iter()
            .filter(|p| {
                p.match_confidence != MatchConfidence::Ambiguous
                    && p.match_confidence != MatchConfidence::NoMatch
            })
            .count();
        let ambiguous_outfits = pairs
            .iter()
            .filter(|p| p.match_confidence == MatchConfidence::Ambiguous)
            .count();

        let report = LibraryScanReport {
            scanned_files: scanned_files.len(),
            model_resources_found,
            textures_found,
            matched_outfits,
            ambiguous_outfits,
            scan_duration_ms: duration_ms,
            cache_hit_count: cache_hits,
            cache_miss_count: cache_misses,
        };

        Ok(CharacterLibrary::from_matched_pairs(
            pairs,
            paths.to_vec(),
            report,
        ))
    }
}
