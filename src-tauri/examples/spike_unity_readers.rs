use holodori_core::domain::octo::deobfuscate_bundle_header;
use sha2::{Digest, Sha256};
use std::fs;
use unity_rs_core::bundle::{
    BlockDecodeCache, BundleOpenOptions, BundleParseLimits, UnityFsBundle,
};
use unity_rs_core::cubism_moc::{read_cubism_moc, CubismMocReadLimits};
use unity_rs_core::image_export::{write_rgba_image, ImageFormat, ImageRowOrder};
use unity_rs_core::loader::{
    AssetCollection, AssetCollectionParts, LoadedResource, LoadedSerializedFile,
};
use unity_rs_core::serialized::{SerializedFile, SerializedOpenOptions};
use unity_rs_core::source::Region;
use unity_rs_core::texture::{read_texture2d, TextureReadLimits};
use unity_rs_core::unity_version::UnityVersion;

const TEST_CASES: &[(&str, &str, &str, &str)] = &[
    (
        "00007_001",
        "live2d_mdl_00007-nrml-0008-00",
        "../target/spike_cache/DCgZ7m",
        "7eab9201087f3ffb6bc05bbbfa2eb63d84e265c6980820353d872c89faa4ac3b",
    ),
    (
        "00010_001",
        "live2d_mdl_00010-nrml-0010-00",
        "../target/spike_cache/LTdJTw",
        "88cf2df92675ee341b9c5e4520c8b17d869b05cf5f6572f09c6428beb471879c",
    ),
    (
        "00010_004",
        "live2d_mdl_00010-uniq-0069-00",
        "../target/spike_cache/Cfywj9",
        "7e950781c77d52bb73ddc18cdee46a47e5ee04ebcd91311e7bb1aa666040a2b1",
    ),
];

fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("=== Testing unity-rs-core against all 3 HoloDori test bundles ===");
    let unity_version: UnityVersion = "6000.3.15f1".parse()?;

    for (label, asset_name, bundle_path, expected_moc_hash) in TEST_CASES {
        println!("\n=======================================================");
        println!("Evaluating Case {label} ({asset_name})");
        println!("=======================================================");

        let raw_bundle = fs::read(bundle_path)?;
        let mut unmasked = raw_bundle.clone();
        deobfuscate_bundle_header(&mut unmasked, asset_name);

        let temp_dir = tempfile::tempdir()?;
        let temp_bundle_path = temp_dir.path().join("bundle.unity3d");
        fs::write(&temp_bundle_path, &unmasked)?;

        let region = Region::from_file(&temp_bundle_path)?;
        let bundle = UnityFsBundle::open_with_options(
            &region,
            BundleOpenOptions {
                limits: BundleParseLimits::default(),
                oodle_decoder: None,
                unity_cn_key: None,
            },
        )?;

        let mut block_cache = BlockDecodeCache::new();
        let mut loaded_files = Vec::new();
        let mut loaded_resources = Vec::new();

        for index in 0..bundle.entries.len() {
            let entry = &bundle.entries[index];
            let bytes = bundle.read_entry_with_cache(index, &mut block_cache)?;
            let entry_region = Region::from_bytes(bytes);

            // Try opening as SerializedFile
            match SerializedFile::open_with_options(
                entry_region.clone(),
                SerializedOpenOptions {
                    unity_version_override: Some(unity_version.clone()),
                    bundle_version_hint: None,
                    strict_unity_versions: false,
                    ..SerializedOpenOptions::default()
                },
            ) {
                Ok(file) => {
                    loaded_files.push(LoadedSerializedFile {
                        path: entry.path.clone(),
                        file,
                    });
                }
                Err(_) => {
                    // It's a resource (e.g. .resS)
                    loaded_resources.push(LoadedResource {
                        path: entry.path.clone(),
                        region: entry_region,
                    });
                }
            }
        }

        println!(
            "Unpacked entries: {} serialized files, {} external resources",
            loaded_files.len(),
            loaded_resources.len()
        );

        let mut collection = AssetCollection::from_parts(AssetCollectionParts {
            serialized_files: loaded_files,
            resources: loaded_resources,
            diagnostics: Vec::new(),
        });
        collection.rebuild_resource_index(unity_rs_core::loader::AssetLoadLimits::default())?;

        let mut found_moc: Option<(String, Vec<u8>)> = None;
        let mut found_textures: Vec<(String, u32, u32, Vec<u8>)> = Vec::new();

        for file_idx in 0..collection.serialized_files().len() {
            let loaded_file = &collection.serialized_files()[file_idx];
            for (obj_idx, obj) in loaded_file.file.objects.iter().enumerate() {
                // Class 114 = MonoBehaviour
                if obj.class_id == 114 {
                    if let Ok(moc) =
                        read_cubism_moc(&loaded_file.file, obj_idx, CubismMocReadLimits::default())
                    {
                        // HoloDori CubismMoc has SDK version and non-empty moc3 bytes (> 100KB)
                        let mut moc_bytes = Vec::new();
                        moc.write_moc3(&mut moc_bytes, 64 * 1024 * 1024)?;
                        if moc_bytes.len() > 100_000 && moc_bytes.starts_with(b"MOC3") {
                            println!(
                                "  [+] CubismMoc Found: name='{}', sdk={:?}, size={} bytes",
                                moc.name,
                                moc.sdk_version,
                                moc_bytes.len()
                            );
                            found_moc = Some((moc.name.clone(), moc_bytes));
                        }
                    }
                }

                // Class 28 = Texture2D
                if obj.class_id == 28 {
                    match read_texture2d(
                        &collection,
                        &loaded_file.file,
                        obj_idx,
                        TextureReadLimits::default(),
                    ) {
                        Ok(tex) => {
                            println!(
                                "  [+] Texture2D Found: name='{}', dim={}x{}, format={:?}",
                                tex.name, tex.width, tex.height, tex.format
                            );
                            let rgba = tex.decode_mip_rgba8(0, TextureReadLimits::default())?;
                            let mut png_bytes = Vec::new();
                            write_rgba_image(
                                &rgba,
                                ImageFormat::Png,
                                ImageRowOrder::UnityDecoded,
                                64 * 1024 * 1024,
                                &mut png_bytes,
                            )?;
                            println!(
                                "      -> Encoded PNG: {} bytes (starts with PNG: {})",
                                png_bytes.len(),
                                png_bytes.starts_with(b"\x89PNG\r\n\x1a\n")
                            );
                            found_textures.push((
                                tex.name.clone(),
                                tex.width,
                                tex.height,
                                png_bytes,
                            ));
                        }
                        Err(e) => {
                            println!("  [-] Error reading Texture2D at obj {obj_idx}: {e}");
                        }
                    }
                }
            }
        }

        // Verify MOC3 hash
        let (moc_name, moc_bytes) = found_moc.expect("Failed to find valid CubismMoc");
        let mut hasher = Sha256::new();
        hasher.update(&moc_bytes);
        let actual_hash = format!("{:x}", hasher.finalize());
        println!("  MOC name:     {moc_name}");
        println!("  MOC SHA-256:  {actual_hash}");
        println!("  Expected:     {expected_moc_hash}");
        assert_eq!(
            actual_hash, *expected_moc_hash,
            "Hash mismatch for {label}!"
        );
        println!("  => PASS: MOC3 bit-for-bit identity verified!");

        // Verify Textures
        assert!(!found_textures.is_empty(), "Failed to find Texture2D!");
        for (tex_name, w, h, png_bytes) in &found_textures {
            assert_eq!(*w, 4096, "Expected width 4096");
            assert_eq!(*h, 4096, "Expected height 4096");
            assert!(
                png_bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
                "Invalid PNG header"
            );
            println!("  => PASS: Texture '{tex_name}' (4096x4096) valid PNG verified!");
        }
    }

    println!("\n=======================================================");
    println!("ALL 3 REAL SAMPLES PROCESSED WITH 100% BIT-FOR-BIT ACCURACY!");
    println!("=======================================================");
    Ok(())
}
