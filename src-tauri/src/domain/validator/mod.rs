use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::domain::builder::PackageBuildResult;
use crate::domain::error::{DomainError, ErrorCode};
use crate::domain::extractor::{extract_bytes, validate_moc3_candidate};
use crate::domain::manifest::Model3Manifest;
use crate::domain::scanner::compute_sha256;
use crate::domain::types::{
    BuildStatus, MatchedPair, ModelBuildReport, ModelSourceType, ValidationStageResult,
};

pub struct PackageValidator;

impl PackageValidator {
    pub fn validate_package(
        package: &PackageBuildResult,
        pair: &MatchedPair,
        original_hashes: &HashMap<PathBuf, String>,
    ) -> ModelBuildReport {
        let mut stages = Vec::new();
        let warnings = pair.warnings.clone();
        let mut errors = Vec::new();
        let mut has_failure = false;

        macro_rules! run_stage {
            ($name:expr, $code:expr) => {
                #[allow(clippy::redundant_closure_call)]
                let stage_res: Result<String, DomainError> =
                    (|| -> Result<String, DomainError> { $code })();
                match stage_res {
                    Ok(msg) => {
                        stages.push(ValidationStageResult {
                            stage_name: $name.to_string(),
                            passed: true,
                            message: msg,
                        });
                    }
                    Err(e) => {
                        has_failure = true;
                        let err_msg = format!("{}", e);
                        errors.push(err_msg.clone());
                        stages.push(ValidationStageResult {
                            stage_name: $name.to_string(),
                            passed: false,
                            message: err_msg,
                        });
                    }
                }
            };
        }

        // Stage A: Source JSON parses
        run_stage!("Stage A: Source JSON parses", {
            if pair.model_type == ModelSourceType::JsonBytes {
                let content =
                    fs::read_to_string(&pair.model_source).map_err(|e| DomainError::IoError {
                        code: ErrorCode::ErrIo,
                        path: pair.model_source.clone(),
                        message: e.to_string(),
                    })?;
                let _: serde_json::Value =
                    serde_json::from_str(&content).map_err(|e| DomainError::JsonSyntaxError {
                        code: ErrorCode::ErrJsonSyntax,
                        path: pair.model_source.clone(),
                        message: e.to_string(),
                    })?;
                Ok("Source JSON successfully parsed".to_string())
            } else {
                Ok("Source is raw MOC3, JSON parsing skipped".to_string())
            }
        });

        // Stage B: _bytes extraction succeeds
        run_stage!("Stage B: _bytes extraction succeeds", {
            if pair.model_type == ModelSourceType::JsonBytes {
                let bytes = extract_bytes(&pair.model_source)?;
                Ok(format!("Extracted {} bytes successfully", bytes.len()))
            } else {
                Ok("Source is raw MOC3, _bytes extraction skipped".to_string())
            }
        });

        // Stage C: Generated binary is non-empty and valid MOC3
        run_stage!("Stage C: Generated binary is non-empty and valid MOC3", {
            let bytes = fs::read(&package.moc_path).map_err(|e| DomainError::IoError {
                code: ErrorCode::ErrIo,
                path: package.moc_path.clone(),
                message: e.to_string(),
            })?;
            let version = validate_moc3_candidate(&bytes, &package.moc_path)?;
            Ok(format!(
                "Valid MOC3 binary ({} bytes, Cubism version byte 0x{:02x})",
                bytes.len(),
                version
            ))
        });

        // Stage D: Output MOC exists
        run_stage!("Stage D: Output MOC exists", {
            if package.moc_path.is_file() {
                Ok(format!(
                    "Output MOC3 exists at {}",
                    package.moc_path.display()
                ))
            } else {
                Err(DomainError::ValidationFailed {
                    code: ErrorCode::ErrValidationFailed,
                    stage: "Stage D".to_string(),
                    reason: format!("MOC3 file not found: {}", package.moc_path.display()),
                })
            }
        });

        // Stage E: All texture paths exist
        run_stage!("Stage E: All texture paths exist", {
            if package.texture_paths.is_empty() {
                return Err(DomainError::TextureNotFound {
                    code: ErrorCode::ErrTextureNotFound,
                    model_name: pair.id.clone(),
                });
            }
            for tex in &package.texture_paths {
                if !tex.is_file() {
                    return Err(DomainError::ValidationFailed {
                        code: ErrorCode::ErrValidationFailed,
                        stage: "Stage E".to_string(),
                        reason: format!("Texture file does not exist: {}", tex.display()),
                    });
                }
            }
            Ok(format!(
                "All {} texture files exist",
                package.texture_paths.len()
            ))
        });

        // Stage F: model3 JSON parses
        let mut parsed_manifest_opt = None;
        run_stage!("Stage F: model3 JSON parses", {
            let content =
                fs::read_to_string(&package.manifest_path).map_err(|e| DomainError::IoError {
                    code: ErrorCode::ErrIo,
                    path: package.manifest_path.clone(),
                    message: e.to_string(),
                })?;
            let manifest = Model3Manifest::from_json_str(&content)?;
            parsed_manifest_opt = Some(manifest);
            Ok("model3.json parsed successfully matching schema".to_string())
        });

        // Stage G: Every model3 reference resolves
        run_stage!("Stage G: Every model3 reference resolves", {
            if let Some(manifest) = &parsed_manifest_opt {
                let moc_ref = package.package_dir.join(&manifest.file_references.moc);
                if !moc_ref.is_file() {
                    return Err(DomainError::ValidationFailed {
                        code: ErrorCode::ErrValidationFailed,
                        stage: "Stage G".to_string(),
                        reason: format!(
                            "Manifest Moc reference does not resolve: {}",
                            moc_ref.display()
                        ),
                    });
                }
                for tex_rel in &manifest.file_references.textures {
                    let tex_ref = package.package_dir.join(tex_rel);
                    if !tex_ref.is_file() {
                        return Err(DomainError::ValidationFailed {
                            code: ErrorCode::ErrValidationFailed,
                            stage: "Stage G".to_string(),
                            reason: format!(
                                "Manifest Texture reference does not resolve: {}",
                                tex_ref.display()
                            ),
                        });
                    }
                }
                Ok("All references in model3.json successfully resolved".to_string())
            } else {
                Err(DomainError::ValidationFailed {
                    code: ErrorCode::ErrValidationFailed,
                    stage: "Stage G".to_string(),
                    reason: "Skipped because manifest failed to parse".to_string(),
                })
            }
        });

        // Stage H: No output reference escapes the model directory
        run_stage!("Stage H: No output reference escapes model directory", {
            let canon_package = canonicalize_or_clean(&package.package_dir)?;
            if let Some(manifest) = &parsed_manifest_opt {
                let moc_path = canonicalize_or_clean(
                    &package.package_dir.join(&manifest.file_references.moc),
                )?;
                if !moc_path.starts_with(&canon_package) {
                    return Err(DomainError::PathTraversalDetected {
                        code: ErrorCode::ErrPathTraversalDetected,
                        path: moc_path,
                    });
                }
                for tex_rel in &manifest.file_references.textures {
                    let tex_path = canonicalize_or_clean(&package.package_dir.join(tex_rel))?;
                    if !tex_path.starts_with(&canon_package) {
                        return Err(DomainError::PathTraversalDetected {
                            code: ErrorCode::ErrPathTraversalDetected,
                            path: tex_path,
                        });
                    }
                }
            }
            Ok("All references strictly confined to model package directory".to_string())
        });

        // Stage I: Package can be reopened by our own parser
        run_stage!("Stage I: Package can be reopened by our own parser", {
            let content =
                fs::read_to_string(&package.manifest_path).map_err(|e| DomainError::IoError {
                    code: ErrorCode::ErrIo,
                    path: package.manifest_path.clone(),
                    message: e.to_string(),
                })?;
            let reopened = Model3Manifest::from_json_str(&content)?;
            if reopened.version != 3 || reopened.file_references.textures.is_empty() {
                return Err(DomainError::ValidationFailed {
                    code: ErrorCode::ErrValidationFailed,
                    stage: "Stage I".to_string(),
                    reason: "Reopened manifest has invalid structure".to_string(),
                });
            }
            Ok("Package re-verified and parsed cleanly".to_string())
        });

        // Stage J: Source files remain unchanged
        run_stage!("Stage J: Source files remain unchanged", {
            let mut inputs_to_check = vec![pair.model_source.clone()];
            inputs_to_check.extend(pair.textures.clone());

            for input_path in inputs_to_check {
                if let Some(expected_hash) = original_hashes.get(&input_path) {
                    let current_hash = compute_sha256(&input_path)?;
                    if current_hash != *expected_hash {
                        return Err(DomainError::SourceIntegrityFailed {
                            code: ErrorCode::ErrSourceIntegrityFailed,
                            path: input_path,
                        });
                    }
                }
            }
            Ok("All source files bit-for-bit unchanged (hash verification passed)".to_string())
        });

        let mut input_files = vec![pair.model_source.clone()];
        input_files.extend(pair.textures.clone());

        let mut output_files = vec![package.moc_path.clone(), package.manifest_path.clone()];
        output_files.extend(package.texture_paths.clone());

        let status = if has_failure {
            BuildStatus::Fail
        } else if !warnings.is_empty() {
            BuildStatus::PassWithWarnings
        } else {
            BuildStatus::Pass
        };

        ModelBuildReport {
            model_id: pair.id.clone(),
            status,
            input_files,
            output_files,
            output_directory: Some(package.package_dir.clone()),
            validation_stages: stages,
            warnings,
            errors,
        }
    }
}

fn canonicalize_or_clean(path: &Path) -> Result<PathBuf, DomainError> {
    if path.exists() {
        path.canonicalize().map_err(|e| DomainError::IoError {
            code: ErrorCode::ErrIo,
            path: path.to_path_buf(),
            message: e.to_string(),
        })
    } else {
        // Fallback for non-canonicalized paths
        Ok(path.to_path_buf())
    }
}
