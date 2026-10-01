use std::collections::HashMap;
use std::path::PathBuf;
use tauri::command;

use crate::domain::types::{BatchBuildReport, BuildStatus, ConflictPolicy, MatchedPair};
use crate::domain::{ConversionPipeline, PipelineConfig};

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
    // Current directory / output or standard directory
    let current = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let default_out = current.join("output");
    Ok(default_out.to_string_lossy().to_string())
}
