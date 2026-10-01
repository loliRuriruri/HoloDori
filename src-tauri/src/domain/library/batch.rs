use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::domain::types::{
    BatchBuildReport, BatchProgress, BuildStatus, MatchedPair, MocVersion, ModelBuildReport,
    RuntimeValidationStatus, ValidationStageResult,
};
use crate::domain::{ConversionPipeline, PipelineConfig};

pub struct BatchBuildManager {
    pipeline: ConversionPipeline,
}

impl BatchBuildManager {
    pub fn new(config: PipelineConfig) -> Self {
        Self {
            pipeline: ConversionPipeline::new(config),
        }
    }

    pub fn run_batch<F>(
        &self,
        pairs: &[MatchedPair],
        output_dir: &Path,
        source_hashes: &HashMap<PathBuf, String>,
        cancel_flag: &AtomicBool,
        mut progress_cb: F,
    ) -> BatchBuildReport
    where
        F: FnMut(BatchProgress),
    {
        let total = pairs.len();
        let mut reports = Vec::new();
        let mut passed = 0;
        let mut passed_with_warnings = 0;
        let mut failed = 0;

        for (idx, pair) in pairs.iter().enumerate() {
            // Check cancellation cleanly at model boundary
            if cancel_flag.load(Ordering::SeqCst) {
                // Record remaining models as cancelled
                for remaining in &pairs[idx..] {
                    reports.push(ModelBuildReport {
                        model_id: remaining.id.clone(),
                        status: BuildStatus::Fail,
                        moc_version: MocVersion::Invalid,
                        runtime_validation: RuntimeValidationStatus::NotTested,
                        runtime_details: None,
                        input_files: vec![remaining.model_source.clone()],
                        output_files: Vec::new(),
                        output_directory: None,
                        validation_stages: vec![ValidationStageResult {
                            stage_name: "Batch Execution".to_string(),
                            passed: false,
                            message: "Build cancelled by user".to_string(),
                        }],
                        warnings: vec!["Batch execution cancelled by user".to_string()],
                        errors: vec!["Cancelled".to_string()],
                    });
                    failed += 1;
                }
                break;
            }

            // Report progress before starting model
            progress_cb(BatchProgress {
                current_index: idx + 1,
                total_models: total,
                current_model_id: pair.id.clone(),
                stage: "Building".to_string(),
                status: "InProgress".to_string(),
            });

            // Convert and validate with existing PackageBuilder / PackageValidator
            let report = self
                .pipeline
                .build_and_validate(pair, output_dir, source_hashes);
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

        BatchBuildReport {
            total_models: total,
            passed,
            passed_with_warnings,
            failed,
            reports,
            overall_status,
        }
    }
}
