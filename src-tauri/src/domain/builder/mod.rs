use std::fs;
use std::path::{Path, PathBuf};
use tempfile::tempdir_in;

use crate::domain::error::{DomainError, ErrorCode};
use crate::domain::extractor::{extract_and_stage_moc, validate_moc3_candidate};
use crate::domain::manifest::Model3Manifest;
use crate::domain::types::{ConflictPolicy, MatchedPair, ModelSourceType};

#[derive(Debug, Clone)]
pub struct PackageBuildResult {
    pub package_dir: PathBuf,
    pub moc_path: PathBuf,
    pub manifest_path: PathBuf,
    pub texture_paths: Vec<PathBuf>,
}

pub struct PackageBuilder;

impl PackageBuilder {
    pub fn build_package(
        pair: &MatchedPair,
        output_root: &Path,
        conflict_policy: ConflictPolicy,
    ) -> Result<PackageBuildResult, DomainError> {
        if !output_root.exists() {
            fs::create_dir_all(output_root).map_err(|e| DomainError::IoError {
                code: ErrorCode::ErrIo,
                path: output_root.to_path_buf(),
                message: format!("Failed to create output root: {}", e),
            })?;
        }

        // Sanitize package directory name
        let sanitized_base = sanitize_filename(&pair.id);
        if sanitized_base.is_empty() {
            return Err(DomainError::AmbiguousNaming {
                code: ErrorCode::ErrAmbiguousNaming,
                name: pair.id.clone(),
                reason: "Sanitized model package identifier is empty".to_string(),
            });
        }

        // Determine destination directory according to conflict policy
        let target_dir = resolve_target_directory(output_root, &sanitized_base, conflict_policy)?;
        let final_dir_name = target_dir
            .file_name()
            .and_then(|f| f.to_str())
            .unwrap_or(&sanitized_base)
            .to_string();

        // Stage in a temporary directory inside output_root to allow atomic rename
        let staging_temp = tempdir_in(output_root).map_err(|e| DomainError::IoError {
            code: ErrorCode::ErrIo,
            path: output_root.to_path_buf(),
            message: format!("Failed to create staging directory: {}", e),
        })?;

        let staging_path = staging_temp.path();

        // 1. Prepare MOC3 file
        let moc_file_name = format!("{}.moc3", final_dir_name);
        let staged_moc_path = staging_path.join(&moc_file_name);

        match pair.model_type {
            ModelSourceType::JsonBytes => {
                let extracted = extract_and_stage_moc(&pair.model_source)?;
                fs::copy(&extracted.temp_path, &staged_moc_path).map_err(|e| DomainError::IoError {
                    code: ErrorCode::ErrIo,
                    path: staged_moc_path.clone(),
                    message: format!("Failed to copy staged MOC: {}", e),
                })?;
                let _ = fs::remove_file(&extracted.temp_path);
            }
            ModelSourceType::RawMoc => {
                // Read and validate raw MOC first
                let bytes = fs::read(&pair.model_source).map_err(|e| DomainError::IoError {
                    code: ErrorCode::ErrIo,
                    path: pair.model_source.clone(),
                    message: format!("Failed to read raw MOC: {}", e),
                })?;
                validate_moc3_candidate(&bytes, &pair.model_source)?;
                fs::copy(&pair.model_source, &staged_moc_path).map_err(|e| DomainError::IoError {
                    code: ErrorCode::ErrIo,
                    path: staged_moc_path.clone(),
                    message: format!("Failed to copy raw MOC: {}", e),
                })?;
            }
        }

        // 2. Prepare Textures
        let staged_tex_dir = staging_path.join("textures");
        fs::create_dir_all(&staged_tex_dir).map_err(|e| DomainError::IoError {
            code: ErrorCode::ErrIo,
            path: staged_tex_dir.clone(),
            message: format!("Failed to create textures directory: {}", e),
        })?;

        if pair.textures.is_empty() {
            return Err(DomainError::TextureNotFound {
                code: ErrorCode::ErrTextureNotFound,
                model_name: pair.id.clone(),
            });
        }

        let mut staged_texture_paths = Vec::new();
        let mut manifest_texture_rels = Vec::new();

        for (idx, src_tex) in pair.textures.iter().enumerate() {
            let tex_name = format!("texture_{:02}.png", idx);
            let staged_tex = staged_tex_dir.join(&tex_name);

            fs::copy(src_tex, &staged_tex).map_err(|e| DomainError::IoError {
                code: ErrorCode::ErrIo,
                path: staged_tex.clone(),
                message: format!("Failed to copy texture '{}': {}", src_tex.display(), e),
            })?;

            staged_texture_paths.push(staged_tex);
            manifest_texture_rels.push(format!("textures/{}", tex_name));
        }

        // 3. Generate model3.json
        let manifest = Model3Manifest::new_minimal(&moc_file_name, &manifest_texture_rels)?;
        let manifest_json = manifest.to_json_pretty()?;
        let manifest_file_name = format!("{}.model3.json", final_dir_name);
        let staged_manifest_path = staging_path.join(&manifest_file_name);

        fs::write(&staged_manifest_path, manifest_json).map_err(|e| DomainError::IoError {
            code: ErrorCode::ErrIo,
            path: staged_manifest_path.clone(),
            message: format!("Failed to write manifest: {}", e),
        })?;

        // 4. Atomic move / rename staging to final target directory
        if target_dir.exists() && conflict_policy == ConflictPolicy::Overwrite {
            fs::remove_dir_all(&target_dir).map_err(|e| DomainError::IoError {
                code: ErrorCode::ErrIo,
                path: target_dir.clone(),
                message: format!("Failed to remove existing directory for overwrite: {}", e),
            })?;
        }

        // Rename staging path to target directory
        fs::rename(staging_path, &target_dir).map_err(|e| DomainError::IoError {
            code: ErrorCode::ErrIo,
            path: target_dir.clone(),
            message: format!("Failed to rename staging directory to final target: {}", e),
        })?;

        // Disable automatic deletion of tempdir since we moved it
        let _ = staging_temp.keep();

        let final_moc = target_dir.join(&moc_file_name);
        let final_manifest = target_dir.join(&manifest_file_name);
        let final_textures = manifest_texture_rels
            .iter()
            .map(|rel| target_dir.join(rel))
            .collect();

        Ok(PackageBuildResult {
            package_dir: target_dir,
            moc_path: final_moc,
            manifest_path: final_manifest,
            texture_paths: final_textures,
        })
    }
}

pub fn sanitize_filename(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect()
}

fn resolve_target_directory(
    output_root: &Path,
    base_name: &str,
    policy: ConflictPolicy,
) -> Result<PathBuf, DomainError> {
    let candidate = output_root.join(base_name);
    if !candidate.exists() {
        return Ok(candidate);
    }

    match policy {
        ConflictPolicy::Skip => Err(DomainError::OutputCollision {
            code: ErrorCode::ErrOutputCollision,
            path: candidate,
        }),
        ConflictPolicy::Overwrite => Ok(candidate),
        ConflictPolicy::UniqueSuffix => {
            let mut counter = 1;
            loop {
                let suffixed = output_root.join(format!("{}_{}", base_name, counter));
                if !suffixed.exists() {
                    return Ok(suffixed);
                }
                counter += 1;
                if counter > 10000 {
                    return Err(DomainError::OutputCollision {
                        code: ErrorCode::ErrOutputCollision,
                        path: suffixed,
                    });
                }
            }
        }
    }
}
