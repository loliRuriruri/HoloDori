use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::tempdir;

use holodori_core::domain::octo::{build_synthetic_octocache, OctoItem};
use holodori_core::importer::{
    ImporterCacheManager, ImporterCoordinator, SteamDetectionSource, SteamDetector, UnityExtractor,
};

#[test]
fn test_steam_detection_synthetic_unicode_and_spaces() {
    let dir = tempdir().unwrap();
    let unicode_lib = dir.path().join("라이브러리 폴더 avec espaces");
    let game_dir = unicode_lib
        .join("steamapps")
        .join("common")
        .join("hololive Dreams");
    let data_dir = game_dir.join("hololive Dreams_Data");
    fs::create_dir_all(&data_dir).unwrap();
    let octo_file = data_dir.join("octocacheevai");
    fs::write(&octo_file, b"synthetic_octo").unwrap();

    let res = SteamDetector::validate_path(&game_dir);
    assert!(res.found);
    assert_eq!(res.source, Some(SteamDetectionSource::ManualFallback));
    assert_eq!(PathBuf::from(res.octocache_path.unwrap()), octo_file);
}

#[test]
fn test_steam_libraryfolders_vdf_parsing() {
    let dir = tempdir().unwrap();
    let lib1 = dir.path().join("SteamRoot");
    let lib2 = dir.path().join("ExtraLibrary");
    fs::create_dir_all(&lib1).unwrap();
    fs::create_dir_all(&lib2).unwrap();

    let vdf_content = format!(
        r#"
        "libraryfolders"
        {{
            "0"
            {{
                "path" "{}"
                "label" ""
            }}
            "1"
            {{
                "path" "{}"
                "label" "Secondary"
            }}
        }}
        "#,
        lib1.to_string_lossy().replace('\\', r"\\"),
        lib2.to_string_lossy().replace('\\', r"\\")
    );

    let parsed = SteamDetector::parse_library_folders_vdf(&vdf_content);
    assert_eq!(parsed.len(), 2);
    assert!(parsed.contains(&lib1));
    assert!(parsed.contains(&lib2));
}

#[test]
fn test_importer_catalog_from_synthetic_octocache() {
    let dir = tempdir().unwrap();
    let cache = ImporterCacheManager::with_root(dir.path().join("cache"));
    cache.ensure_dirs().unwrap();

    let items = vec![
        OctoItem {
            id: 101,
            name: "live2d_mdl_00007-nrml-0008-00".to_string(),
            object_name: "DCgZ7m".to_string(),
            size: 3265045,
            crc: 1234,
            md5: "a163f3d6bfb59ba534ab1afbd3896120".to_string(),
            dependencies: vec![],
            addresses: vec![],
        },
        OctoItem {
            id: 102,
            name: "live2d_mdl_00010-uniq-0069-00".to_string(),
            object_name: "Cfywj9".to_string(),
            size: 4084627,
            crc: 5678,
            md5: "5cae6384d2502c8968d5461455ba91e1".to_string(),
            dependencies: vec![],
            addresses: vec![],
        },
    ];

    let payload = build_synthetic_octocache(20, "https://asset.example.com/{objectName}", &items);
    let octo_path = dir.path().join("octocacheevai");
    fs::write(&octo_path, &payload).unwrap();

    let coordinator = ImporterCoordinator::with_cache_root(dir.path().join("cache"));
    let catalog = coordinator.load_catalog(&octo_path).unwrap();

    assert_eq!(catalog.len(), 2);
    assert_eq!(catalog[0].character_id, "00007");
    assert_eq!(catalog[0].object_name, "DCgZ7m");
    assert_eq!(catalog[1].character_id, "00010");
    assert_eq!(catalog[1].object_name, "Cfywj9");
}

#[test]
fn test_importer_cache_management() {
    let dir = tempdir().unwrap();
    let coordinator = ImporterCoordinator::with_cache_root(dir.path().join("test_cache"));
    let stats_empty = coordinator.cache_stats();
    assert_eq!(stats_empty.cached_bundles_count, 0);
    assert_eq!(stats_empty.total_bytes, 0);

    // Place a simulated bundle in cache
    coordinator.cache_manager().ensure_dirs().unwrap();
    let bundle_file = coordinator.cache_manager().get_bundle_path("mock_obj");
    fs::write(&bundle_file, b"12345678").unwrap();

    let stats_one = coordinator.cache_stats();
    assert_eq!(stats_one.cached_bundles_count, 1);
    assert_eq!(stats_one.total_bytes, 8);

    let cleared = coordinator.clear_cache().unwrap();
    assert_eq!(cleared, 8);
    assert_eq!(coordinator.cache_stats().cached_bundles_count, 0);
}

#[test]
fn test_real_bundle_extraction_if_cached() {
    // If spike cached bundles are present on the local test machine, verify extraction end-to-end
    let spike_dir = Path::new("../target/spike_cache");
    let test_cases = [
        (
            "live2d_mdl_00007-nrml-0008-00",
            spike_dir.join("DCgZ7m"),
            "7eab9201087f3ffb6bc05bbbfa2eb63d84e265c6980820353d872c89faa4ac3b",
        ),
        (
            "live2d_mdl_00010-nrml-0010-00",
            spike_dir.join("LTdJTw"),
            "88cf2df92675ee341b9c5e4520c8b17d869b05cf5f6572f09c6428beb471879c",
        ),
        (
            "live2d_mdl_00010-uniq-0069-00",
            spike_dir.join("Cfywj9"),
            "7e950781c77d52bb73ddc18cdee46a47e5ee04ebcd91311e7bb1aa666040a2b1",
        ),
    ];

    for (asset_name, path, expected_hash) in test_cases {
        if path.exists() {
            let extracted = UnityExtractor::extract_bundle(&path, asset_name).unwrap();
            let mut hasher = Sha256::new();
            hasher.update(&extracted.moc3_bytes);
            let actual_hash = format!("{:x}", hasher.finalize());
            assert_eq!(actual_hash, expected_hash);
            assert!(!extracted.textures.is_empty());
            assert_eq!(extracted.textures[0].width, 4096);
            assert_eq!(extracted.textures[0].height, 4096);
        }
    }
}

#[tokio::test]
async fn test_importer_coordinator_end_to_end_if_cached() {
    let spike_dir = Path::new("../target/spike_cache");
    let bundle_00007 = spike_dir.join("DCgZ7m");
    if !bundle_00007.exists() {
        return;
    }

    let temp_root = tempdir().unwrap();
    let cache_dir = temp_root.path().join("cache");
    let out_dir = temp_root.path().join("output");
    fs::create_dir_all(&out_dir).unwrap();

    let coordinator = ImporterCoordinator::with_cache_root(&cache_dir);
    coordinator.cache_manager().ensure_dirs().unwrap();

    let target_bundle = coordinator.cache_manager().get_bundle_path("DCgZ7m");
    fs::copy(&bundle_00007, &target_bundle).unwrap();

    let entry = holodori_core::importer::ModelCatalogEntry {
        asset_name: "live2d_mdl_00007-nrml-0008-00".to_string(),
        object_name: "DCgZ7m".to_string(),
        character_id: "00007".to_string(),
        style: "nrml".to_string(),
        outfit_token: "001".to_string(),
        size_bytes: fs::metadata(&target_bundle).unwrap().len(),
        md5: "a163f3d6bfb59ba534ab1afbd3896120".to_string(),
        is_cached: true,
    };

    let result = coordinator
        .import_models(
            &[entry],
            &out_dir,
            holodori_core::domain::types::ConflictPolicy::Overwrite,
            |_prog| {},
        )
        .await
        .unwrap();

    assert_eq!(result.succeeded.len(), 1);
    assert_eq!(result.failed.len(), 0);
    assert!(!result.cancelled);

    let summary = &result.succeeded[0];
    assert_eq!(summary.character_id, "00007");
    assert_eq!(summary.outfit_id, "001");
    let manifest_path = PathBuf::from(&summary.manifest_file);
    assert!(manifest_path.is_file());

    let moc_path = PathBuf::from(&summary.moc3_file);
    assert!(moc_path.is_file());
    assert_eq!(fs::metadata(&moc_path).unwrap().len(), 1_553_408);

    assert_eq!(summary.textures.len(), 1);
    let tex_path = PathBuf::from(&summary.textures[0]);
    assert!(tex_path.is_file());
}
