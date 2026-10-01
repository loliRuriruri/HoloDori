use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use tempfile::tempdir;

use holodori_core::domain::library::batch::BatchBuildManager;
use holodori_core::domain::types::{ConflictPolicy, LibraryFilter, StyleFilter};
use holodori_core::domain::{ConversionPipeline, PipelineConfig};

fn main() {
    println!("============================================================");
    println!("  HDM.AGENT.2 — REAL SAMPLE LIBRARY SMOKE TEST");
    println!("============================================================");

    let real_sample_root = PathBuf::from(r"D:\test\holodori_real_samples");
    if !real_sample_root.exists() {
        println!(
            "SKIPPED: Real sample directory not found at {}",
            real_sample_root.display()
        );
        return;
    }

    let out_dir = tempdir().unwrap();
    let cache_dir = tempdir().unwrap();
    let cache_file = cache_dir.path().join("real_library_cache.json");

    let pipeline = ConversionPipeline::new(PipelineConfig::default());

    // 1. Initial Scan (Cold Cache)
    println!("\n>>> 1. Initial Scan of Real Sample Library...");
    let start = std::time::Instant::now();
    let library = pipeline
        .scan_library(
            std::slice::from_ref(&real_sample_root),
            Some(&cache_file),
            false,
        )
        .expect("Scan failed");
    let elapsed = start.elapsed();

    println!("Scanned in {:?}", elapsed);
    println!("Characters found: {}", library.characters.len());
    println!("Total models: {}", library.total_models);
    println!("Buildable models: {}", library.buildable_models);
    println!("Scanned files: {}", library.scan_report.scanned_files);
    println!(
        "Cache hits: {}, misses: {}",
        library.scan_report.cache_hit_count, library.scan_report.cache_miss_count
    );

    for char_entry in &library.characters {
        println!(
            "\n[Character {}] ({} outfits, {} buildable):",
            char_entry.character_id,
            char_entry.outfits.len(),
            char_entry.buildable_count
        );
        for o in &char_entry.outfits {
            println!(
                "  - Outfit {}: style={:?}, match={:?}, buildable={}, textures={}",
                o.outfit_id,
                o.style_token,
                o.match_status,
                o.is_buildable(),
                o.textures.len()
            );
        }
    }

    // Verify ordering
    for i in 0..library.characters.len().saturating_sub(1) {
        assert!(
            library.characters[i].character_id <= library.characters[i + 1].character_id,
            "Characters not sorted ascending!"
        );
    }
    for char_entry in &library.characters {
        for o in 0..char_entry.outfits.len().saturating_sub(1) {
            assert!(
                char_entry.outfits[o].outfit_id <= char_entry.outfits[o + 1].outfit_id,
                "Outfits not sorted ascending!"
            );
        }
    }
    println!("\n✓ Deterministic sorting verified across real characters and outfits.");

    // 2. Rescan (Warm Cache)
    println!("\n>>> 2. Warm Rescan with Metadata Cache...");
    let start2 = std::time::Instant::now();
    let library2 = pipeline
        .scan_library(
            std::slice::from_ref(&real_sample_root),
            Some(&cache_file),
            false,
        )
        .expect("Warm rescan failed");
    let elapsed2 = start2.elapsed();
    println!("Warm scan completed in {:?}", elapsed2);
    println!(
        "Cache hits: {}, misses: {}",
        library2.scan_report.cache_hit_count, library2.scan_report.cache_miss_count
    );
    assert!(
        library2.scan_report.cache_hit_count > 0,
        "Expected cache hits on warm rescan"
    );
    println!("✓ Cache hit verification successful.");

    // 3. Search and Filtering Verification
    println!("\n>>> 3. Testing Search and Filtering on Real Library...");
    let filtered_00007 = library.filter("00007", LibraryFilter::All, &StyleFilter::All);
    println!(
        "Filter '00007': {} character(s) returned",
        filtered_00007.len()
    );
    assert!(!filtered_00007.is_empty() && filtered_00007[0].character_id == "00007");

    let filtered_nrml = library.filter("", LibraryFilter::All, &StyleFilter::Nrml);
    println!(
        "Filter 'nrml': {} character(s) returned",
        filtered_nrml.len()
    );
    assert!(!filtered_nrml.is_empty());
    println!("✓ Search and style filters verified.");

    // 4. Batch Build Selected Real Models
    println!("\n>>> 4. Executing Batch Build of Selected Real Models...");
    let buildable_pairs: Vec<_> = library
        .characters
        .iter()
        .flat_map(|c| {
            c.outfits
                .iter()
                .filter(|o| o.is_buildable())
                .map(|o| o.matched_pair.clone())
        })
        .collect();

    println!(
        "Total buildable models ready for batch: {}",
        buildable_pairs.len()
    );
    assert!(
        !buildable_pairs.is_empty(),
        "No buildable pairs found in real library!"
    );

    let manager = BatchBuildManager::new(PipelineConfig {
        conflict_policy: ConflictPolicy::Overwrite,
        ..Default::default()
    });

    let mut hashes = std::collections::HashMap::new();
    for p in &buildable_pairs {
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
    let report = manager.run_batch(&buildable_pairs, out_dir.path(), &hashes, &cancel, |prog| {
        println!(
            "  [Progress] {}/{} — {} ({})",
            prog.current_index, prog.total_models, prog.current_model_id, prog.stage
        );
    });

    println!("\n=== BATCH BUILD RESULT ===");
    println!("Total models processed: {}", report.total_models);
    println!("Passed: {}", report.passed);
    println!("Passed with warnings: {}", report.passed_with_warnings);
    println!("Failed: {}", report.failed);
    println!("Overall status: {:?}", report.overall_status);

    for r in &report.reports {
        println!(
            "  Model {}: status={:?}, moc_ver={}, runtime={:?}",
            r.model_id,
            r.status,
            r.moc_version.display_label(),
            r.runtime_validation
        );
        if let Some(dir) = &r.output_directory {
            println!("    Output dir: {}", dir.display());
            assert!(dir.exists(), "Output directory must exist!");
        }
    }

    assert!(
        report.passed + report.passed_with_warnings > 0,
        "At least one real model must pass!"
    );
    println!("\n✓ REAL SAMPLE SMOKE TEST PASSED COMPLETELY!");
}
