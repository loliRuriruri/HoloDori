use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::command;
use tauri::Emitter;

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
