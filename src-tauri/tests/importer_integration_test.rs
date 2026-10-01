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

// ---------------------------------------------------------------------------
// Section 9: HTTP Failure Regression Test Suite (Deterministic Local Server)
// ---------------------------------------------------------------------------

use holodori_core::domain::error::ErrorCode;
use holodori_core::importer::AssetAcquisition;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn spawn_mock_server<F>(handler: F) -> (String, tokio::task::JoinHandle<()>)
where
    F: Fn(String) -> (u16, Vec<(String, String)>, Vec<u8>) + Send + Sync + 'static,
{
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let handler = Arc::new(handler);
    let (ready_tx, ready_rx) = tokio::sync::oneshot::channel();

    let handle = tokio::spawn(async move {
        let _ = ready_tx.send(());
        while let Ok((mut socket, _)) = listener.accept().await {
            let handler = handler.clone();
            tokio::spawn(async move {
                let mut buf = [0u8; 4096];
                if let Ok(n) = socket.read(&mut buf).await {
                    if n == 0 {
                        return;
                    }
                    let req = String::from_utf8_lossy(&buf[..n]).to_string();
                    let (status, headers, body) = handler(req);
                    let reason = match status {
                        200 => "OK",
                        404 => "Not Found",
                        500 => "Internal Server Error",
                        _ => "Response",
                    };
                    let mut resp = format!("HTTP/1.1 {status} {reason}\r\nConnection: close\r\n");
                    for (k, v) in headers {
                        resp.push_str(&format!("{k}: {v}\r\n"));
                    }
                    resp.push_str("\r\n");
                    let _ = socket.write_all(resp.as_bytes()).await;
                    let _ = socket.write_all(&body).await;
                    let _ = socket.flush().await;
                    let _ = socket.shutdown().await;
                    let mut drain = [0u8; 128];
                    let _ = tokio::time::timeout(std::time::Duration::from_secs(1), async {
                        while let Ok(n) = socket.read(&mut drain).await {
                            if n == 0 {
                                break;
                            }
                        }
                    })
                    .await;
                }
            });
        }
    });

    let _ = ready_rx.await;
    (format!("http://127.0.0.1:{port}"), handle)
}

fn compute_md5(data: &[u8]) -> String {
    use md5::Digest;
    let mut hasher = md5::Md5::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

#[tokio::test]
async fn test_http_acquisition_200_success() {
    let payload = b"unity_bundle_content_12345".to_vec();
    let md5_hash = compute_md5(&payload);
    let size = payload.len() as u64;

    let (base_url, _handle) = spawn_mock_server(move |_req| {
        (
            200,
            vec![("Content-Length".into(), size.to_string())],
            payload.clone(),
        )
    })
    .await;

    let dir = tempdir().unwrap();
    let cache = ImporterCacheManager::with_root(dir.path().join("cache"));
    let acq = AssetAcquisition::with_cdn_template(format!("{base_url}/{{objectName}}"));
    let cancel = Arc::new(AtomicBool::new(false));

    let res = acq
        .acquire_bundle("obj_200", &md5_hash, Some(size), &cache, cancel, |_, _| {})
        .await
        .unwrap();

    assert!(res.is_file());
    assert_eq!(fs::read(&res).unwrap(), b"unity_bundle_content_12345");
    assert!(!res.with_extension("part").exists());
}

#[tokio::test]
async fn test_http_acquisition_404_not_found() {
    let (base_url, _handle) =
        spawn_mock_server(|_req| (404, vec![("Content-Length".into(), "0".into())], Vec::new()))
            .await;

    let dir = tempdir().unwrap();
    let cache = ImporterCacheManager::with_root(dir.path().join("cache"));
    let acq = AssetAcquisition::with_cdn_template(format!("{base_url}/{{objectName}}"));
    let cancel = Arc::new(AtomicBool::new(false));

    let err = acq
        .acquire_bundle("obj_404", "dummy_md5", Some(100), &cache, cancel, |_, _| {})
        .await
        .unwrap_err();

    assert_eq!(err.code(), ErrorCode::ErrIo);
    assert!(!cache.get_bundle_path("obj_404").exists());
    assert!(!cache
        .get_bundle_path("obj_404")
        .with_extension("part")
        .exists());
}

#[tokio::test]
async fn test_http_acquisition_timeout() {
    // Listener that accepts connection and never responds
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((_sock, _)) = listener.accept().await {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
    });

    let dir = tempdir().unwrap();
    let cache = ImporterCacheManager::with_root(dir.path().join("cache"));
    let short_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(40))
        .build()
        .unwrap();

    let acq =
        AssetAcquisition::with_cdn_template(format!("http://127.0.0.1:{port}/{{objectName}}"))
            .with_client(short_client);
    let cancel = Arc::new(AtomicBool::new(false));

    let err = acq
        .acquire_bundle(
            "obj_timeout",
            "dummy_md5",
            Some(100),
            &cache,
            cancel,
            |_, _| {},
        )
        .await
        .unwrap_err();

    assert_eq!(err.code(), ErrorCode::ErrIo);
    assert!(!cache.get_bundle_path("obj_timeout").exists());
}

#[tokio::test]
async fn test_http_acquisition_connection_failure() {
    let dir = tempdir().unwrap();
    let cache = ImporterCacheManager::with_root(dir.path().join("cache"));
    // Port 1 is reserved and closed
    let acq = AssetAcquisition::with_cdn_template("http://127.0.0.1:1/{objectName}");
    let cancel = Arc::new(AtomicBool::new(false));

    let err = acq
        .acquire_bundle(
            "obj_conn_fail",
            "dummy_md5",
            Some(100),
            &cache,
            cancel,
            |_, _| {},
        )
        .await
        .unwrap_err();

    assert_eq!(err.code(), ErrorCode::ErrIo);
}

#[tokio::test]
async fn test_http_acquisition_wrong_content_length() {
    let (base_url, _handle) = spawn_mock_server(|_req| {
        (
            200,
            vec![("Content-Length".into(), "999".into())],
            b"short".to_vec(),
        )
    })
    .await;

    let dir = tempdir().unwrap();
    let cache = ImporterCacheManager::with_root(dir.path().join("cache"));
    let acq = AssetAcquisition::with_cdn_template(format!("{base_url}/{{objectName}}"));
    let cancel = Arc::new(AtomicBool::new(false));

    let err = acq
        .acquire_bundle(
            "obj_cl_mismatch",
            "dummy",
            Some(5),
            &cache,
            cancel,
            |_, _| {},
        )
        .await
        .unwrap_err();

    assert_eq!(
        err.code(),
        ErrorCode::ErrCorruptedData,
        "got err: {:?}",
        err
    );
    assert!(!cache.get_bundle_path("obj_cl_mismatch").exists());
}

#[tokio::test]
async fn test_http_acquisition_truncated_body() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        if let Ok((mut socket, _)) = listener.accept().await {
            let mut buf = [0u8; 1024];
            let _ = socket.read(&mut buf).await;
            let resp = "HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n1234567890";
            let _ = socket.write_all(resp.as_bytes()).await;
            let _ = socket.flush().await;
            drop(socket);
        }
    });

    let dir = tempdir().unwrap();
    let cache = ImporterCacheManager::with_root(dir.path().join("cache"));
    let acq =
        AssetAcquisition::with_cdn_template(format!("http://127.0.0.1:{port}/{{objectName}}"));
    let cancel = Arc::new(AtomicBool::new(false));

    let err = acq
        .acquire_bundle(
            "obj_truncated",
            "dummy",
            Some(100),
            &cache,
            cancel,
            |_, _| {},
        )
        .await
        .unwrap_err();

    assert!(err.code() == ErrorCode::ErrIo || err.code() == ErrorCode::ErrCorruptedData);
    assert!(!cache.get_bundle_path("obj_truncated").exists());
    assert!(!cache
        .get_bundle_path("obj_truncated")
        .with_extension("part")
        .exists());
}

#[tokio::test]
async fn test_http_acquisition_wrong_size_mismatch() {
    let (base_url, _handle) = spawn_mock_server(|_req| {
        (
            200,
            vec![], // No Content-Length header
            b"actual_length_is_22_b".to_vec(),
        )
    })
    .await;

    let dir = tempdir().unwrap();
    let cache = ImporterCacheManager::with_root(dir.path().join("cache"));
    let acq = AssetAcquisition::with_cdn_template(format!("{base_url}/{{objectName}}"));
    let cancel = Arc::new(AtomicBool::new(false));

    let err = acq
        .acquire_bundle(
            "obj_size_mismatch",
            "dummy",
            Some(50),
            &cache,
            cancel,
            |_, _| {},
        )
        .await
        .unwrap_err();

    assert!(
        err.code() == ErrorCode::ErrCorruptedData || err.code() == ErrorCode::ErrIo,
        "got err: {:?}",
        err
    );
    assert!(!cache.get_bundle_path("obj_size_mismatch").exists());
    assert!(!cache
        .get_bundle_path("obj_size_mismatch")
        .with_extension("part")
        .exists());
}

#[tokio::test]
async fn test_http_acquisition_wrong_md5() {
    let payload = b"hello_world".to_vec();
    let (base_url, _handle) = spawn_mock_server(move |_req| {
        (
            200,
            vec![("Content-Length".into(), "11".into())],
            payload.clone(),
        )
    })
    .await;

    let dir = tempdir().unwrap();
    let cache = ImporterCacheManager::with_root(dir.path().join("cache"));
    let acq = AssetAcquisition::with_cdn_template(format!("{base_url}/{{objectName}}"));
    let cancel = Arc::new(AtomicBool::new(false));

    let err = acq
        .acquire_bundle(
            "obj_md5_mismatch",
            "00000000000000000000000000000000",
            Some(11),
            &cache,
            cancel,
            |_, _| {},
        )
        .await
        .unwrap_err();

    assert_eq!(
        err.code(),
        ErrorCode::ErrCorruptedData,
        "got err: {:?}",
        err
    );
    assert!(!cache.get_bundle_path("obj_md5_mismatch").exists());
    assert!(!cache
        .get_bundle_path("obj_md5_mismatch")
        .with_extension("part")
        .exists());
}

#[tokio::test]
async fn test_http_acquisition_cancellation() {
    let (base_url, _handle) = spawn_mock_server(|_req| {
        (
            200,
            vec![("Content-Length".into(), "1000".into())],
            vec![1u8; 1000],
        )
    })
    .await;

    let dir = tempdir().unwrap();
    let cache = ImporterCacheManager::with_root(dir.path().join("cache"));
    let acq = AssetAcquisition::with_cdn_template(format!("{base_url}/{{objectName}}"));
    let cancel = Arc::new(AtomicBool::new(true)); // Pre-cancelled

    let err = acq
        .acquire_bundle("obj_cancel", "dummy", Some(1000), &cache, cancel, |_, _| {})
        .await
        .unwrap_err();

    assert_eq!(err.code(), ErrorCode::ErrCancelled);
    assert!(!cache.get_bundle_path("obj_cancel").exists());
    assert!(!cache
        .get_bundle_path("obj_cancel")
        .with_extension("part")
        .exists());
}

#[tokio::test]
async fn test_http_acquisition_cache_hit_and_miss_and_invalidation() {
    let payload = b"cached_bundle_data".to_vec();
    let md5_hash = compute_md5(&payload);
    let size = payload.len() as u64;

    let request_count = Arc::new(AtomicUsize::new(0));
    let count_clone = request_count.clone();

    let (base_url, _handle) = spawn_mock_server(move |_req| {
        count_clone.fetch_add(1, Ordering::SeqCst);
        (
            200,
            vec![("Content-Length".into(), size.to_string())],
            payload.clone(),
        )
    })
    .await;

    let dir = tempdir().unwrap();
    let cache = ImporterCacheManager::with_root(dir.path().join("cache"));
    let acq = AssetAcquisition::with_cdn_template(format!("{base_url}/{{objectName}}"))
        .with_client(
            reqwest::Client::builder()
                .pool_max_idle_per_host(0)
                .build()
                .unwrap(),
        );
    let cancel = Arc::new(AtomicBool::new(false));

    // 1. Cache Miss -> triggers download from server
    let p1 = acq
        .acquire_bundle(
            "obj_cache",
            &md5_hash,
            Some(size),
            &cache,
            cancel.clone(),
            |_, _| {},
        )
        .await
        .unwrap();
    assert_eq!(request_count.load(Ordering::SeqCst), 1);
    assert!(p1.is_file());

    // 2. Cache Hit -> server NOT called
    let p2 = acq
        .acquire_bundle(
            "obj_cache",
            &md5_hash,
            Some(size),
            &cache,
            cancel.clone(),
            |_, _| {},
        )
        .await
        .unwrap();
    assert_eq!(request_count.load(Ordering::SeqCst), 1); // Still 1!
    assert_eq!(p1, p2);

    // 3. Cache Invalidation -> corrupt cache file with garbage
    fs::write(&p1, b"corrupted_garbage").unwrap();
    assert!(!cache.is_bundle_cached("obj_cache", &md5_hash));

    // Next acquire detects corruption, re-fetches from server, updates cache
    let p3 = acq
        .acquire_bundle(
            "obj_cache",
            &md5_hash,
            Some(size),
            &cache,
            cancel,
            |_, _| {},
        )
        .await
        .unwrap();
    assert_eq!(request_count.load(Ordering::SeqCst), 2); // Increased to 2!
    assert_eq!(fs::read(&p3).unwrap(), b"cached_bundle_data");
}
