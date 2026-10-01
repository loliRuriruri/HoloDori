use std::collections::BTreeMap;
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

    /// Extracts Live2D Cubism expression definition (.exp3.json) from a `live2d_exp_*` bundle.
    pub fn extract_expression(
        bundle_path: &Path,
        asset_name: &str,
    ) -> Result<Vec<u8>, DomainError> {
        info!(
            "Extracting expression from bundle: {}",
            bundle_path.display()
        );

        let raw_bundle = fs::read(bundle_path).map_err(|e| {
            DomainError::io(
                bundle_path,
                format!(
                    "Failed to read expression bundle {}: {e}",
                    bundle_path.display()
                ),
            )
        })?;

        let mut unmasked = raw_bundle;
        deobfuscate_bundle_header(&mut unmasked, asset_name);

        let temp_dir = tempfile::tempdir().map_err(|e| {
            DomainError::importer(
                ErrorCode::ErrIo,
                format!("Failed to create temporary directory: {e}"),
            )
        })?;
        let temp_bundle_path = temp_dir.path().join("bundle.unity3d");
        fs::write(&temp_bundle_path, &unmasked).map_err(|e| {
            DomainError::io(&temp_bundle_path, format!("Failed to write bundle: {e}"))
        })?;

        let region = Region::from_file(&temp_bundle_path).map_err(|e| {
            DomainError::importer(
                ErrorCode::ErrCorruptedData,
                format!("Failed to map bundle: {e}"),
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
                format!("Failed to parse bundle: {e}"),
            )
        })?;

        if bundle.entries.is_empty() {
            return Err(DomainError::importer(
                ErrorCode::ErrCorruptedData,
                "Expression bundle contains zero entries",
            ));
        }

        let mut block_cache = BlockDecodeCache::new();
        let raw_entry_bytes = bundle
            .read_entry_with_cache(0, &mut block_cache)
            .map_err(|e| {
                DomainError::importer(
                    ErrorCode::ErrCorruptedData,
                    format!("Failed to decompress entry: {e}"),
                )
            })?;

        let unity_version: UnityVersion = resolve_unity_version(None).parse().unwrap_or_default();
        let file = SerializedFile::open_with_options(
            Region::from_bytes(raw_entry_bytes.clone()),
            SerializedOpenOptions {
                unity_version_override: Some(unity_version),
                bundle_version_hint: None,
                strict_unity_versions: false,
                ..SerializedOpenOptions::default()
            },
        )
        .map_err(|e| {
            DomainError::importer(
                ErrorCode::ErrCorruptedData,
                format!("Failed to open serialized file: {e}"),
            )
        })?;

        for obj in &file.objects {
            if obj.class_id == 114 {
                let start = obj.byte_start as usize;
                let end = start + obj.byte_size as usize;
                if end <= raw_entry_bytes.len() {
                    let data = &raw_entry_bytes[start..end];
                    if let Some(json_bytes) = Self::parse_cubism_expression_data(data) {
                        debug!("Successfully extracted expression from {asset_name}");
                        return Ok(json_bytes);
                    }
                }
            }
        }

        Err(DomainError::importer(
            ErrorCode::ErrCorruptedData,
            format!("No valid CubismExpressionData found in bundle {asset_name}"),
        ))
    }

    /// Parses CubismExpressionData MonoBehaviour payload into standard .exp3.json bytes.
    fn parse_cubism_expression_data(data: &[u8]) -> Option<Vec<u8>> {
        for offset in 0..data.len().saturating_sub(20) {
            let len = u32::from_le_bytes(data[offset..offset + 4].try_into().ok()?) as usize;
            if len == 17
                && offset + 4 + len <= data.len()
                && &data[offset + 4..offset + 4 + len] == b"Live2D Expression"
            {
                let mut cur = offset + 4 + 20; // 17 padded to 4 = 20
                if cur + 12 > data.len() {
                    return None;
                }
                let fade_in = f32::from_le_bytes(data[cur..cur + 4].try_into().ok()?);
                let fade_out = f32::from_le_bytes(data[cur + 4..cur + 8].try_into().ok()?);
                let count = u32::from_le_bytes(data[cur + 8..cur + 12].try_into().ok()?) as usize;
                cur += 12;

                let mut parameters = Vec::new();
                for _ in 0..count {
                    if cur + 4 > data.len() {
                        break;
                    }
                    let id_len = u32::from_le_bytes(data[cur..cur + 4].try_into().ok()?) as usize;
                    cur += 4;
                    if cur + id_len > data.len() {
                        break;
                    }
                    let id = std::str::from_utf8(&data[cur..cur + id_len])
                        .ok()?
                        .to_string();
                    cur += (id_len + 3) & !3;

                    if cur + 8 > data.len() {
                        break;
                    }
                    let value = f32::from_le_bytes(data[cur..cur + 4].try_into().ok()?);
                    let blend_mode = u32::from_le_bytes(data[cur + 4..cur + 8].try_into().ok()?);
                    cur += 8;

                    let blend_str = match blend_mode {
                        0 => "Overwrite",
                        1 => "Add",
                        2 => "Multiply",
                        _ => "Add",
                    };

                    parameters.push(serde_json::json!({
                        "Id": id,
                        "Value": value,
                        "Blend": blend_str,
                    }));
                }

                let exp_json = serde_json::json!({
                    "Type": "Live2D Expression",
                    "FadeInTime": fade_in,
                    "FadeOutTime": fade_out,
                    "Parameters": parameters
                });

                return serde_json::to_vec_pretty(&exp_json).ok();
            }
        }
        None
    }

    /// Extracts Live2D Cubism motion (.motion3.json) from a `live2d_mot_*` bundle.
    pub fn extract_motion(bundle_path: &Path, asset_name: &str) -> Result<Vec<u8>, DomainError> {
        info!("Extracting motion from bundle: {}", bundle_path.display());

        let raw_bundle = fs::read(bundle_path).map_err(|e| {
            DomainError::io(
                bundle_path,
                format!(
                    "Failed to read motion bundle {}: {e}",
                    bundle_path.display()
                ),
            )
        })?;

        let mut unmasked = raw_bundle;
        deobfuscate_bundle_header(&mut unmasked, asset_name);

        let temp_dir = tempfile::tempdir().map_err(|e| {
            DomainError::importer(
                ErrorCode::ErrIo,
                format!("Failed to create temporary directory: {e}"),
            )
        })?;
        let temp_bundle_path = temp_dir.path().join("bundle.unity3d");
        fs::write(&temp_bundle_path, &unmasked).map_err(|e| {
            DomainError::io(&temp_bundle_path, format!("Failed to write bundle: {e}"))
        })?;

        let region = Region::from_file(&temp_bundle_path).map_err(|e| {
            DomainError::importer(
                ErrorCode::ErrCorruptedData,
                format!("Failed to map bundle: {e}"),
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
                format!("Failed to parse bundle: {e}"),
            )
        })?;

        if bundle.entries.is_empty() {
            return Err(DomainError::importer(
                ErrorCode::ErrCorruptedData,
                "Motion bundle contains zero entries",
            ));
        }

        let mut block_cache = BlockDecodeCache::new();
        let raw_entry_bytes = bundle
            .read_entry_with_cache(0, &mut block_cache)
            .map_err(|e| {
                DomainError::importer(
                    ErrorCode::ErrCorruptedData,
                    format!("Failed to decompress entry: {e}"),
                )
            })?;

        let unity_version: UnityVersion = resolve_unity_version(None).parse().unwrap_or_default();
        let file = SerializedFile::open_with_options(
            Region::from_bytes(raw_entry_bytes.clone()),
            SerializedOpenOptions {
                unity_version_override: Some(unity_version),
                bundle_version_hint: None,
                strict_unity_versions: false,
                ..SerializedOpenOptions::default()
            },
        )
        .map_err(|e| {
            DomainError::importer(
                ErrorCode::ErrCorruptedData,
                format!("Failed to open serialized file: {e}"),
            )
        })?;

        // 1. Extract bindings (curve names & fade times) from Live2DMotionDefine (class 114)
        let mut param_names = Vec::new();
        let mut fade_in = 0.5f32;
        let mut fade_out = 0.5f32;

        for obj in &file.objects {
            if obj.class_id == 114 {
                let start = obj.byte_start as usize;
                let end = start + obj.byte_size as usize;
                if end <= raw_entry_bytes.len() {
                    let data = &raw_entry_bytes[start..end];
                    if let Some((names, fi, fo)) = Self::parse_motion_define(data) {
                        param_names = names;
                        fade_in = fi;
                        fade_out = fo;
                        break;
                    }
                }
            }
        }

        if param_names.is_empty() {
            return Err(DomainError::importer(
                ErrorCode::ErrCorruptedData,
                format!("No Live2DMotionDefine parameter bindings found in {asset_name}"),
            ));
        }

        // 2. Extract curves from AnimationClip (class 74)
        for obj in &file.objects {
            if obj.class_id == 74 {
                let start = obj.byte_start as usize;
                let end = start + obj.byte_size as usize;
                if end <= raw_entry_bytes.len() {
                    let data = &raw_entry_bytes[start..end];
                    if let Some(motion_bytes) = Self::parse_animation_clip(
                        data,
                        &param_names,
                        fade_in,
                        fade_out,
                        asset_name.ends_with("_lp"),
                    ) {
                        debug!("Successfully extracted motion from {asset_name}");
                        return Ok(motion_bytes);
                    }
                }
            }
        }

        Err(DomainError::importer(
            ErrorCode::ErrCorruptedData,
            format!("No valid AnimationClip stream found in motion bundle {asset_name}"),
        ))
    }

    /// Parses Live2DMotionDefine MonoBehaviour to extract curve names and fade times.
    fn parse_motion_define(data: &[u8]) -> Option<(Vec<String>, f32, f32)> {
        for offset in 0..data.len().saturating_sub(8) {
            let count = u32::from_le_bytes(data[offset..offset + 4].try_into().ok()?) as usize;
            if (10..=100).contains(&count) {
                let next_len =
                    u32::from_le_bytes(data[offset + 4..offset + 8].try_into().ok()?) as usize;
                if (10..=30).contains(&next_len) && offset + 8 + next_len <= data.len() {
                    let first_str =
                        std::str::from_utf8(&data[offset + 8..offset + 8 + next_len]).ok()?;
                    if first_str.starts_with("Param") {
                        let mut cur = offset + 4;
                        let mut names = Vec::with_capacity(count);

                        for _ in 0..count {
                            if cur + 4 > data.len() {
                                break;
                            }
                            let len1 =
                                u32::from_le_bytes(data[cur..cur + 4].try_into().ok()?) as usize;
                            cur += 4;
                            if cur + len1 > data.len() {
                                break;
                            }
                            let id = std::str::from_utf8(&data[cur..cur + len1])
                                .ok()?
                                .to_string();
                            cur += (len1 + 3) & !3;

                            // Skip path string
                            if cur + 4 > data.len() {
                                break;
                            }
                            let len2 =
                                u32::from_le_bytes(data[cur..cur + 4].try_into().ok()?) as usize;
                            cur += 4 + ((len2 + 3) & !3);

                            // Skip type string
                            if cur + 4 > data.len() {
                                break;
                            }
                            let len3 =
                                u32::from_le_bytes(data[cur..cur + 4].try_into().ok()?) as usize;
                            cur += 4 + ((len3 + 3) & !3);

                            // Skip bindingType
                            cur += 4;

                            // Skip prop string
                            if cur + 4 > data.len() {
                                break;
                            }
                            let len4 =
                                u32::from_le_bytes(data[cur..cur + 4].try_into().ok()?) as usize;
                            cur += 4 + ((len4 + 3) & !3);

                            names.push(id);
                        }

                        let mut fade_in = 0.5f32;
                        let mut fade_out = 0.5f32;
                        if cur + 8 <= data.len() {
                            let fi = f32::from_le_bytes(data[cur..cur + 4].try_into().ok()?);
                            let fo = f32::from_le_bytes(data[cur + 4..cur + 8].try_into().ok()?);
                            if (0.0..=5.0).contains(&fi) {
                                fade_in = fi;
                            }
                            if (0.0..=5.0).contains(&fo) {
                                fade_out = fo;
                            }
                        }

                        if names.len() == count {
                            return Some((names, fade_in, fade_out));
                        }
                    }
                }
            }
        }
        None
    }

    /// Parses AnimationClip StreamedClip into standard Live2D .motion3.json bytes.
    fn parse_animation_clip(
        data: &[u8],
        param_names: &[String],
        fade_in: f32,
        fade_out: f32,
        is_loop: bool,
    ) -> Option<Vec<u8>> {
        let max_curves = param_names.len();
        let mut curves_map: BTreeMap<usize, Vec<(f32, f32)>> = BTreeMap::new();
        let mut max_time: f32 = 0.0;

        // Find the valid stream sequence of frames
        for start_pos in (0..data.len().saturating_sub(100)).step_by(4) {
            let mut cur = start_pos;
            let mut last_time = -0.001f32;
            let mut frame_count = 0;
            let mut stream_curves: BTreeMap<usize, Vec<(f32, f32)>> = BTreeMap::new();
            let mut stream_max_time = 0.0f32;

            while cur + 8 <= data.len() {
                let time = f32::from_le_bytes(data[cur..cur + 4].try_into().ok()?);
                let num = u32::from_le_bytes(data[cur + 4..cur + 8].try_into().ok()?) as usize;

                if time.is_nan() || time < last_time || time > 120.0 || num == 0 || num > max_curves
                {
                    break;
                }

                let frame_len = 8 + num * 20;
                if cur + frame_len > data.len() {
                    break;
                }

                let mut curves_ok = true;
                for k in 0..num {
                    let idx = u32::from_le_bytes(
                        data[cur + 8 + k * 20..cur + 8 + k * 20 + 4]
                            .try_into()
                            .ok()?,
                    );
                    if idx as usize >= max_curves {
                        curves_ok = false;
                        break;
                    }
                }

                if !curves_ok {
                    break;
                }

                for k in 0..num {
                    let k_pos = cur + 8 + k * 20;
                    let k_idx =
                        u32::from_le_bytes(data[k_pos..k_pos + 4].try_into().ok()?) as usize;
                    let val = f32::from_le_bytes(data[k_pos + 16..k_pos + 20].try_into().ok()?);
                    stream_curves.entry(k_idx).or_default().push((time, val));
                }

                last_time = time;
                if time > stream_max_time {
                    stream_max_time = time;
                }
                cur += frame_len;
                frame_count += 1;
            }

            if frame_count >= 5 {
                curves_map = stream_curves;
                max_time = stream_max_time;
                break;
            }
        }

        if curves_map.is_empty() {
            return None;
        }

        let mut curves_json = Vec::new();
        let mut total_points = 0;
        let mut total_segments = 0;

        for (c_idx, keyframes) in curves_map {
            if c_idx >= param_names.len() {
                continue;
            }
            let param_id = &param_names[c_idx];

            let mut segments = Vec::new();
            if let Some((first_t, first_v)) = keyframes.first() {
                segments.push(*first_t as f64);
                segments.push(*first_v as f64);
                total_points += 1;

                for (t, v) in keyframes.iter().skip(1) {
                    segments.push(0.0); // 0 = Linear segment
                    segments.push(*t as f64);
                    segments.push(*v as f64);
                    total_segments += 1;
                    total_points += 1;
                }
            }

            curves_json.push(serde_json::json!({
                "Target": "Parameter",
                "Id": param_id,
                "FadeInTime": -1.0,
                "FadeOutTime": -1.0,
                "Segments": segments
            }));
        }

        let motion_json = serde_json::json!({
            "Version": 3,
            "Meta": {
                "Duration": max_time,
                "Fps": 30.0,
                "Loop": is_loop,
                "AreBeziersRestricted": true,
                "FadeInTime": fade_in,
                "FadeOutTime": fade_out,
                "CurveCount": curves_json.len(),
                "TotalSegmentCount": total_segments,
                "TotalPointCount": total_points
            },
            "Curves": curves_json
        });

        serde_json::to_vec_pretty(&motion_json).ok()
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

    #[test]
    fn test_extract_real_expression_and_motion_if_cached() {
        let exp_path = Path::new("../target/audit_cache/H11SYY");
        if exp_path.exists() {
            let exp_bytes =
                UnityExtractor::extract_expression(exp_path, "live2d_exp_anger-01_00007_000")
                    .unwrap();
            let exp_json: serde_json::Value = serde_json::from_slice(&exp_bytes).unwrap();
            assert_eq!(exp_json["Type"], "Live2D Expression");
            assert!((exp_json["FadeInTime"].as_f64().unwrap() - 0.3).abs() < 1e-4);
            assert!((exp_json["FadeOutTime"].as_f64().unwrap() - 0.3).abs() < 1e-4);
            let params = exp_json["Parameters"].as_array().unwrap();
            assert_eq!(params.len(), 31);
            assert_eq!(params[0]["Id"], "ParamEyeROpen");
            assert_eq!(params[0]["Blend"], "Multiply");
            assert_eq!(params[1]["Id"], "ParamEyeRSmile");
            assert_eq!(params[1]["Blend"], "Add");
            let _ = std::fs::write("../target/audit_cache/test_exp.exp3.json", &exp_bytes);
        }

        let mot_path = Path::new("../target/audit_cache/CoBQ5y");
        if mot_path.exists() {
            let mot_bytes =
                UnityExtractor::extract_motion(mot_path, "live2d_mot_joy-01_lv01").unwrap();
            let mot_json: serde_json::Value = serde_json::from_slice(&mot_bytes).unwrap();
            assert_eq!(mot_json["Version"], 3);
            assert_eq!(mot_json["Meta"]["Fps"], 30.0);
            assert_eq!(mot_json["Meta"]["FadeInTime"], 0.5);
            assert_eq!(mot_json["Meta"]["FadeOutTime"], 0.5);
            let curves = mot_json["Curves"].as_array().unwrap();
            assert_eq!(curves.len(), 27);
            assert_eq!(curves[0]["Id"], "ParamAngleX");
            let segs = curves[0]["Segments"].as_array().unwrap();
            assert!(!segs.is_empty());
            let _ = std::fs::write("../target/audit_cache/test_mot.motion3.json", &mot_bytes);
        }
    }
}
