use holodori_core::domain::octo::{parse_octocache_bytes, OctoAuditReport, OctoItem};
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = env::args().collect();
    let default_path = PathBuf::from(
        r"E:\SteamLibrary\steamapps\common\hololiveDreams\hololive-Dreams_Data\Octo\octocacheevai",
    );
    let input_path = if args.len() > 1 && !args[1].starts_with("--") {
        PathBuf::from(&args[1])
    } else {
        default_path
    };

    println!("=== HDM OCTOCACHE INSPECTOR ===");
    println!("Target octocache file: {}", input_path.display());

    if !input_path.exists() {
        eprintln!(
            "Error: octocacheevai file does not exist at {}",
            input_path.display()
        );
        std::process::exit(1);
    }

    let file_bytes = fs::read(&input_path)?;
    println!("File size: {} bytes", file_bytes.len());

    let start_time = std::time::Instant::now();
    let db = parse_octocache_bytes(&file_bytes)?;
    let elapsed = start_time.elapsed();

    println!("Decrypted and parsed successfully in {:.2?}", elapsed);
    println!("Revision ID: {}", db.revision_id);
    println!("URL Format:  {}", db.url_format);
    println!("Asset Bundles: {}", db.asset_bundles.len());
    println!("Resources:     {}", db.resources.len());

    // Classify
    let mut live2d_mdl = 0;
    let mut live2d_mot = 0;
    let mut live2d_exp = 0;

    for ab in &db.asset_bundles {
        if ab.name.starts_with("live2d_mdl_") {
            live2d_mdl += 1;
        } else if ab.name.starts_with("live2d_mot_") {
            live2d_mot += 1;
        } else if ab.name.starts_with("live2d_exp_") {
            live2d_exp += 1;
        }
    }

    let total_live2d = live2d_mdl + live2d_mot + live2d_exp;
    println!("\n--- Live2D Classification ---");
    println!("  Models (live2d_mdl_*):      {}", live2d_mdl);
    println!("  Motions (live2d_mot_*):     {}", live2d_mot);
    println!("  Expressions (live2d_exp_*): {}", live2d_exp);
    println!("  Total Live2D bundles:       {}", total_live2d);

    // Language stats
    let langs = ["eng", "kor", "chs", "cht", "ind"];
    let mut lang_dist: BTreeMap<String, usize> = BTreeMap::new();
    let mut shared_count = 0;

    for ab in &db.asset_bundles {
        let mut found = false;
        for l in &langs {
            let tag = format!("_lang-{}", l);
            if ab.name.contains(&tag) {
                *lang_dist.entry(l.to_string()).or_default() += 1;
                found = true;
                break;
            }
        }
        if !found {
            shared_count += 1;
        }
    }
    lang_dist.insert("shared_jpn".to_string(), shared_count);

    println!("\n--- Language Distribution ---");
    for (l, cnt) in &lang_dist {
        println!("  {:<12}: {}", l, cnt);
    }

    // Known sample verification
    let known_keys = [
        ("00007_001", "live2d_mdl_00007-nrml-0008-00"),
        ("00007_002", "live2d_mdl_00007-uniq-0008-00"),
        ("00007_003", "live2d_mdl_00007-cmmn-0000-00"),
        ("00010_001", "live2d_mdl_00010-nrml-0010-00"),
        ("00010_002", "live2d_mdl_00010-uniq-0010-00"),
        ("00010_004", "live2d_mdl_00010-uniq-0069-00"),
        ("00012_004", "live2d_mdl_00012-uniq-0062-00"),
    ];

    let mut known_map: BTreeMap<String, Option<OctoItem>> = BTreeMap::new();
    println!("\n--- Known Sample Verification ---");
    for (label, pattern) in known_keys {
        let matched = db
            .asset_bundles
            .iter()
            .find(|ab| ab.name == pattern)
            .cloned();
        if let Some(ref m) = matched {
            println!(
                "  [FOUND] {:<10} -> ID: {:<5} | Obj: {:<6} | Size: {:<8} | MD5: {}",
                label, m.id, m.object_name, m.size, m.md5
            );
        } else {
            println!("  [NOT FOUND] {}", label);
        }
        known_map.insert(label.to_string(), matched);
    }

    // Export report
    let report = OctoAuditReport {
        revision_id: db.revision_id,
        url_format: db.url_format,
        total_asset_bundles: db.asset_bundles.len(),
        total_resources: db.resources.len(),
        live2d_model_bundles: live2d_mdl,
        live2d_motion_bundles: live2d_mot,
        live2d_expression_bundles: live2d_exp,
        total_live2d_bundles: total_live2d,
        language_distribution: lang_dist,
        known_models: known_map,
    };

    let report_json = serde_json::to_string_pretty(&report)?;
    let report_path = Path::new("docs/octocache_audit_report.json");
    if let Some(parent) = report_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(report_path, &report_json)?;
    println!(
        "\nAudit metadata report exported to: {}",
        report_path.display()
    );

    Ok(())
}
