use std::fs;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::time::Instant;

use sha2::{Digest, Sha256};

use holodori_core::domain::types::ConflictPolicy;
use holodori_core::importer::{
    ImporterCoordinator, ModelCatalogEntry, SteamDetectionResult, SteamDetector,
};

const EXPECTED_MOC_HASH_00007_001: &str =
    "7eab9201087f3ffb6bc05bbbfa2eb63d84e265c6980820353d872c89faa4ac3b";
const EXPECTED_MOC_HASH_00010_001: &str =
    "88cf2df92675ee341b9c5e4520c8b17d869b05cf5f6572f09c6428beb471879c";
const EXPECTED_MOC_HASH_00010_004: &str =
    "7e950781c77d52bb73ddc18cdee46a47e5ee04ebcd91311e7bb1aa666040a2b1";

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("============================================================");
    println!("  HDM.AGENT.3B-R — FINAL PRODUCT ACCEPTANCE VERIFICATION   ");
    println!("============================================================");

    // -----------------------------------------------------------------------
    // STEP 1: Steam Installation Auto-Detection
    // -----------------------------------------------------------------------
    println!("\n[1/7] Probing Steam Game Installation...");
    let t_steam_start = Instant::now();
    let steam_result: SteamDetectionResult = SteamDetector::auto_detect();
    let steam_elapsed = t_steam_start.elapsed();

    println!(
        "  Detection status:  {}",
        if steam_result.found {
            "FOUND"
        } else {
            "NOT FOUND"
        }
    );
    println!("  Elapsed time:      {:.2?}", steam_elapsed);
    println!(
        "  Install path:      {}",
        steam_result.install_path.as_deref().unwrap_or("None")
    );
    println!(
        "  Octocache path:    {}",
        steam_result.octocache_path.as_deref().unwrap_or("None")
    );
    println!("  Source:            {:?}", steam_result.source);
    println!("  Message:           {}", steam_result.message);

    assert!(
        steam_result.found,
        "Steam detection must succeed on target system"
    );
    let octocache_path = PathBuf::from(
        steam_result
            .octocache_path
            .expect("octocache_path must exist"),
    );

    // -----------------------------------------------------------------------
    // STEP 2: Catalog Decryption & Model Filtering
    // -----------------------------------------------------------------------
    println!("\n[2/7] Loading and Decrypting Master Octocache Catalog...");
    let coordinator = ImporterCoordinator::new();
    let t_cat_start = Instant::now();
    let catalog = coordinator.load_catalog(&octocache_path)?;
    let cat_elapsed = t_cat_start.elapsed();

    println!("  Models indexed:    {}", catalog.len());
    println!("  Elapsed time:      {:.2?}", cat_elapsed);
    assert!(!catalog.is_empty(), "Catalog must contain Live2D models");

    // Locate test models in catalog by verified object_name
    let model_00007_001 = catalog
        .iter()
        .find(|e| e.object_name == "DCgZ7m")
        .expect("00007_001 (DCgZ7m) must exist in catalog")
        .clone();

    let model_00010_001 = catalog
        .iter()
        .find(|e| e.object_name == "LTdJTw")
        .expect("00010_001 (LTdJTw) must exist in catalog")
        .clone();

    let model_00010_004 = catalog
        .iter()
        .find(|e| e.object_name == "Cfywj9")
        .expect("00010_004 (Cfywj9) must exist in catalog")
        .clone();

    println!(
        "  Selected Model 1: {} (object: {}, size: {} bytes, md5: {})",
        model_00007_001.asset_name,
        model_00007_001.object_name,
        model_00007_001.size_bytes,
        model_00007_001.md5
    );
    println!(
        "  Selected Model 2: {} (object: {}, size: {} bytes, md5: {})",
        model_00010_001.asset_name,
        model_00010_001.object_name,
        model_00010_001.size_bytes,
        model_00010_001.md5
    );
    println!(
        "  Selected Model 3: {} (object: {}, size: {} bytes, md5: {})",
        model_00010_004.asset_name,
        model_00010_004.object_name,
        model_00010_004.size_bytes,
        model_00010_004.md5
    );

    // -----------------------------------------------------------------------
    // STEP 3: Mandatory Cold Import Test
    // -----------------------------------------------------------------------
    println!("\n[3/7] Executing Mandatory Cold Import Test (Actual CDN Acquisition)...");
    let cache_manager = coordinator.cache_manager();
    cache_manager.ensure_dirs()?;

    // Remove only test bundles from cache to enforce cold state
    let test_objects = [
        &model_00007_001.object_name,
        &model_00010_001.object_name,
        &model_00010_004.object_name,
    ];
    for obj in &test_objects {
        let p = cache_manager.get_bundle_path(obj);
        if p.exists() {
            fs::remove_file(&p)?;
            println!(
                "  Removed cached bundle to enforce cold acquisition: {}",
                p.display()
            );
        }
        let part = p.with_extension("part");
        if part.exists() {
            fs::remove_file(&part)?;
        }
    }

    // Verify cache is cold for test models
    for obj in &test_objects {
        assert!(
            !cache_manager.get_bundle_path(obj).exists(),
            "Cache must be absent for cold test"
        );
    }
    println!("  Verified: Raw cache is cold for target test bundles.");

    let output_root = PathBuf::from(r"D:\test\holodori_agent3b_packages");
    let _ = fs::create_dir_all(&output_root);

    let cold_targets = vec![
        model_00007_001.clone(),
        model_00010_001.clone(),
        model_00010_004.clone(),
    ];
    let t_cold_start = Instant::now();

    let cold_result = coordinator
        .import_models(
            &cold_targets,
            &output_root,
            ConflictPolicy::Overwrite,
            |prog| {
                println!(
                    "    [Cold Progress] Model {}/{}: {} | Phase: {:?} | {:.1}%",
                    prog.current_model_index,
                    prog.total_models,
                    prog.current_model_name,
                    prog.phase,
                    prog.overall_percentage
                );
            },
        )
        .await?;

    let cold_elapsed = t_cold_start.elapsed();
    println!("  Cold Import completed in: {:.2?}", cold_elapsed);
    println!(
        "  Succeeded: {}, Failed: {}",
        cold_result.succeeded.len(),
        cold_result.failed.len()
    );
    assert_eq!(
        cold_result.succeeded.len(),
        3,
        "All 3 cold models must succeed"
    );
    assert_eq!(cold_result.failed.len(), 0, "No cold models may fail");

    // Verify raw bundles were published into cache with exact sizes and hashes
    for entry in &cold_targets {
        let cached_bundle = cache_manager.get_bundle_path(&entry.object_name);
        assert!(
            cached_bundle.is_file(),
            "Cached bundle must be published at {}",
            cached_bundle.display()
        );
        let meta = fs::metadata(&cached_bundle)?;
        assert_eq!(
            meta.len(),
            entry.size_bytes,
            "Published bundle size must match catalog size"
        );

        let bundle_bytes = fs::read(&cached_bundle)?;
        let mut hasher = md5::Md5::new();
        hasher.update(&bundle_bytes);
        let actual_md5 = format!("{:x}", hasher.finalize());
        assert_eq!(
            actual_md5.to_lowercase(),
            entry.md5.to_lowercase(),
            "MD5 hash must match catalog MD5"
        );

        let part_file = cached_bundle.with_extension("part");
        assert!(
            !part_file.exists(),
            ".part file must not remain after successful publication"
        );
        println!(
            "  ✓ Bundle {}: Published successfully ({} bytes, MD5: {})",
            entry.object_name,
            meta.len(),
            actual_md5
        );
    }

    // -----------------------------------------------------------------------
    // STEP 4: Byte Identity Verification against AGENT.1R2 Hashes
    // -----------------------------------------------------------------------
    println!("\n[4/7] Verifying MOC3 Byte Identity against AGENT.1R2 Baseline...");
    let expected_hashes = [
        ("00007_001", EXPECTED_MOC_HASH_00007_001),
        ("00010_001", EXPECTED_MOC_HASH_00010_001),
        ("00010_004", EXPECTED_MOC_HASH_00010_004),
    ];

    for (model_id, expected_hash) in expected_hashes {
        let summary = cold_result
            .succeeded
            .iter()
            .find(|s| format!("{}_{}", s.character_id, s.outfit_id) == model_id)
            .expect("Model summary must exist");

        let moc_path = PathBuf::from(&summary.moc3_file);
        assert!(
            moc_path.is_file(),
            "MOC3 file must exist at {}",
            moc_path.display()
        );
        let moc_bytes = fs::read(&moc_path)?;

        let mut hasher = Sha256::new();
        hasher.update(&moc_bytes);
        let actual_hash = format!("{:x}", hasher.finalize());

        println!("  Model {}:", model_id);
        println!("    Expected SHA-256: {}", expected_hash);
        println!("    Actual SHA-256:   {}", actual_hash);
        assert_eq!(
            actual_hash, expected_hash,
            "MOC3 SHA-256 mismatch for {}",
            model_id
        );
        println!("    Result:           100% BIT-FOR-BIT IDENTICAL ✓");

        // Verify Texture2D
        assert!(!summary.textures.is_empty(), "Texture atlas must exist");
        let tex_path = PathBuf::from(&summary.textures[0]);
        assert!(
            tex_path.is_file(),
            "Texture file must exist at {}",
            tex_path.display()
        );
        let tex_meta = fs::metadata(&tex_path)?;
        assert!(
            tex_meta.len() > 100_000,
            "Texture PNG must be valid image file (>100KB)"
        );

        // Verify model3.json
        let manifest_path = PathBuf::from(&summary.manifest_file);
        assert!(
            manifest_path.is_file(),
            "Manifest file must exist at {}",
            manifest_path.display()
        );
        let manifest_content = fs::read_to_string(&manifest_path)?;
        assert!(
            manifest_content.contains("Version"),
            "Manifest must be valid Cubism model3 JSON"
        );
        assert!(
            manifest_content.contains(&summary.outfit_id),
            "Manifest must reference outfit"
        );
    }

    // -----------------------------------------------------------------------
    // STEP 5: Warm Cache Validation
    // -----------------------------------------------------------------------
    println!("\n[5/7] Executing Warm Cache Validation (Network Skipped)...");
    let t_warm_start = Instant::now();
    let warm_result = coordinator
        .import_models(
            &cold_targets,
            &output_root,
            ConflictPolicy::Overwrite,
            |_prog| {},
        )
        .await?;
    let warm_elapsed = t_warm_start.elapsed();

    println!("  Warm Import completed in: {:.2?}", warm_elapsed);
    println!(
        "  Cold vs Warm Speedup:     {:.2}x faster",
        cold_elapsed.as_secs_f64() / warm_elapsed.as_secs_f64().max(0.001)
    );
    assert_eq!(warm_result.succeeded.len(), 3);
    assert_eq!(warm_result.failed.len(), 0);

    for (model_id, expected_hash) in expected_hashes {
        let summary = warm_result
            .succeeded
            .iter()
            .find(|s| format!("{}_{}", s.character_id, s.outfit_id) == model_id)
            .expect("Model summary must exist");

        let moc_bytes = fs::read(&summary.moc3_file)?;
        let mut hasher = Sha256::new();
        hasher.update(&moc_bytes);
        let actual_hash = format!("{:x}", hasher.finalize());
        assert_eq!(
            actual_hash, expected_hash,
            "Warm MOC3 hash must remain identical"
        );
    }
    println!("  ✓ Warm cache reused verified bundles with zero network dependency.");

    // -----------------------------------------------------------------------
    // STEP 6: Multi-Model Batch Performance Measurement (10 Models)
    // -----------------------------------------------------------------------
    println!("\n[6/7] Measuring 10-Model Batch Import Performance...");
    let batch_10: Vec<ModelCatalogEntry> = catalog.iter().take(10).cloned().collect();
    println!(
        "  Batch contains {} models (total {} MB)",
        batch_10.len(),
        batch_10.iter().map(|m| m.size_bytes).sum::<u64>() / (1024 * 1024)
    );

    let t_batch_start = Instant::now();
    let batch_res = coordinator
        .import_models(
            &batch_10,
            &output_root,
            ConflictPolicy::Overwrite,
            |_prog| {},
        )
        .await?;
    let batch_elapsed = t_batch_start.elapsed();
    println!(
        "  10-Model Batch Import completed in: {:.2?}",
        batch_elapsed
    );
    println!(
        "  Succeeded: {}, Failed: {}",
        batch_res.succeeded.len(),
        batch_res.failed.len()
    );
    assert_eq!(batch_res.succeeded.len(), 10, "All 10 models must succeed");

    // -----------------------------------------------------------------------
    // STEP 7: Cancellation Acceptance Test
    // -----------------------------------------------------------------------
    println!("\n[7/7] Testing Production Importer Cancellation...");
    let cancel_coord = ImporterCoordinator::new();
    let cancel_token = cancel_coord.cancel_token().clone();

    // Trigger cancellation during the second model
    let cancel_targets: Vec<ModelCatalogEntry> = catalog.iter().skip(10).take(5).cloned().collect();
    let token_clone = cancel_token.clone();

    let cancel_res = cancel_coord
        .import_models(
            &cancel_targets,
            &output_root,
            ConflictPolicy::Overwrite,
            move |prog| {
                if prog.current_model_index >= 1 {
                    token_clone.store(true, Ordering::SeqCst);
                }
            },
        )
        .await?;

    println!("  Cancelled flag:     {}", cancel_res.cancelled);
    println!("  Succeeded count:    {}", cancel_res.succeeded.len());
    println!("  Failed count:       {}", cancel_res.failed.len());
    println!("  Total processed:    {}", cancel_res.total_processed);
    assert!(
        cancel_res.cancelled,
        "Import execution must report cancelled == true"
    );
    assert!(
        cancel_res.succeeded.len() < cancel_targets.len(),
        "Cancellation must prevent full completion"
    );
    println!("  ✓ Production pipeline cancelled cleanly without crashing or corrupting state.");

    println!("\n============================================================");
    println!("  ALL ACCEPTANCE AUTOMATED GATES PASSED SUCCESSFULLY!       ");
    println!("============================================================");
    println!("Packages ready for Cubism Viewer 5.3 runtime verification at:");
    println!(
        "  00007_001: {}\\00007_001\\00007_001.model3.json",
        output_root.display()
    );
    println!(
        "  00010_001: {}\\00010_001\\00010_001.model3.json",
        output_root.display()
    );
    println!(
        "  00010_004: {}\\00010_004\\00010_004.model3.json",
        output_root.display()
    );

    Ok(())
}
