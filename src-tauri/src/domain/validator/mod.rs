use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use crate::domain::builder::PackageBuildResult;
use crate::domain::error::{DomainError, ErrorCode};
use crate::domain::extractor::{extract_bytes, validate_moc3_candidate};
use crate::domain::manifest::Model3Manifest;
use crate::domain::scanner::compute_sha256;
use crate::domain::types::{
    BuildStatus, MatchedPair, MocVersion, ModelBuildReport, ModelSourceType,
    RuntimeValidationStatus, ValidationStageResult,
};

pub struct PackageValidator;

impl PackageValidator {
    pub fn validate_package(
        package: &PackageBuildResult,
        pair: &MatchedPair,
        original_hashes: &HashMap<PathBuf, String>,
        runtime_validation: RuntimeValidationStatus,
        runtime_details: Option<String>,
    ) -> ModelBuildReport {
        let mut stages = Vec::new();
        let mut warnings = pair.warnings.clone();
        let mut errors = Vec::new();
        let mut has_failure = false;
        let mut detected_moc_version = MocVersion::Invalid;

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

        // ====================================================================
        // LEVEL 1 — Container Candidate Validation
        // Checks: MOC3 magic header, header availability, recognized/unknown version, sane non-zero size
        // (Note: Level 1 does NOT prove official Cubism runtime compatibility)
        // ====================================================================
        run_stage!("Level 1: Container Candidate (MOC3 Header & Version)", {
            let bytes = fs::read(&package.moc_path).map_err(|e| DomainError::IoError {
                code: ErrorCode::ErrIo,
                path: package.moc_path.clone(),
                message: e.to_string(),
            })?;
            let version = validate_moc3_candidate(&bytes, &package.moc_path)?;
            detected_moc_version = version;

            match version {
                MocVersion::Known(raw) => {
                    let version_label = version.version_label().unwrap_or("Cubism Known");
                    Ok(format!(
                        "Valid candidate: {} (0x{:02x}), payload size: {} bytes",
                        version_label,
                        raw,
                        bytes.len()
                    ))
                }
                MocVersion::Unknown(raw) => {
                    let warn_msg = format!(
                        "Unverified or future MOC3 version byte 0x{:02x} detected (not officially verified)",
                        raw
                    );
                    warnings.push(warn_msg.clone());
                    Ok(format!("Candidate accepted with warning: {}", warn_msg))
                }
                MocVersion::Invalid => Err(DomainError::InvalidMocHeader {
                    code: ErrorCode::ErrMocHeaderInvalid,
                    path: package.moc_path.clone(),
                    reason: "Invalid MOC3 candidate header".to_string(),
                }),
            }
        });

        // ====================================================================
        // LEVEL 2 — Package Structural Validation
        // ====================================================================

        // Stage A: Source JSON parses
        run_stage!("Level 2 [A]: Source JSON parses", {
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
        run_stage!("Level 2 [B]: _bytes extraction succeeds", {
            if pair.model_type == ModelSourceType::JsonBytes {
                let bytes = extract_bytes(&pair.model_source)?;
                Ok(format!("Extracted {} bytes successfully", bytes.len()))
            } else {
                Ok("Source is raw MOC3, _bytes extraction skipped".to_string())
            }
        });

        // Stage D: Output MOC exists
        run_stage!("Level 2 [D]: Output MOC exists", {
            if package.moc_path.is_file() {
                Ok(format!(
                    "Output MOC3 exists at {}",
                    package.moc_path.display()
                ))
            } else {
                Err(DomainError::ValidationFailed {
                    code: ErrorCode::ErrValidationFailed,
                    stage: "Level 2 [D]".to_string(),
                    reason: format!("MOC3 file not found: {}", package.moc_path.display()),
                })
            }
        });

        // Stage E: All texture paths exist
        run_stage!("Level 2 [E]: All texture paths exist", {
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
                        stage: "Level 2 [E]".to_string(),
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
        run_stage!("Level 2 [F]: model3 JSON parses", {
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
        run_stage!("Level 2 [G]: Every model3 reference resolves", {
            if let Some(manifest) = &parsed_manifest_opt {
                let moc_ref = package.package_dir.join(&manifest.file_references.moc);
                if !moc_ref.is_file() {
                    return Err(DomainError::ValidationFailed {
                        code: ErrorCode::ErrValidationFailed,
                        stage: "Level 2 [G]".to_string(),
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
                            stage: "Level 2 [G]".to_string(),
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
                    stage: "Level 2 [G]".to_string(),
                    reason: "Skipped because manifest failed to parse".to_string(),
                })
            }
        });

        // Stage H: No output reference escapes the model directory
        run_stage!(
            "Level 2 [H]: No output reference escapes model directory",
            {
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
            }
        );

        // Stage I: Package can be reopened by our own parser
        run_stage!("Level 2 [I]: Package can be reopened by our own parser", {
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
                    stage: "Level 2 [I]".to_string(),
                    reason: "Reopened manifest has invalid structure".to_string(),
                });
            }
            Ok("Package re-verified and parsed cleanly".to_string())
        });

        // Stage J: Source files remain unchanged
        run_stage!("Level 2 [J]: Source files remain unchanged", {
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

        // ====================================================================
        // LEVEL 3 — Cubism Runtime Validation
        // ====================================================================
        match runtime_validation {
            RuntimeValidationStatus::Pass => {
                stages.push(ValidationStageResult {
                    stage_name: "Level 3: Cubism Runtime Validation".to_string(),
                    passed: true,
                    message: runtime_details.clone().unwrap_or_else(|| {
                        "Runtime rendering succeeded in Live2D compatible viewer".to_string()
                    }),
                });
            }
            RuntimeValidationStatus::NotTested => {
                let note = "NOT_TESTED: Package passed Level 1 container and Level 2 structural validation. External Cubism runtime rendering test not executed.".to_string();
                warnings.push(note.clone());
                stages.push(ValidationStageResult {
                    stage_name: "Level 3: Cubism Runtime Validation".to_string(),
                    passed: true, // Structural build succeeds, runtime status explicitly recorded as NotTested
                    message: note,
                });
            }
            RuntimeValidationStatus::Fail => {
                has_failure = true;
                let fail_msg = runtime_details
                    .clone()
                    .unwrap_or_else(|| "Failed runtime rendering in Live2D viewer".to_string());
                errors.push(fail_msg.clone());
                stages.push(ValidationStageResult {
                    stage_name: "Level 3: Cubism Runtime Validation".to_string(),
                    passed: false,
                    message: fail_msg,
                });
            }
        }

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
            moc_version: detected_moc_version,
            runtime_validation,
            runtime_details,
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
        Ok(path.to_path_buf())
    }
}
