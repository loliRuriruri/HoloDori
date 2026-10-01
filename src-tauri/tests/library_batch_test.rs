use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;
use tempfile::tempdir;

use holodori_core::domain::library::batch::BatchBuildManager;
use holodori_core::domain::types::BuildStatus;
use holodori_core::domain::{ConversionPipeline, PipelineConfig};

pub const SYNTHETIC_PNG_BYTES: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG Signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR header
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 width, height
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, // 8-bit RGBA
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, // IEND chunk
    0x42, 0x60, 0x82,
];

pub fn create_synthetic_moc3_bytes(version: u8) -> Vec<u8> {
    let mut bytes = vec![0u8; 128];
    bytes[0] = b'M';
    bytes[1] = b'O';
    bytes[2] = b'C';
    bytes[3] = b'3';
    bytes[4] = version;
    for (i, b) in bytes.iter_mut().enumerate().skip(5) {
        *b = (i % 256) as u8;
    }
    bytes
}

pub fn create_synthetic_model_json(bytes: &[u8]) -> String {
    let byte_arr: Vec<u64> = bytes.iter().map(|&b| b as u64).collect();
    serde_json::to_string(&serde_json::json!({
        "m_Name": "synthetic_model",
        "_bytes": byte_arr
    }))
    .unwrap()
}

pub fn write_model_and_texture(
    dir: &Path,
    char_id: &str,
    outfit_id: &str,
    style: Option<&str>,
) -> (PathBuf, PathBuf) {
    let moc_bytes = create_synthetic_moc3_bytes(5);
    let json_content = create_synthetic_model_json(&moc_bytes);

    let base_name = if let Some(st) = style {
        format!("{}_{}_{}", char_id, outfit_id, st)
    } else {
        format!("{}_{}", char_id, outfit_id)
    };

    let json_path = dir.join(format!("model_{}.json", base_name));
    let png_path = dir.join(format!("texture_{}.png", base_name));

    fs::write(&json_path, json_content).unwrap();
    fs::write(&png_path, SYNTHETIC_PNG_BYTES).unwrap();

    (json_path, png_path)
}

// 1. Character grouping: assets grouped under their respective character IDs
#[test]
fn test_character_grouping() {
    let dir = tempdir().unwrap();
    write_model_and_texture(dir.path(), "00007", "001", Some("nrml"));
    write_model_and_texture(dir.path(), "00007", "002", Some("uniq"));
    write_model_and_texture(dir.path(), "00010", "001", Some("nrml"));
    write_model_and_texture(dir.path(), "00010", "004", Some("uniq"));

    let pipeline = ConversionPipeline::new(PipelineConfig::default());
    let library = pipeline
        .scan_library(&[dir.path().to_path_buf()], None, false)
        .unwrap();

    assert_eq!(library.characters.len(), 2);
    assert_eq!(library.characters[0].character_id, "00007");
    assert_eq!(library.characters[0].outfits.len(), 2);
    assert_eq!(library.characters[1].character_id, "00010");
    assert_eq!(library.characters[1].outfits.len(), 2);
    assert_eq!(library.total_models, 4);
    assert_eq!(library.buildable_models, 4);
}

// 2. Outfit ordering: outfits inside character are ordered ascending
#[test]
fn test_outfit_ordering() {
    let dir = tempdir().unwrap();
    // Intentionally write out of order: 003, then 001, then 002
    write_model_and_texture(dir.path(), "00007", "003", Some("cmmn"));
    write_model_and_texture(dir.path(), "00007", "001", Some("nrml"));
    write_model_and_texture(dir.path(), "00007", "002", Some("uniq"));

    let pipeline = ConversionPipeline::new(PipelineConfig::default());
    let library = pipeline
        .scan_library(&[dir.path().to_path_buf()], None, false)
        .unwrap();

    assert_eq!(library.characters.len(), 1);
    let outfits = &library.characters[0].outfits;
    assert_eq!(outfits.len(), 3);
    assert_eq!(outfits[0].outfit_id, "001");
    assert_eq!(outfits[1].outfit_id, "002");
    assert_eq!(outfits[2].outfit_id, "003");
}

// 3. Unknown outfit: unmapped outfit (e.g. 005) is retained and buildable
#[test]
fn test_unknown_outfit() {
    let dir = tempdir().unwrap();
    write_model_and_texture(dir.path(), "00007", "005", None);

    let pipeline = ConversionPipeline::new(PipelineConfig::default());
    let library = pipeline
        .scan_library(&[dir.path().to_path_buf()], None, false)
        .unwrap();

    assert_eq!(library.characters.len(), 1);
    let char_entry = &library.characters[0];
    assert_eq!(char_entry.character_id, "00007");
    assert_eq!(char_entry.outfits.len(), 1);
    assert_eq!(char_entry.outfits[0].outfit_id, "005");
    assert!(char_entry.outfits[0].is_buildable());
}

// 4. Mixed style tokens: explicit tokens mixed with unmapped outfits
#[test]
fn test_mixed_style_tokens() {
    let dir = tempdir().unwrap();
    write_model_and_texture(dir.path(), "00007", "001", Some("nrml"));
    write_model_and_texture(dir.path(), "00007", "002", Some("uniq"));
    write_model_and_texture(dir.path(), "00007", "003", Some("cmmn"));
    write_model_and_texture(dir.path(), "00007", "009", Some("customtag"));

    let pipeline = ConversionPipeline::new(PipelineConfig::default());
    let library = pipeline
        .scan_library(&[dir.path().to_path_buf()], None, false)
        .unwrap();

    let outfits = &library.characters[0].outfits;
    assert_eq!(outfits[0].style_token.as_deref(), Some("nrml"));
    assert_eq!(outfits[1].style_token.as_deref(), Some("uniq"));
    assert_eq!(outfits[2].style_token.as_deref(), Some("cmmn"));
    assert_eq!(outfits[3].style_token.as_deref(), Some("customtag"));
}

// 5. Library scan aggregation: correct counts in report
#[test]
fn test_library_scan_aggregation() {
    let dir = tempdir().unwrap();
    write_model_and_texture(dir.path(), "00007", "001", Some("nrml"));
    write_model_and_texture(dir.path(), "00010", "001", Some("nrml"));

    let pipeline = ConversionPipeline::new(PipelineConfig::default());
    let library = pipeline
        .scan_library(&[dir.path().to_path_buf()], None, false)
        .unwrap();

    assert_eq!(library.scan_report.scanned_files, 4);
    assert_eq!(library.scan_report.model_resources_found, 2);
    assert_eq!(library.scan_report.textures_found, 2);
    assert_eq!(library.scan_report.matched_outfits, 2);
    assert_eq!(library.scan_report.ambiguous_outfits, 0);
    assert_eq!(library.total_models, 2);
    assert_eq!(library.buildable_models, 2);
}

// 6. Duplicate input deduplication: duplicate paths deduplicated
#[test]
fn test_duplicate_input_deduplication() {
    let dir = tempdir().unwrap();
    write_model_and_texture(dir.path(), "00007", "001", Some("nrml"));

    let pipeline = ConversionPipeline::new(PipelineConfig::default());
    // Pass same folder twice
    let library = pipeline
        .scan_library(
            &[dir.path().to_path_buf(), dir.path().to_path_buf()],
            None,
            false,
        )
        .unwrap();

    assert_eq!(library.characters.len(), 1);
    assert_eq!(library.total_models, 1);
}

// 7. Batch partial failure: failure of one model does not abort batch
#[test]
fn test_batch_partial_failure() {
    let dir = tempdir().unwrap();
    let out_dir = tempdir().unwrap();

    // Valid model
    write_model_and_texture(dir.path(), "00007", "001", Some("nrml"));

    // Corrupted model with invalid byte value that fails extraction
    fs::write(
        dir.path().join("model_00010_001_nrml.json"),
        r#"{"m_Name": "bad_model", "_bytes": [-999]}"#,
    )
    .unwrap();
    fs::write(
        dir.path().join("texture_00010_001_nrml.png"),
        SYNTHETIC_PNG_BYTES,
    )
    .unwrap();

    let pipeline = ConversionPipeline::new(PipelineConfig::default());
    let library = pipeline
        .scan_library(&[dir.path().to_path_buf()], None, false)
        .unwrap();

    let all_pairs: Vec<_> = library
        .characters
        .iter()
        .flat_map(|c| c.outfits.iter().map(|o| o.matched_pair.clone()))
        .collect();

    assert_eq!(all_pairs.len(), 2);

    let manager = BatchBuildManager::new(PipelineConfig::default());
    let mut hashes = std::collections::HashMap::new();
    for p in &all_pairs {
        if let Ok(h) = holodori_core::domain::scanner::compute_sha256(&p.model_source) {
            hashes.insert(p.model_source.clone(), h);
        }
        for t in &p.textures {
            if let Ok(h) = holodori_core::domain::scanner::compute_sha256(t) {
                hashes.insert(t.clone(), h);
            }
        }
    }

    let cancel = AtomicBool::new(false);
    let report = manager.run_batch(&all_pairs, out_dir.path(), &hashes, &cancel, |_| {});

    assert_eq!(report.total_models, 2);
    assert_eq!(report.passed + report.passed_with_warnings, 1);
    assert_eq!(report.failed, 1);
    assert_eq!(report.overall_status, BuildStatus::PassWithWarnings);
}

// 8. Batch cancellation: cancellation cleanly stops between models
#[test]
fn test_batch_cancellation() {
    let dir = tempdir().unwrap();
    let out_dir = tempdir().unwrap();

    for i in 1..=4 {
        write_model_and_texture(dir.path(), "00007", &format!("{:03}", i), Some("nrml"));
    }

    let pipeline = ConversionPipeline::new(PipelineConfig::default());
    let library = pipeline
        .scan_library(&[dir.path().to_path_buf()], None, false)
        .unwrap();

    let all_pairs: Vec<_> = library
        .characters
        .iter()
        .flat_map(|c| c.outfits.iter().map(|o| o.matched_pair.clone()))
        .collect();

    let manager = BatchBuildManager::new(PipelineConfig::default());
    let mut hashes = std::collections::HashMap::new();
    for p in &all_pairs {
        if let Ok(h) = holodori_core::domain::scanner::compute_sha256(&p.model_source) {
            hashes.insert(p.model_source.clone(), h);
        }
        for t in &p.textures {
            if let Ok(h) = holodori_core::domain::scanner::compute_sha256(t) {
                hashes.insert(t.clone(), h);
            }
        }
    }

    let cancel = AtomicBool::new(false);
    // Cancel immediately after the first model
    let report = manager.run_batch(&all_pairs, out_dir.path(), &hashes, &cancel, |prog| {
        if prog.current_index >= 1 {
            cancel.store(true, Ordering::SeqCst);
        }
    });

    assert_eq!(report.total_models, 4);
    assert_eq!(report.passed + report.passed_with_warnings, 1);
    // Models 2, 3, 4 cancelled
    assert_eq!(report.failed, 3);
}

// 9. 500-model synthetic library performance test
#[test]
fn test_500_model_synthetic_library() {
    let dir = tempdir().unwrap();

    // Create 50 characters, 10 outfits each = 500 models
    for c in 0..50 {
        let char_id = format!("{:05}", c + 1);
        for o in 0..10 {
            let outfit_id = format!("{:03}", o + 1);
            write_model_and_texture(dir.path(), &char_id, &outfit_id, Some("nrml"));
        }
    }

    let start = Instant::now();
    let pipeline = ConversionPipeline::new(PipelineConfig::default());
    let library = pipeline
        .scan_library(&[dir.path().to_path_buf()], None, false)
        .unwrap();
    let elapsed = start.elapsed();

    assert_eq!(library.characters.len(), 50);
    assert_eq!(library.total_models, 500);
    assert_eq!(library.buildable_models, 500);

    // Verify ordering is strictly ascending
    for i in 0..49 {
        assert!(library.characters[i].character_id < library.characters[i + 1].character_id);
    }
    for char_entry in &library.characters {
        assert_eq!(char_entry.outfits.len(), 10);
        for o in 0..9 {
            assert!(char_entry.outfits[o].outfit_id < char_entry.outfits[o + 1].outfit_id);
        }
    }

    println!(
        "500 synthetic models scanned and organized in {:?}",
        elapsed
    );
    assert!(
        elapsed.as_secs() < 10,
        "500-model scan took too long: {:?}",
        elapsed
    );
}

// 10. Cache hit: second scan reuses cached classification
#[test]
fn test_cache_hit() {
    let dir = tempdir().unwrap();
    let cache_dir = tempdir().unwrap();
    let cache_file = cache_dir.path().join("test_cache.json");

    write_model_and_texture(dir.path(), "00007", "001", Some("nrml"));
    write_model_and_texture(dir.path(), "00010", "001", Some("nrml"));

    let pipeline = ConversionPipeline::new(PipelineConfig::default());

    // First scan: cache miss
    let lib1 = pipeline
        .scan_library(&[dir.path().to_path_buf()], Some(&cache_file), false)
        .unwrap();
    assert_eq!(lib1.scan_report.cache_miss_count, 4); // 2 models + 2 textures
    assert_eq!(lib1.scan_report.cache_hit_count, 0);
    assert!(cache_file.exists());

    // Second scan: cache hit
    let lib2 = pipeline
        .scan_library(&[dir.path().to_path_buf()], Some(&cache_file), false)
        .unwrap();
    assert_eq!(lib2.scan_report.cache_hit_count, 4);
    assert_eq!(lib2.scan_report.cache_miss_count, 0);
    assert_eq!(lib2.total_models, 2);
}

// 11. Cache invalidation: modifying file triggers cache miss
#[test]
fn test_cache_invalidation() {
    let dir = tempdir().unwrap();
    let cache_dir = tempdir().unwrap();
    let cache_file = cache_dir.path().join("test_cache.json");

    let (json_path, _) = write_model_and_texture(dir.path(), "00007", "001", Some("nrml"));

    let pipeline = ConversionPipeline::new(PipelineConfig::default());
    let _ = pipeline
        .scan_library(&[dir.path().to_path_buf()], Some(&cache_file), false)
        .unwrap();

    // Modify file contents to change size and mtime
    let mut content = fs::read_to_string(&json_path).unwrap();
    content.push(' ');
    fs::write(&json_path, content).unwrap();

    let lib2 = pipeline
        .scan_library(&[dir.path().to_path_buf()], Some(&cache_file), false)
        .unwrap();
    assert!(lib2.scan_report.cache_miss_count >= 1);
}

// 12. Source file removed after scan: file purged on rescan
#[test]
fn test_source_file_removed_after_scan() {
    let dir = tempdir().unwrap();
    let (json1, png1) = write_model_and_texture(dir.path(), "00007", "001", Some("nrml"));
    write_model_and_texture(dir.path(), "00007", "002", Some("uniq"));

    let pipeline = ConversionPipeline::new(PipelineConfig::default());
    let lib1 = pipeline
        .scan_library(&[dir.path().to_path_buf()], None, false)
        .unwrap();
    assert_eq!(lib1.total_models, 2);

    // Remove first model
    fs::remove_file(json1).unwrap();
    fs::remove_file(png1).unwrap();

    let lib2 = pipeline
        .scan_library(&[dir.path().to_path_buf()], None, true)
        .unwrap();
    assert_eq!(lib2.total_models, 1);
    assert_eq!(lib2.characters[0].outfits[0].outfit_id, "002");
}

// 13. New file discovered on rescan
#[test]
fn test_new_file_discovered_on_rescan() {
    let dir = tempdir().unwrap();
    write_model_and_texture(dir.path(), "00007", "001", Some("nrml"));

    let pipeline = ConversionPipeline::new(PipelineConfig::default());
    let lib1 = pipeline
        .scan_library(&[dir.path().to_path_buf()], None, false)
        .unwrap();
    assert_eq!(lib1.total_models, 1);

    // Add new model
    write_model_and_texture(dir.path(), "00099", "001", Some("nrml"));

    let lib2 = pipeline
        .scan_library(&[dir.path().to_path_buf()], None, true)
        .unwrap();
    assert_eq!(lib2.total_models, 2);
    assert_eq!(lib2.characters[1].character_id, "00099");
}

// 14. Unicode source path: non-ASCII path works seamlessly
#[test]
fn test_unicode_source_path() {
    let root = tempdir().unwrap();
    let unicode_dir = root.path().join("홀로라이브_샘플_001").join("모델_자원");
    fs::create_dir_all(&unicode_dir).unwrap();

    write_model_and_texture(&unicode_dir, "00007", "001", Some("nrml"));

    let pipeline = ConversionPipeline::new(PipelineConfig::default());
    let library = pipeline.scan_library(&[unicode_dir], None, false).unwrap();

    assert_eq!(library.characters.len(), 1);
    assert_eq!(library.characters[0].character_id, "00007");
    assert_eq!(library.total_models, 1);
}

// 15. Spaces in source path: path with spaces handled cleanly
#[test]
fn test_spaces_in_source_path() {
    let root = tempdir().unwrap();
    let spaced_dir = root
        .path()
        .join("My HoloDori Models")
        .join("Char 00007 Space");
    fs::create_dir_all(&spaced_dir).unwrap();

    write_model_and_texture(&spaced_dir, "00007", "001", Some("nrml"));

    let pipeline = ConversionPipeline::new(PipelineConfig::default());
    let library = pipeline.scan_library(&[spaced_dir], None, false).unwrap();

    assert_eq!(library.characters.len(), 1);
    assert_eq!(library.characters[0].character_id, "00007");
    assert_eq!(library.total_models, 1);
}
