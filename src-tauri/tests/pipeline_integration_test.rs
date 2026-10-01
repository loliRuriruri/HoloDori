use std::fs;
use std::path::PathBuf;
use tempfile::tempdir;

use holodori_core::domain::builder::{PackageBuilder, sanitize_filename};
use holodori_core::domain::error::ErrorCode;
use holodori_core::domain::extractor::{
    extract_and_stage_moc, extract_bytes,
};
use holodori_core::domain::manifest::Model3Manifest;
use holodori_core::domain::matcher::TextureMatcher;
use holodori_core::domain::parser::{IdentityParser, NamingRuleConfig};
use holodori_core::domain::scanner::compute_sha256;
use holodori_core::domain::types::{
    BuildStatus, ConflictPolicy, FileClassification, MatchConfidence, MatchedPair, ModelSourceType,
    ScannedFile,
};
use holodori_core::domain::{ConversionPipeline, PipelineConfig};

pub const SYNTHETIC_PNG_BYTES: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG Signature
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR header
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1 width, height
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, // 8-bit RGBA
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, // IDAT chunk
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
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
    for i in 5..128 {
        bytes[i] = (i % 256) as u8;
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

// 1. JSON without _bytes
#[test]
fn test_json_without_bytes() {
    let dir = tempdir().unwrap();
    let json_path = dir.path().join("no_bytes.json");
    fs::write(&json_path, r#"{"name": "test", "items": [1, 2, 3]}"#).unwrap();

    let err = extract_bytes(&json_path).unwrap_err();
    assert_eq!(err.code(), ErrorCode::ErrNoBytesFound);
}

// 2. Valid synthetic _bytes
#[test]
fn test_valid_synthetic_bytes() {
    let dir = tempdir().unwrap();
    let json_path = dir.path().join("valid_model.json");
    let synthetic_moc = create_synthetic_moc3_bytes(3);
    fs::write(&json_path, create_synthetic_model_json(&synthetic_moc)).unwrap();

    let extracted = extract_bytes(&json_path).unwrap();
    assert_eq!(extracted, synthetic_moc);

    let staged = extract_and_stage_moc(&json_path).unwrap();
    assert_eq!(staged.version, 3);
    assert!(staged.temp_path.is_file());
    let _ = fs::remove_file(staged.temp_path);
}

// 3. Invalid negative value
#[test]
fn test_invalid_negative_byte() {
    let dir = tempdir().unwrap();
    let json_path = dir.path().join("negative_byte.json");
    fs::write(&json_path, r#"{"_bytes": [77, 79, 67, 51, -5, 0]}"#).unwrap();

    let err = extract_bytes(&json_path).unwrap_err();
    assert_eq!(err.code(), ErrorCode::ErrInvalidByteValue);
}

// 4. Value > 255
#[test]
fn test_invalid_byte_gt_255() {
    let dir = tempdir().unwrap();
    let json_path = dir.path().join("gt_255_byte.json");
    fs::write(&json_path, r#"{"_bytes": [77, 79, 67, 51, 300, 0]}"#).unwrap();

    let err = extract_bytes(&json_path).unwrap_err();
    assert_eq!(err.code(), ErrorCode::ErrInvalidByteValue);
}

// 5. Non-number in array
#[test]
fn test_non_number_in_array() {
    let dir = tempdir().unwrap();
    let json_path = dir.path().join("non_number.json");
    fs::write(&json_path, r#"{"_bytes": [77, 79, "invalid", 51]}"#).unwrap();

    let err = extract_bytes(&json_path).unwrap_err();
    assert_eq!(err.code(), ErrorCode::ErrMalformedBytesArray);
}

// 6. Nested _bytes
#[test]
fn test_nested_bytes() {
    let dir = tempdir().unwrap();
    let json_path = dir.path().join("nested.json");
    let synthetic_moc = create_synthetic_moc3_bytes(4);
    let byte_arr: Vec<u64> = synthetic_moc.iter().map(|&b| b as u64).collect();

    let nested_json = serde_json::json!({
        "container": {
            "subcontainer": {
                "payload": {
                    "_bytes": byte_arr
                }
            }
        }
    });
    fs::write(&json_path, serde_json::to_string(&nested_json).unwrap()).unwrap();

    let extracted = extract_bytes(&json_path).unwrap();
    assert_eq!(extracted, synthetic_moc);
}

// 7. Multiple _bytes candidates
#[test]
fn test_multiple_bytes_candidates() {
    let dir = tempdir().unwrap();
    let json_path = dir.path().join("multiple_candidates.json");
    let json = serde_json::json!({
        "first": { "_bytes": [1, 2, 3] },
        "second": { "_bytes": [4, 5, 6] }
    });
    fs::write(&json_path, serde_json::to_string(&json).unwrap()).unwrap();

    let err = extract_bytes(&json_path).unwrap_err();
    assert_eq!(err.code(), ErrorCode::ErrMultipleBytesCandidates);
}

// 8. Malformed JSON
#[test]
fn test_malformed_json() {
    let dir = tempdir().unwrap();
    let json_path = dir.path().join("corrupted.json");
    fs::write(&json_path, r#"{"incomplete": [1, 2, 3"#).unwrap();

    let err = extract_bytes(&json_path).unwrap_err();
    assert_eq!(err.code(), ErrorCode::ErrJsonSyntax);
}

// 9. Missing texture
#[test]
fn test_missing_texture() {
    let dir = tempdir().unwrap();
    let model_path = dir.path().join("model_12345_001.json");
    let parser = IdentityParser::new(NamingRuleConfig::default());
    let identity = parser.parse_path(&model_path).unwrap();

    let matched = TextureMatcher::match_model(&model_path, ModelSourceType::JsonBytes, &identity, &[]);
    assert_eq!(matched.match_confidence, MatchConfidence::NoMatch);
    assert!(matched.textures.is_empty());
}

// 10. Duplicate / conflicting texture candidates
#[test]
fn test_duplicate_texture_candidates() {
    let dir = tempdir().unwrap();
    let model_path = dir.path().join("12345_001.json");
    let tex1 = dir.path().join("12345_001_a.png");
    let tex2 = dir.path().join("12345_001_b.png");

    let parser = IdentityParser::new(NamingRuleConfig::default());
    let identity = parser.parse_path(&model_path).unwrap();

    let scanned_texs = vec![
        ScannedFile {
            path: tex1.clone(),
            relative_path: PathBuf::from("12345_001_a.png"),
            file_name: "12345_001_a.png".to_string(),
            size_bytes: 100,
            sha256: "abc".to_string(),
            classification: FileClassification::TextureImage,
        },
        ScannedFile {
            path: tex2.clone(),
            relative_path: PathBuf::from("12345_001_b.png"),
            file_name: "12345_001_b.png".to_string(),
            size_bytes: 100,
            sha256: "def".to_string(),
            classification: FileClassification::TextureImage,
        },
    ];

    let matched = TextureMatcher::match_model(
        &model_path,
        ModelSourceType::JsonBytes,
        &identity,
        &scanned_texs,
    );
    assert_eq!(matched.match_confidence, MatchConfidence::Ambiguous);
    assert_eq!(matched.textures.len(), 2);
}

// 11. Ambiguous naming
#[test]
fn test_ambiguous_naming() {
    let parser = IdentityParser::new(NamingRuleConfig::default());
    // Name with two distinct 5-digit character identifiers
    let res = parser.parse_name("model_11111_22222_001").unwrap();
    assert_eq!(res.confidence, MatchConfidence::Ambiguous);

    // Completely unparseable name
    let err = parser.parse_name("random_unstructured_filename").unwrap_err();
    assert_eq!(err.code(), ErrorCode::ErrAmbiguousNaming);
}

// 12. Path traversal attempt
#[test]
fn test_path_traversal_attempt() {
    let invalid_rel = "../outside.moc3";
    let err = Model3Manifest::new_minimal(invalid_rel, &["textures/tex.png".to_string()]).unwrap_err();
    assert_eq!(err.code(), ErrorCode::ErrPathTraversalDetected);

    let invalid_tex = "textures/../../evil.png";
    let err = Model3Manifest::new_minimal("model.moc3", &[invalid_tex.to_string()]).unwrap_err();
    assert_eq!(err.code(), ErrorCode::ErrPathTraversalDetected);

    // Sanitizer ensures output dir cannot traverse
    assert_eq!(sanitize_filename("../../etc/passwd"), "etcpasswd");
}

// 13. Existing output collision handling
#[test]
fn test_existing_output_collision() {
    let dir = tempdir().unwrap();
    let out_root = dir.path().join("output");
    let existing_pkg = out_root.join("12345_001");
    fs::create_dir_all(&existing_pkg).unwrap();

    let model_json = dir.path().join("12345_001_nrml.json");
    let synthetic_moc = create_synthetic_moc3_bytes(3);
    fs::write(&model_json, create_synthetic_model_json(&synthetic_moc)).unwrap();

    let tex_png = dir.path().join("12345_001_nrml.png");
    fs::write(&tex_png, SYNTHETIC_PNG_BYTES).unwrap();

    let parser = IdentityParser::new(NamingRuleConfig::default());
    let identity = parser.parse_path(&model_json).unwrap();
    let pair = MatchedPair {
        id: "12345_001".to_string(),
        model_source: model_json,
        model_type: ModelSourceType::JsonBytes,
        identity,
        textures: vec![tex_png],
        match_confidence: MatchConfidence::Exact,
        evidence: vec![],
        warnings: vec![],
    };

    // Policy Skip should error on collision
    let err = PackageBuilder::build_package(&pair, &out_root, ConflictPolicy::Skip).unwrap_err();
    assert_eq!(err.code(), ErrorCode::ErrOutputCollision);

    // Policy UniqueSuffix should create 12345_001_1
    let result = PackageBuilder::build_package(&pair, &out_root, ConflictPolicy::UniqueSuffix).unwrap();
    assert!(result.package_dir.ends_with("12345_001_1"));
    assert!(result.moc_path.is_file());
}

// 14. Manifest relative path validation
#[test]
fn test_manifest_relative_path_validation() {
    // Windows absolute path
    let err = Model3Manifest::new_minimal(
        "C:\\Windows\\System32\\model.moc3",
        &["textures/texture_00.png".to_string()],
    )
    .unwrap_err();
    assert_eq!(err.code(), ErrorCode::ErrPathTraversalDetected);

    // Valid relative paths
    let manifest = Model3Manifest::new_minimal(
        "12345_001.moc3",
        &["textures/texture_00.png".to_string()],
    )
    .unwrap();
    assert_eq!(manifest.version, 3);
    assert_eq!(manifest.file_references.moc, "12345_001.moc3");
}

// 15. Round-trip JSON validation
#[test]
fn test_round_trip_json_validation() {
    let manifest = Model3Manifest::new_minimal(
        "character_001.moc3",
        &["textures/texture_00.png".to_string(), "textures/texture_01.png".to_string()],
    )
    .unwrap();

    let serialized = manifest.to_json_pretty().unwrap();
    let deserialized = Model3Manifest::from_json_str(&serialized).unwrap();
    assert_eq!(manifest, deserialized);
}

// 16. Golden Fixture Test (Section 15) & End-to-End Pipeline
#[test]
fn test_golden_fixture_pipeline() {
    let input_dir = tempdir().unwrap();
    let output_dir = tempdir().unwrap();

    // Golden parameters: character = 12345, outfit = 001, style = nrml
    let model_json_path = input_dir.path().join("model_12345_001_nrml.json");
    let synthetic_moc = create_synthetic_moc3_bytes(3);
    fs::write(&model_json_path, create_synthetic_model_json(&synthetic_moc)).unwrap();

    let texture_png_path = input_dir.path().join("texture_12345_001_nrml.png");
    fs::write(&texture_png_path, SYNTHETIC_PNG_BYTES).unwrap();

    let initial_json_hash = compute_sha256(&model_json_path).unwrap();
    let initial_png_hash = compute_sha256(&texture_png_path).unwrap();

    // Execute pipeline
    let pipeline = ConversionPipeline::new(PipelineConfig::default());
    let batch_report = pipeline
        .run_batch(&[input_dir.path().to_path_buf()], output_dir.path())
        .unwrap();

    // Assert overall pass
    assert_eq!(batch_report.total_models, 1);
    assert_eq!(batch_report.passed, 1);
    assert_eq!(batch_report.failed, 0);
    assert_eq!(batch_report.overall_status, BuildStatus::Pass);

    let report = &batch_report.reports[0];
    assert_eq!(report.status, BuildStatus::Pass);
    assert_eq!(report.model_id, "12345_001");

    // Verify expected package directory layout:
    // output/12345_001/
    //   12345_001.moc3
    //   12345_001.model3.json
    //   textures/texture_00.png
    let pkg_dir = output_dir.path().join("12345_001");
    assert!(pkg_dir.is_dir());

    let moc_path = pkg_dir.join("12345_001.moc3");
    assert!(moc_path.is_file());

    let manifest_path = pkg_dir.join("12345_001.model3.json");
    assert!(manifest_path.is_file());

    let texture_path = pkg_dir.join("textures").join("texture_00.png");
    assert!(texture_path.is_file());

    // Verify manifest contents
    let manifest_content = fs::read_to_string(&manifest_path).unwrap();
    let manifest = Model3Manifest::from_json_str(&manifest_content).unwrap();
    assert_eq!(manifest.version, 3);
    assert_eq!(manifest.file_references.moc, "12345_001.moc3");
    assert_eq!(manifest.file_references.textures, vec!["textures/texture_00.png"]);

    // Verify 10-stage validation checklist: all 10 stages must PASS
    assert_eq!(report.validation_stages.len(), 10);
    for stage in &report.validation_stages {
        assert!(stage.passed, "Stage '{}' failed: {}", stage.stage_name, stage.message);
    }

    // 17. Input source integrity test: Source files remain bit-for-bit unchanged
    let post_json_hash = compute_sha256(&model_json_path).unwrap();
    let post_png_hash = compute_sha256(&texture_png_path).unwrap();
    assert_eq!(initial_json_hash, post_json_hash, "Source JSON was modified!");
    assert_eq!(initial_png_hash, post_png_hash, "Source PNG was modified!");
}

// 18. Reproducibility test
#[test]
fn test_reproducibility() {
    let input_dir = tempdir().unwrap();
    let out_dir_1 = tempdir().unwrap();
    let out_dir_2 = tempdir().unwrap();

    let model_json = input_dir.path().join("12345_001.json");
    let moc_bytes = create_synthetic_moc3_bytes(3);
    fs::write(&model_json, create_synthetic_model_json(&moc_bytes)).unwrap();

    let tex_png = input_dir.path().join("12345_001.png");
    fs::write(&tex_png, SYNTHETIC_PNG_BYTES).unwrap();

    let pipeline = ConversionPipeline::new(PipelineConfig::default());

    let report1 = pipeline.run_batch(&[input_dir.path().to_path_buf()], out_dir_1.path()).unwrap();
    let report2 = pipeline.run_batch(&[input_dir.path().to_path_buf()], out_dir_2.path()).unwrap();

    assert_eq!(report1.overall_status, BuildStatus::Pass);
    assert_eq!(report2.overall_status, BuildStatus::Pass);

    let pkg1_moc = out_dir_1.path().join("12345_001").join("12345_001.moc3");
    let pkg2_moc = out_dir_2.path().join("12345_001").join("12345_001.moc3");
    assert_eq!(compute_sha256(&pkg1_moc).unwrap(), compute_sha256(&pkg2_moc).unwrap());

    let pkg1_manifest = out_dir_1.path().join("12345_001").join("12345_001.model3.json");
    let pkg2_manifest = out_dir_2.path().join("12345_001").join("12345_001.model3.json");
    assert_eq!(fs::read_to_string(pkg1_manifest).unwrap(), fs::read_to_string(pkg2_manifest).unwrap());
}
