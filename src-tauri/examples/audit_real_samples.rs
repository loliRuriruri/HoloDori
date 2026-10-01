use holodori_core::domain::extractor::extract_bytes;
use holodori_core::domain::types::ConflictPolicy;
use holodori_core::domain::{ConversionPipeline, PipelineConfig};
use std::fs;
use std::path::PathBuf;

fn main() {
    println!("============================================================");
    println!("  HOLODORI LIVE2D MANAGER - REAL SAMPLE AUDIT & VALIDATION");
    println!("============================================================");

    let sample_dirs = vec![
        (
            "SAMPLE 1 (00007_001 nrml)",
            PathBuf::from(r"D:\test\holodori_real_samples\live2d"),
        ),
        (
            "SAMPLE 2 (00010_001 nrml)",
            PathBuf::from(r"D:\test\holodori_real_samples\char10_nrml\live2d"),
        ),
        (
            "SAMPLE 3 (00010_004 uniq)",
            PathBuf::from(r"D:\test\holodori_real_samples\char10_uniq69\live2d"),
        ),
        (
            "SAMPLE 4 (00007_002 uniq)",
            PathBuf::from(r"D:\test\holodori_real_samples\uniq\live2d"),
        ),
        (
            "SAMPLE 5 (00007_003 cmmn)",
            PathBuf::from(r"D:\test\holodori_real_samples\cmmn\live2d"),
        ),
    ];

    let output_base = PathBuf::from(r"D:\test\holodori_real_output");
    let _ = fs::create_dir_all(&output_base);

    let config = PipelineConfig {
        conflict_policy: ConflictPolicy::Overwrite,
        ..Default::default()
    };
    let pipeline = ConversionPipeline::new(config);

    for (label, sample_dir) in &sample_dirs {
        println!("\n------------------------------------------------------------");
        println!(">>> Testing {}", label);
        println!("Path: {}", sample_dir.display());

        if !sample_dir.exists() {
            println!("SKIPPED: Directory does not exist");
            continue;
        }

        // 1. Scan and Classify
        let mut scanned_files = match pipeline.scan_inputs(std::slice::from_ref(sample_dir)) {
            Ok(f) => f,
            Err(e) => {
                println!("FAIL at scan_inputs: {}", e);
                continue;
            }
        };
        if let Err(e) = pipeline.classify_candidates(&mut scanned_files) {
            println!("FAIL at classify_candidates: {}", e);
            continue;
        }

        println!("Scanned {} candidate files:", scanned_files.len());
        for f in &scanned_files {
            println!(
                "  [{:?}] {} ({} bytes, sha256={})",
                f.classification,
                f.file_name,
                f.size_bytes,
                &f.sha256[..12]
            );
        }

        // 2. Identity parsing & Texture matching
        let (pairs, _source_hashes) = match pipeline.match_pairs(&scanned_files) {
            Ok(res) => res,
            Err(e) => {
                println!("FAIL at match_pairs: {}", e);
                continue;
            }
        };

        println!("Matched pairs: {}", pairs.len());
        for pair in &pairs {
            println!("  Model ID: {}", pair.id);
            println!("  Source: {}", pair.model_source.display());
            println!(
                "  Identity: char='{}', outfit='{}', style={:?}, conf={:?}",
                pair.identity.character_id,
                pair.identity.outfit_id,
                pair.identity.style_tag,
                pair.match_confidence
            );
            println!("  Matched Textures ({}):", pair.textures.len());
            for t in &pair.textures {
                println!("    -> {}", t.display());
            }
            println!("  Evidence:");
            for ev in &pair.evidence {
                println!("    - {}", ev);
            }
        }

        if pairs.is_empty() {
            println!("FAIL: No model pairs matched!");
            continue;
        }

        // 3. Build & Validate
        let batch_report = match pipeline.run_batch(std::slice::from_ref(sample_dir), &output_base)
        {
            Ok(r) => r,
            Err(e) => {
                println!("FAIL at run_batch: {}", e);
                continue;
            }
        };

        println!("\nBatch result:");
        println!(
            "  Total: {}, Passed: {}, PassedWithWarnings: {}, Failed: {}",
            batch_report.total_models,
            batch_report.passed,
            batch_report.passed_with_warnings,
            batch_report.failed
        );
        println!("  Overall Status: {:?}", batch_report.overall_status);

        for report in &batch_report.reports {
            println!("\nModel Report: {}", report.model_id);
            println!("  Status: {:?}", report.status);
            println!("  MOC Version: {:?}", report.moc_version);
            println!("  Runtime Validation: {:?}", report.runtime_validation);
            println!("  Output Directory: {:?}", report.output_directory);
            println!("  Output Files ({}):", report.output_files.len());
            for out in &report.output_files {
                let size = fs::metadata(out).map(|m| m.len()).unwrap_or(0);
                println!("    * {} ({} bytes)", out.display(), size);
            }

            println!("  Validation Stages ({}):", report.validation_stages.len());
            for s in &report.validation_stages {
                println!(
                    "    [{}] {}: {}",
                    if s.passed { "PASS" } else { "FAIL" },
                    s.stage_name,
                    s.message
                );
            }

            if !report.warnings.is_empty() {
                println!("  Warnings ({}):", report.warnings.len());
                for w in &report.warnings {
                    println!("    ! {}", w);
                }
            }

            if !report.errors.is_empty() {
                println!("  Errors ({}):", report.errors.len());
                for err in &report.errors {
                    println!("    X {}", err);
                }
            }

            // Reproducibility check: run byte extraction twice
            let json_path = &report.input_files[0];
            let run1_bytes = extract_bytes(json_path).unwrap();
            let run2_bytes = extract_bytes(json_path).unwrap();
            assert_eq!(run1_bytes, run2_bytes, "Extraction must be deterministic");
            println!(
                "  Byte-for-byte extraction deterministic: SHA256 run1 == run2 ({} bytes)",
                run1_bytes.len()
            );
        }
    }
}
