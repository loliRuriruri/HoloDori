use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::command;
use tauri::Emitter;

pub mod desktop;
pub use desktop::{
    close_desktop_window, get_available_monitors, get_desktop_window_state, open_desktop_window,
    send_desktop_control, set_desktop_always_on_top, set_desktop_bounds, set_desktop_click_through,
    DesktopState,
};

pub mod wallpaper;
pub use wallpaper::{
    disable_wallpaper, enable_wallpaper, get_wallpaper_diagnostics, get_wallpaper_state,
    recover_wallpaper, set_wallpaper_mode, WallpaperAppState,
};

use crate::domain::library::batch::BatchBuildManager;
use crate::domain::types::{
    BatchBuildReport, BuildStatus, CharacterLibrary, ConflictPolicy, MatchedPair,
};
use crate::domain::{ConversionPipeline, PipelineConfig};

pub struct BatchState {
    pub cancel_flag: Arc<AtomicBool>,
}

impl Default for BatchState {
    fn default() -> Self {
        Self {
            cancel_flag: Arc::new(AtomicBool::new(false)),
        }
    }
}

pub struct ImporterState {
    pub coordinator: Arc<crate::importer::ImporterCoordinator>,
    pub detected_steam: std::sync::Mutex<Option<crate::importer::SteamDetectionResult>>,
}

impl Default for ImporterState {
    fn default() -> Self {
        Self {
            coordinator: Arc::new(crate::importer::ImporterCoordinator::new()),
            detected_steam: std::sync::Mutex::new(None),
        }
    }
}

#[command]
pub async fn scan_inputs(paths: Vec<String>) -> Result<Vec<MatchedPair>, String> {
    let path_bufs: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    let pipeline = ConversionPipeline::new(PipelineConfig::default());

    let mut files = pipeline
        .scan_inputs(&path_bufs)
        .map_err(|e| e.to_string())?;
    pipeline
        .classify_candidates(&mut files)
        .map_err(|e| e.to_string())?;
    let (pairs, _hashes) = pipeline.match_pairs(&files).map_err(|e| e.to_string())?;

    Ok(pairs)
}

#[command]
pub async fn scan_library(
    paths: Vec<String>,
    force_rescan: bool,
) -> Result<CharacterLibrary, String> {
    let path_bufs: Vec<PathBuf> = paths.into_iter().map(PathBuf::from).collect();
    let pipeline = ConversionPipeline::new(PipelineConfig::default());

    let cache_dir = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".hdm_cache");
    let cache_file = cache_dir.join("library_cache.json");

    pipeline
        .scan_library(&path_bufs, Some(&cache_file), force_rescan)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn batch_build(
    app: tauri::AppHandle,
    state: tauri::State<'_, BatchState>,
    pairs: Vec<MatchedPair>,
    output_dir: String,
    conflict_policy: ConflictPolicy,
) -> Result<BatchBuildReport, String> {
    state.cancel_flag.store(false, Ordering::SeqCst);
    let out_path = PathBuf::from(&output_dir);
    let config = PipelineConfig {
        conflict_policy,
        ..Default::default()
    };
    let manager = BatchBuildManager::new(config);

    let mut source_hashes = HashMap::new();
    for p in &pairs {
        if let Ok(hash) = crate::domain::scanner::compute_sha256(&p.model_source) {
            source_hashes.insert(p.model_source.clone(), hash);
        }
        for tex in &p.textures {
            if let Ok(hash) = crate::domain::scanner::compute_sha256(tex) {
                source_hashes.insert(tex.clone(), hash);
            }
        }
    }

    let cancel = state.cancel_flag.clone();
    let app_handle = app.clone();

    let report = manager.run_batch(
        &pairs,
        &out_path,
        &source_hashes,
        &cancel,
        move |progress| {
            let _ = app_handle.emit("batch-progress", &progress);
        },
    );

    Ok(report)
}

#[command]
pub async fn cancel_batch_build(state: tauri::State<'_, BatchState>) -> Result<(), String> {
    state.cancel_flag.store(true, Ordering::SeqCst);
    Ok(())
}

#[command]
pub async fn clear_library_cache() -> Result<(), String> {
    let cache_dir = std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".hdm_cache");
    let cache_file = cache_dir.join("library_cache.json");
    if cache_file.exists() {
        let _ = std::fs::remove_file(cache_file);
    }
    Ok(())
}

#[command]
pub async fn build_models(
    pairs: Vec<MatchedPair>,
    output_dir: String,
    conflict_policy: ConflictPolicy,
) -> Result<BatchBuildReport, String> {
    let out_path = PathBuf::from(&output_dir);
    let config = PipelineConfig {
        conflict_policy,
        ..Default::default()
    };
    let pipeline = ConversionPipeline::new(config);

    // Collect source hashes for integrity validation
    let mut source_hashes = HashMap::new();
    for p in &pairs {
        if let Ok(hash) = crate::domain::scanner::compute_sha256(&p.model_source) {
            source_hashes.insert(p.model_source.clone(), hash);
        }
        for tex in &p.textures {
            if let Ok(hash) = crate::domain::scanner::compute_sha256(tex) {
                source_hashes.insert(tex.clone(), hash);
            }
        }
    }

    let mut reports = Vec::new();
    let mut passed = 0;
    let mut passed_with_warnings = 0;
    let mut failed = 0;

    for pair in &pairs {
        let report = pipeline.build_and_validate(pair, &out_path, &source_hashes);
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

#[command]
pub async fn get_default_output_dir() -> Result<String, String> {
    let current = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let default_out = current.join("output");
    Ok(default_out.to_string_lossy().to_string())
}

#[command]
pub async fn detect_game_install(
    state: tauri::State<'_, ImporterState>,
) -> Result<crate::importer::SteamDetectionResult, String> {
    let res = crate::importer::ImporterCoordinator::detect_steam();
    let mut lock = state.detected_steam.lock().map_err(|e| e.to_string())?;
    *lock = Some(res.clone());
    Ok(res)
}

#[command]
pub async fn set_game_install_path(
    path: String,
    state: tauri::State<'_, ImporterState>,
) -> Result<crate::importer::SteamDetectionResult, String> {
    let p = PathBuf::from(&path);
    let res = crate::importer::ImporterCoordinator::validate_game_path(&p);
    let mut lock = state.detected_steam.lock().map_err(|e| e.to_string())?;
    *lock = Some(res.clone());
    Ok(res)
}

#[command]
pub async fn load_game_catalog(
    octocache_path: Option<String>,
    state: tauri::State<'_, ImporterState>,
) -> Result<Vec<crate::importer::ModelCatalogEntry>, String> {
    let target_octo = if let Some(p) = octocache_path {
        PathBuf::from(p)
    } else {
        let lock = state.detected_steam.lock().map_err(|e| e.to_string())?;
        let detected = lock.as_ref().ok_or_else(|| {
            "No Steam game detected. Please run detection or specify path.".to_string()
        })?;
        let octo_str = detected
            .octocache_path
            .as_ref()
            .ok_or_else(|| "No octocacheevai located in game folder.".to_string())?;
        PathBuf::from(octo_str)
    };

    state
        .coordinator
        .load_catalog(&target_octo)
        .map_err(|e| e.to_string())
}

#[command]
pub async fn import_models(
    app: tauri::AppHandle,
    state: tauri::State<'_, ImporterState>,
    entries: Vec<crate::importer::ModelCatalogEntry>,
    output_dir: String,
    conflict_policy: ConflictPolicy,
) -> Result<crate::importer::ImportExecutionResult, String> {
    let dest = PathBuf::from(&output_dir);
    let app_handle = app.clone();
    let coordinator = state.coordinator.clone();

    coordinator
        .import_models(&entries, &dest, conflict_policy, move |progress| {
            let _ = app_handle.emit("import-progress", &progress);
        })
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn cancel_import(state: tauri::State<'_, ImporterState>) -> Result<(), String> {
    state.coordinator.cancel();
    Ok(())
}

#[command]
pub async fn get_import_cache_stats(
    state: tauri::State<'_, ImporterState>,
) -> Result<crate::importer::CacheStats, String> {
    Ok(state.coordinator.cache_stats())
}

#[command]
pub async fn clear_import_cache(state: tauri::State<'_, ImporterState>) -> Result<u64, String> {
    state.coordinator.clear_cache().map_err(|e| e.to_string())
}

#[command]
pub async fn read_package_file(
    package_dir: String,
    relative_path: String,
) -> Result<Vec<u8>, String> {
    let pkg_path = PathBuf::from(&package_dir);
    if !pkg_path.is_dir() {
        return Err(format!("Package directory does not exist: {package_dir}"));
    }
    let canonical_pkg = pkg_path
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize package dir {package_dir}: {e}"))?;

    let target = canonical_pkg.join(&relative_path);
    let canonical_target = target
        .canonicalize()
        .map_err(|e| format!("File not found in package: {relative_path}: {e}"))?;

    // Security: Strict path containment verification to prevent directory traversal
    if !canonical_target.starts_with(&canonical_pkg) {
        return Err("Access denied: target file escapes package directory".to_string());
    }

    std::fs::read(&canonical_target)
        .map_err(|e| format!("Failed to read {}: {e}", canonical_target.display()))
}

#[command]
pub async fn get_model_animations(
    state: tauri::State<'_, ImporterState>,
    character_id: String,
    octocache_path: Option<String>,
) -> Result<crate::importer::ModelAnimationMetadata, String> {
    let octo_path = octocache_path.map(PathBuf::from);
    state
        .coordinator
        .get_model_animations(&character_id, octo_path.as_deref())
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_expression_bytes(
    state: tauri::State<'_, ImporterState>,
    object_name: String,
    asset_name: String,
    md5: String,
    expected_size: Option<u64>,
) -> Result<Vec<u8>, String> {
    state
        .coordinator
        .acquire_and_extract_expression(&object_name, &asset_name, &md5, expected_size)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_motion_bytes(
    state: tauri::State<'_, ImporterState>,
    object_name: String,
    asset_name: String,
    md5: String,
    expected_size: Option<u64>,
) -> Result<Vec<u8>, String> {
    state
        .coordinator
        .acquire_and_extract_motion(&object_name, &asset_name, &md5, expected_size)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn get_physics_bytes(
    state: tauri::State<'_, ImporterState>,
    object_name: String,
    asset_name: String,
    md5: String,
    expected_size: Option<u64>,
) -> Result<Option<Vec<u8>>, String> {
    state
        .coordinator
        .acquire_and_extract_physics(&object_name, &asset_name, &md5, expected_size)
        .await
        .map_err(|e| e.to_string())
}

#[command]
pub async fn load_player_settings() -> Result<serde_json::Value, String> {
    let path = get_settings_path();
    if path.exists() {
        let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let val: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        Ok(val)
    } else {
        Ok(serde_json::json!({}))
    }
}

#[command]
pub async fn save_player_settings(settings: serde_json::Value) -> Result<(), String> {
    let path = get_settings_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

fn get_settings_path() -> PathBuf {
    std::env::current_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join(".hdm_cache")
        .join("player_settings.json")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_read_package_file_success_and_traversal() {
        let dir = tempdir().unwrap();
        let pkg_dir = dir.path().join("model_pkg");
        std::fs::create_dir_all(pkg_dir.join("textures")).unwrap();
        std::fs::write(pkg_dir.join("model3.json"), b"{\"Version\": 3}").unwrap();
        std::fs::write(
            pkg_dir.join("textures").join("texture_00.png"),
            b"fake_png_data",
        )
        .unwrap();

        // Write file outside package directory
        let secret = dir.path().join("secret.txt");
        std::fs::write(&secret, b"sensitive_data").unwrap();

        let pkg_str = pkg_dir.to_str().unwrap().to_string();

        // 1. Success reading model3.json
        let res = read_package_file(pkg_str.clone(), "model3.json".into())
            .await
            .unwrap();
        assert_eq!(res, b"{\"Version\": 3}");

        // 2. Success reading subpath
        let tex_res = read_package_file(pkg_str.clone(), "textures/texture_00.png".into())
            .await
            .unwrap();
        assert_eq!(tex_res, b"fake_png_data");

        // 3. Error on non-existent file
        let not_found = read_package_file(pkg_str.clone(), "nonexistent.moc3".into()).await;
        assert!(not_found.is_err());

        // 4. Security rejection on path traversal attempt
        let traversal = read_package_file(pkg_str.clone(), "../secret.txt".into()).await;
        assert!(traversal.is_err());
        assert!(traversal.unwrap_err().contains("escapes package directory"));
    }

    #[tokio::test]
    async fn test_animation_commands_octocache_not_found() {
        // Test with non-existent path
        let coordinator = Arc::new(crate::importer::ImporterCoordinator::new());
        let res = coordinator
            .get_model_animations("00007", Some(std::path::Path::new("non_existent_octo.dat")));
        assert!(res.is_err());
    }
}
