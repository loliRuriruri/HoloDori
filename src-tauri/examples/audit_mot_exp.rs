use holodori_core::domain::octo::{deobfuscate_bundle_header, parse_octocache_bytes};
use std::fs;
use std::path::Path;
use unity_rs_core::bundle::{
    BlockDecodeCache, BundleOpenOptions, BundleParseLimits, UnityFsBundle,
};
use unity_rs_core::serialized::{SerializedFile, SerializedOpenOptions};
use unity_rs_core::source::Region;

#[tokio::main]
async fn main() {
    let path = Path::new(
        r"E:\SteamLibrary\steamapps\common\hololiveDreams\hololive-Dreams_Data\Octo\octocacheevai",
    );
    let bytes = fs::read(path).expect("Failed to read octocache");
    let db = parse_octocache_bytes(&bytes).expect("Failed to parse octocache");

    let client = reqwest::Client::new();
    let cache_dir = Path::new("target/audit_cache");
    fs::create_dir_all(cache_dir).unwrap();

    println!("=== AUDIT: 00007 EXPRESSIONS ===");
    let exp_00007: Vec<_> = db
        .asset_bundles
        .iter()
        .filter(|b| b.name.starts_with("live2d_exp_") && b.name.contains("00007"))
        .collect();
    println!("Found {} expressions for 00007", exp_00007.len());

    for e in &exp_00007 {
        let b = download_bundle(&client, &e.object_name, cache_dir).await;
        let info = extract_expression_info(&b, &e.name);
        println!(
            "  - {:<36} obj={:<8} size={:<5} params={:<2} fadeIn={:.2} fadeOut={:.2}",
            e.name, e.object_name, e.size, info.params_count, info.fade_in, info.fade_out
        );
    }

    println!("\n=== AUDIT: 00010 EXPRESSIONS ===");
    let exp_00010: Vec<_> = db
        .asset_bundles
        .iter()
        .filter(|b| b.name.starts_with("live2d_exp_") && b.name.contains("00010"))
        .collect();
    println!("Found {} expressions for 00010", exp_00010.len());

    for e in &exp_00010 {
        let b = download_bundle(&client, &e.object_name, cache_dir).await;
        let info = extract_expression_info(&b, &e.name);
        println!(
            "  - {:<36} obj={:<8} size={:<5} params={:<2} fadeIn={:.2} fadeOut={:.2}",
            e.name, e.object_name, e.size, info.params_count, info.fade_in, info.fade_out
        );
    }

    println!("\n=== AUDIT: SAMPLE MOTIONS ===");
    let target_motions = [
        "live2d_mot_joy-01_lv01",
        "live2d_mot_smile-01_lv01",
        "live2d_mot_yes-01_lv01",
        "live2d_mot_wink-01_lv01",
        "live2d_mot_anger-01_lv01",
        "live2d_mot_surprise-01_lv01",
    ];

    for name in &target_motions {
        if let Some(m) = db.asset_bundles.iter().find(|b| b.name == *name) {
            let b = download_bundle(&client, &m.object_name, cache_dir).await;
            let info = extract_motion_info(&b, &m.name);
            println!("  - {:<28} obj={:<8} size={:<5} curves={:<2} duration={:.2}s fadeIn={:.2} fadeOut={:.2}",
                m.name, m.object_name, m.size, info.curves_count, info.duration, info.fade_in, info.fade_out);
        }
    }
}

async fn download_bundle(client: &reqwest::Client, object_name: &str, cache_dir: &Path) -> Vec<u8> {
    let cached_path = cache_dir.join(object_name);
    if cached_path.exists() {
        return fs::read(&cached_path).unwrap();
    }
    let url = format!(
        "https://asset.review-game-hololive-dreams.com/{}",
        object_name
    );
    let resp = client
        .get(&url)
        .send()
        .await
        .expect("Failed to download bundle");
    let bytes = resp.bytes().await.expect("Failed to read body").to_vec();
    fs::write(&cached_path, &bytes).unwrap();
    bytes
}

struct ExpressionInfo {
    params_count: usize,
    fade_in: f32,
    fade_out: f32,
}

fn extract_expression_info(raw_bytes: &[u8], asset_name: &str) -> ExpressionInfo {
    let mut unmasked = raw_bytes.to_vec();
    deobfuscate_bundle_header(&mut unmasked, asset_name);

    let temp_dir = tempfile::tempdir().unwrap();
    let temp_bundle = temp_dir.path().join("bundle.unity3d");
    fs::write(&temp_bundle, &unmasked).unwrap();

    let region = Region::from_file(&temp_bundle).unwrap();
    let bundle = UnityFsBundle::open_with_options(
        &region,
        BundleOpenOptions {
            limits: BundleParseLimits::default(),
            oodle_decoder: None,
            unity_cn_key: None,
        },
    )
    .unwrap();

    let mut block_cache = BlockDecodeCache::new();
    let raw_entry_bytes = bundle.read_entry_with_cache(0, &mut block_cache).unwrap();
    let file = SerializedFile::open_with_options(
        Region::from_bytes(raw_entry_bytes.clone()),
        SerializedOpenOptions {
            unity_version_override: Some("6000.3.15f1".parse().unwrap()),
            bundle_version_hint: None,
            strict_unity_versions: false,
            ..SerializedOpenOptions::default()
        },
    )
    .unwrap();

    let mut params_count = 0;
    let mut fade_in = 0.0f32;
    let mut fade_out = 0.0f32;

    for obj in &file.objects {
        if obj.class_id == 114 {
            let start = obj.byte_start as usize;
            let end = start + obj.byte_size as usize;
            let data = &raw_entry_bytes[start..end];

            // Locate "Live2D Expression" string
            for offset in 0..data.len() - 20 {
                let len = u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap()) as usize;
                if len == 17
                    && offset + 4 + len <= data.len()
                    && &data[offset + 4..offset + 4 + len] == b"Live2D Expression"
                {
                    let cur = offset + 4 + 20; // 17 aligned to 4 = 20
                    fade_in = f32::from_le_bytes(data[cur..cur + 4].try_into().unwrap());
                    fade_out = f32::from_le_bytes(data[cur + 4..cur + 8].try_into().unwrap());
                    params_count =
                        u32::from_le_bytes(data[cur + 8..cur + 12].try_into().unwrap()) as usize;
                    break;
                }
            }
        }
    }

    ExpressionInfo {
        params_count,
        fade_in,
        fade_out,
    }
}

struct MotionInfo {
    curves_count: usize,
    duration: f32,
    fade_in: f32,
    fade_out: f32,
}

fn extract_motion_info(raw_bytes: &[u8], asset_name: &str) -> MotionInfo {
    let mut unmasked = raw_bytes.to_vec();
    deobfuscate_bundle_header(&mut unmasked, asset_name);

    let temp_dir = tempfile::tempdir().unwrap();
    let temp_bundle = temp_dir.path().join("bundle.unity3d");
    fs::write(&temp_bundle, &unmasked).unwrap();

    let region = Region::from_file(&temp_bundle).unwrap();
    let bundle = UnityFsBundle::open_with_options(
        &region,
        BundleOpenOptions {
            limits: BundleParseLimits::default(),
            oodle_decoder: None,
            unity_cn_key: None,
        },
    )
    .unwrap();

    let mut block_cache = BlockDecodeCache::new();
    let raw_entry_bytes = bundle.read_entry_with_cache(0, &mut block_cache).unwrap();
    let file = SerializedFile::open_with_options(
        Region::from_bytes(raw_entry_bytes.clone()),
        SerializedOpenOptions {
            unity_version_override: Some("6000.3.15f1".parse().unwrap()),
            bundle_version_hint: None,
            strict_unity_versions: false,
            ..SerializedOpenOptions::default()
        },
    )
    .unwrap();

    let mut curves_count = 0;
    let mut fade_in = 0.5f32;
    let mut fade_out = 0.5f32;
    let mut duration = 0.0f32;

    for obj in &file.objects {
        if obj.class_id == 114 {
            let start = obj.byte_start as usize;
            let end = start + obj.byte_size as usize;
            let data = &raw_entry_bytes[start..end];
            for offset in 0..data.len() - 4 {
                let count =
                    u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap()) as usize;
                if (20..=50).contains(&count) {
                    let next_len =
                        u32::from_le_bytes(data[offset + 4..offset + 8].try_into().unwrap());
                    if next_len == 11 {
                        // "ParamAngleX"
                        curves_count = count;
                        // Read to end of bindings to get fade_in and fade_out
                        let mut cur = offset + 4;
                        for _ in 0..count {
                            let len1 =
                                u32::from_le_bytes(data[cur..cur + 4].try_into().unwrap()) as usize;
                            cur += 4 + ((len1 + 3) & !3);
                            let len2 =
                                u32::from_le_bytes(data[cur..cur + 4].try_into().unwrap()) as usize;
                            cur += 4 + ((len2 + 3) & !3);
                            let len3 =
                                u32::from_le_bytes(data[cur..cur + 4].try_into().unwrap()) as usize;
                            cur += 4 + ((len3 + 3) & !3);
                            cur += 4; // bindingType
                            let len4 =
                                u32::from_le_bytes(data[cur..cur + 4].try_into().unwrap()) as usize;
                            cur += 4 + ((len4 + 3) & !3);
                        }
                        if cur + 8 <= data.len() {
                            fade_in = f32::from_le_bytes(data[cur..cur + 4].try_into().unwrap());
                            fade_out =
                                f32::from_le_bytes(data[cur + 4..cur + 8].try_into().unwrap());
                        }
                        break;
                    }
                }
            }
        } else if obj.class_id == 74 {
            let start = obj.byte_start as usize;
            let end = start + obj.byte_size as usize;
            let data = &raw_entry_bytes[start..end];
            // Find max time in streamed clip
            for cur in (0..data.len() - 8).step_by(4) {
                let time = f32::from_le_bytes(data[cur..cur + 4].try_into().unwrap());
                let num = u32::from_le_bytes(data[cur + 4..cur + 8].try_into().unwrap()) as usize;
                if (0.0..=60.0).contains(&time) && num > 0 && num <= 40 && time > duration {
                    duration = time;
                }
            }
        }
    }

    MotionInfo {
        curves_count,
        duration,
        fade_in,
        fade_out,
    }
}
