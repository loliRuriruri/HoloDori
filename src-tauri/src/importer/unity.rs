use std::fs;
use std::path::Path;
use tracing::{debug, info};

use unity_rs_core::bundle::{
    BlockDecodeCache, BundleOpenOptions, BundleParseLimits, UnityFsBundle,
};
use unity_rs_core::cubism_moc::{read_cubism_moc, CubismMocReadLimits};
use unity_rs_core::image_export::{write_rgba_image, ImageFormat, ImageRowOrder};
use unity_rs_core::loader::{
    AssetCollection, AssetCollectionParts, AssetLoadLimits, LoadedResource, LoadedSerializedFile,
};
use unity_rs_core::serialized::{SerializedFile, SerializedOpenOptions};
use unity_rs_core::source::Region;
use unity_rs_core::texture::{read_texture2d, TextureReadLimits};
use unity_rs_core::unity_version::UnityVersion;

use super::types::{ExtractedLive2DAsset, ExtractedTexture};
use crate::domain::error::{DomainError, ErrorCode};
use crate::domain::octo::deobfuscate_bundle_header;

/// Authoritative default Unity version override for HoloDori asset bundles.
///
/// Provenance:
/// HoloDori (Steam AppID 4282500) bundles have stripped version headers ("0.0.0").
/// The official game binary ships with UnityPlayer.dll (ProductVersion "6000.3.15f1 (c1aa84e375f6)").
/// unity-rs-core requires this override to resolve version-dependent Texture2D layout.
pub const DEFAULT_UNITY_VERSION_OVERRIDE: &str = "6000.3.15f1";

/// Resolves the Unity version to use during asset extraction.
/// Probes installed game directory (e.g. from UnityPlayer.dll version string)
/// if available, and falls back to DEFAULT_UNITY_VERSION_OVERRIDE.
pub fn resolve_unity_version(game_dir: Option<&Path>) -> String {
    if let Some(dir) = game_dir {
        let player_dll = dir.join("UnityPlayer.dll");
        if player_dll.is_file() {
            if let Ok(bytes) = fs::read(&player_dll) {
                let text = String::from_utf8_lossy(&bytes);
                if let Ok(re) = regex::Regex::new(r"\b(6000\.\d+\.\d+[a-z]\d+)\b") {
                    if let Some(cap) = re.captures(&text) {
                        if let Some(m) = cap.get(1) {
                            let ver = m.as_str().to_string();
                            info!(
                                "Dynamically resolved Unity version from UnityPlayer.dll: {}",
                                ver
                            );
                            return ver;
                        }
                    }
                }
            }
        }
    }
    DEFAULT_UNITY_VERSION_OVERRIDE.to_string()
}

pub struct UnityExtractor;

impl UnityExtractor {
    /// Extracts Cubism MOC3 and Texture2D PNGs from an obfuscated HoloDori asset bundle.
    pub fn extract_bundle(
        bundle_path: &Path,
        asset_name: &str,
    ) -> Result<ExtractedLive2DAsset, DomainError> {
        info!(
            "Extracting Live2D asset from bundle: {}",
            bundle_path.display()
        );

        let raw_bundle = fs::read(bundle_path).map_err(|e| {
            DomainError::io(
                bundle_path,
                format!("Failed to read bundle file {}: {e}", bundle_path.display()),
            )
        })?;

        let mut unmasked = raw_bundle;
        deobfuscate_bundle_header(&mut unmasked, asset_name);

        let temp_dir = tempfile::tempdir().map_err(|e| {
            DomainError::importer(
                ErrorCode::ErrIo,
                format!("Failed to create temporary extraction directory: {e}"),
            )
        })?;
        let temp_bundle_path = temp_dir.path().join("bundle.unity3d");
        fs::write(&temp_bundle_path, &unmasked).map_err(|e| {
            DomainError::io(
                &temp_bundle_path,
                format!("Failed to write deobfuscated bundle: {e}"),
            )
        })?;

        let region = Region::from_file(&temp_bundle_path).map_err(|e| {
            DomainError::importer(
                ErrorCode::ErrCorruptedData,
                format!("Failed to map bundle region: {e}"),
            )
        })?;

        let bundle = UnityFsBundle::open_with_options(
            &region,
            BundleOpenOptions {
                limits: BundleParseLimits::default(),
                oodle_decoder: None,
                unity_cn_key: None,
            },
        )
        .map_err(|e| {
            DomainError::importer(
                ErrorCode::ErrCorruptedData,
                format!("Failed to parse UnityFS bundle: {e}"),
            )
        })?;

        let ver_str = resolve_unity_version(None);
        info!("Applying Unity version override: {}", ver_str);
        let unity_version: UnityVersion = ver_str.parse().map_err(|e| {
            DomainError::importer(
                ErrorCode::ErrImporterFailed,
                format!("Invalid or incompatible Unity version override '{ver_str}': {e}"),
            )
        })?;

        let mut block_cache = BlockDecodeCache::new();
        let mut loaded_files = Vec::new();
        let mut loaded_resources = Vec::new();

        for index in 0..bundle.entries.len() {
            let entry = &bundle.entries[index];
            let bytes = bundle
                .read_entry_with_cache(index, &mut block_cache)
                .map_err(|e| {
                    DomainError::importer(
                        ErrorCode::ErrCorruptedData,
                        format!("Failed to decompress entry {}: {e}", entry.path),
                    )
                })?;
            let entry_region = Region::from_bytes(bytes);

            match SerializedFile::open_with_options(
                entry_region.clone(),
                SerializedOpenOptions {
                    unity_version_override: Some(unity_version.clone()),
                    bundle_version_hint: None,
                    strict_unity_versions: false,
                    ..SerializedOpenOptions::default()
                },
            ) {
                Ok(file) => {
                    loaded_files.push(LoadedSerializedFile {
                        path: entry.path.clone(),
                        file,
                    });
                }
                Err(_) => {
                    loaded_resources.push(LoadedResource {
                        path: entry.path.clone(),
                        region: entry_region,
                    });
                }
            }
        }

        if loaded_files.is_empty() {
            return Err(DomainError::importer(
                ErrorCode::ErrCorruptedData,
                "Bundle contains no serialized Unity files",
            ));
        }

        let mut collection = AssetCollection::from_parts(AssetCollectionParts {
            serialized_files: loaded_files,
            resources: loaded_resources,
            diagnostics: Vec::new(),
        });
        collection
            .rebuild_resource_index(AssetLoadLimits::default())
            .map_err(|e| {
                DomainError::importer(
                    ErrorCode::ErrCorruptedData,
                    format!("Failed to rebuild resource index: {e}"),
                )
            })?;

        let mut found_moc: Option<(String, Vec<u8>)> = None;
        let mut found_textures = Vec::new();

        for file_idx in 0..collection.serialized_files().len() {
            let loaded_file = &collection.serialized_files()[file_idx];
            for (obj_idx, obj) in loaded_file.file.objects.iter().enumerate() {
                // Class 114 = MonoBehaviour
                if obj.class_id == 114 {
                    if let Ok(moc) =
                        read_cubism_moc(&loaded_file.file, obj_idx, CubismMocReadLimits::default())
                    {
                        let mut moc_bytes = Vec::new();
                        if moc.write_moc3(&mut moc_bytes, 64 * 1024 * 1024).is_ok()
                            && moc_bytes.len() > 100_000
                            && moc_bytes.starts_with(b"MOC3")
                        {
                            debug!(
                                "Extracted CubismMoc: name='{}', size={} bytes",
                                moc.name,
                                moc_bytes.len()
                            );
                            found_moc = Some((moc.name.clone(), moc_bytes));
                        }
                    }
                }

                // Class 28 = Texture2D
                if obj.class_id == 28 {
                    if let Ok(tex) = read_texture2d(
                        &collection,
                        &loaded_file.file,
                        obj_idx,
                        TextureReadLimits::default(),
                    ) {
                        if let Ok(rgba) = tex.decode_mip_rgba8(0, TextureReadLimits::default()) {
                            let mut png_bytes = Vec::new();
                            if write_rgba_image(
                                &rgba,
                                ImageFormat::Png,
                                ImageRowOrder::UnityDecoded,
                                64 * 1024 * 1024,
                                &mut png_bytes,
                            )
                            .is_ok()
                            {
                                debug!(
                                    "Decoded Texture2D: name='{}', dim={}x{}, png={} bytes",
                                    tex.name,
                                    tex.width,
                                    tex.height,
                                    png_bytes.len()
                                );
                                found_textures.push(ExtractedTexture {
                                    name: tex.name.clone(),
                                    width: tex.width,
                                    height: tex.height,
                                    png_bytes,
                                });
                            }
                        }
                    }
                }
            }
        }

        let (model_name, moc3_bytes) = found_moc.ok_or_else(|| {
            DomainError::importer(
                ErrorCode::ErrCorruptedData,
                format!("No valid CubismMoc found in bundle {asset_name}"),
            )
        })?;

        if found_textures.is_empty() {
            return Err(DomainError::importer(
                ErrorCode::ErrTextureNotFound,
                format!("No valid Texture2D atlas found in bundle {asset_name}"),
            ));
        }

        // Parse character_id and outfit_id from model_name (e.g. "00007_001")
        let (character_id, outfit_id) = Self::parse_model_identity(&model_name, asset_name);

        info!(
            "Extraction complete for {}: model='{}', char={}, outfit={}, textures={}",
            asset_name,
            &model_name,
            character_id,
            outfit_id,
            found_textures.len()
        );

        Ok(ExtractedLive2DAsset {
            asset_name: asset_name.to_string(),
            model_name,
            character_id,
            outfit_id,
            moc3_bytes,
            textures: found_textures,
        })
    }

    /// Splits canonical model name e.g. "00007_001" into character "00007" and outfit "001".
    fn parse_model_identity(model_name: &str, asset_name: &str) -> (String, String) {
        let parts: Vec<&str> = model_name.split('_').collect();
        if parts.len() >= 2 && parts[0].len() == 5 && parts[1].len() == 3 {
            return (parts[0].to_string(), parts[1].to_string());
        }

        // Fallback: parse from asset_name (e.g. live2d_mdl_00007-nrml-0008-00)
        let digits: String = asset_name.chars().filter(|c| c.is_ascii_digit()).collect();
        let char_id = if digits.len() >= 5 {
            digits[..5].to_string()
        } else {
            "unknown".to_string()
        };

        (char_id, "001".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_model_identity() {
        let (c, o) =
            UnityExtractor::parse_model_identity("00007_001", "live2d_mdl_00007-nrml-0008-00");
        assert_eq!(c, "00007");
        assert_eq!(o, "001");

        let (c2, o2) =
            UnityExtractor::parse_model_identity("00010_004", "live2d_mdl_00010-uniq-0069-00");
        assert_eq!(c2, "00010");
        assert_eq!(o2, "004");
    }

    #[test]
    fn test_unity_version_override_resolution() {
        assert_eq!(DEFAULT_UNITY_VERSION_OVERRIDE, "6000.3.15f1");
        let parsed: Result<UnityVersion, _> = DEFAULT_UNITY_VERSION_OVERRIDE.parse();
        assert!(parsed.is_ok());

        // Fallback when no directory supplied
        let resolved = resolve_unity_version(None);
        assert_eq!(resolved, "6000.3.15f1");
    }
}
