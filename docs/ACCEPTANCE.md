# HoloDori Live2D Manager — Acceptance Gates & Criteria

## Acceptance Gate: HDM.AGENT.1

HDM.AGENT.1 represents the completion of Phase 1: a standalone desktop application with a pure Rust conversion engine capable of turning hololive Dreams Live2D resource files into valid Cubism model packages.

### Mandatory Acceptance Gates

| Gate ID | Requirement | Verification Method | Pass Criteria |
|---------|-------------|---------------------|---------------|
| **AG-1** | Clean Build | `cargo build --workspace`, `npm run build` | Zero compilation errors or unhandled warnings in release profile. |
| **AG-2** | Rust Test Suite | `cargo test --workspace` | 100% of unit and integration tests pass without panics. |
| **AG-3** | Frontend Checks | `npm run build` (tsc typecheck + vite bundle) | Zero TypeScript compile errors, valid bundle generated in `dist/`. |
| **AG-4** | Synthetic E2E Conversion | Golden fixture pipeline test (`12345_001_nrml`) | Successfully converts synthetic model resource + PNG texture into complete package. |
| **AG-5** | Malformed Fixtures | Comprehensive negative test suite | Correctly catches and cleanly reports all 12 negative test scenarios with structured error codes. |
| **AG-6** | Input Source Integrity | Cryptographic hash comparison (SHA-256) | Source JSON and PNG files remain bit-for-bit identical before and after conversion. |
| **AG-7** | Manifest Reference Validity | Cubism reference validator | All relative paths in `model3.json` resolve to existing files strictly within the package; no escaping directory. |
| **AG-8** | Zero Python Dependency | Process & dependency audit | Zero invocation of `python`, `python3`, or Python scripts anywhere in the runtime build or execution path. |
| **AG-9** | Reproducibility | Deterministic repeat test | Two identical runs on identical inputs yield bit-for-bit identical output packages. |
| **AG-10** | Documentation Accuracy | Cross-check documentation vs implementation | Architecture, formats, and third-party notes accurately reflect the code. |

---

## Negative Test Scenarios (AG-5)

1. **JSON without `_bytes`**: Recognizes valid JSON, identifies absence of binary payload, returns structured error `ERR_NO_BYTES_FOUND`.
2. **Invalid negative byte**: Detects values `< 0` in array, rejects with `ERR_INVALID_BYTE_VALUE`.
3. **Invalid byte > 255**: Detects values `> 255`, rejects with `ERR_INVALID_BYTE_VALUE`.
4. **Non-numeric token in array**: Rejects strings, booleans, objects, nulls inside `_bytes` with `ERR_MALFORMED_BYTES_ARRAY`.
5. **Nested `_bytes`**: Safely finds candidate array inside nested objects without stack overflow or arbitrary recursion.
6. **Multiple `_bytes` candidates**: Detects multiple candidate arrays, handles disambiguation deterministically or flags ambiguity.
7. **Malformed JSON**: Detects corrupted / unparseable JSON, rejects with `ERR_JSON_SYNTAX`.
8. **Missing texture**: Handles MOC extraction where no matching texture candidate exists, flags as `ERR_TEXTURE_NOT_FOUND` or warning depending on mode.
9. **Duplicate / conflicting texture candidates**: When two equally valid textures compete for one model, marks matching as `Ambiguous` and stops automatic build.
10. **Ambiguous naming**: Non-standard filename patterns do not guess or corrupt character/outfit identity.
11. **Path traversal attempt**: Input filenames containing `../` or `..\` are sanitized and barred from escaping output directory (`ERR_PATH_TRAVERSAL_DETECTED`).
12. **Existing output collision**: Safe conflict policy (`Skip`, `UniqueSuffix`, `Overwrite`) tested against existing target directories.

---

## Golden Fixture Specification (AG-4)

- **Character ID**: `12345`
- **Outfit ID**: `001`
- **Style Tag**: `nrml`
- **Inputs**:
  - `model_12345_001_nrml.json`: Synthetic JSON containing `_bytes` with valid MOC3 magic bytes (`MOC3` + version 0x03) and synthetic parameter blocks.
  - `texture_12345_001_nrml.png`: Synthetic 64x64 valid PNG image.
- **Expected Output Layout**:
  ```
  output/
    12345_001/
      12345_001.moc3
      12345_001.model3.json
      textures/
        texture_00.png
  ```
- **Validation**:
  - `12345_001.model3.json` references `12345_001.moc3` and `textures/texture_00.png`.
  - Both target files exist and are readable.
  - No absolute paths present.
  - Build status: `PASS` (or `PASS_WITH_WARNINGS` with advisory runtime warning when Level 3 is `NOT_TESTED`).

---

## Acceptance Gate: HDM.AGENT.1R — Real Sample Validation & Hardening

HDM.AGENT.1R hardens the conversion pipeline against real-world sample behaviors and establishes an explicit 3-level validation architecture.

### Enhanced Gates in AGENT.1R

| Gate ID | Area | Verification Method | Pass Criteria | Status |
|---|---|---|---|---|
| **AG1R-1** | Typed MOC3 Versioning | Header inspection & typed enum | `MocVersion::Known(1..=5)` recognized; unknown future versions (e.g. 6) treated as candidate with warning (`Unknown(raw)`); invalid versions (`0x00`) rejected. | **PASS** |
| **AG1R-2** | 3-Level Validation Model | Structured pipeline report | Explicit separation: Level 1 (Container Candidate), Level 2 (Package Structural Validation), Level 3 (Cubism Runtime Validation). | **PASS** |
| **AG1R-3** | Runtime State Honesty | `RuntimeValidationStatus` | `NOT_TESTED` explicitly recorded without false `PASS` conversion; generates `PassWithWarnings`. | **PASS** |
| **AG1R-4** | Sequenced Multi-Atlas Textures | Atlas matching algorithm | Sequenced textures (`_00`, `_01`) matched in order without false duplicate collision. | **PASS** |
| **AG1R-5** | Outfit 004 Non-Hardcoding | Naming parser rules | Outfit `004` never hardcoded to swimsuit without explicit evidence; handled deterministically. | **PASS** |
| **AG1R-6** | Real Asset Protection | `.gitignore` enforcement | Zero proprietary or copyrighted assets committed or staged in git. | **PASS** |
| **AG1R-7** | Zero Regression | Full test suite (`cargo test --workspace`) | 24 tests passing (17 original + 7 AGENT.1R hardening tests). | **PASS** |
| **AG1R-8** | Level 3 Runtime Status | Live2D viewer / Cubism Core | Awaiting manual external Live2D viewer rendering or official Live2D Core test. | **PARTIAL — PENDING** |

---

## Acceptance Gate: HDM.AGENT.1R2 — Real Asset & Runtime Acceptance

HDM.AGENT.1R2 successfully proves the pipeline against real local HoloDori Live2D resources and achieves official Live2D runtime rendering acceptance.

### Mandatory Gates & Status (HDM.AGENT.1R2)

| Gate ID | Requirement | Verification Method | Pass Criteria | Status |
|---|---|---|---|---|
| **AG1R2-1** | Regression Suite | `cargo test --workspace` | All 28 automated tests pass without failure. | **PASS** |
| **AG1R2-2** | Real Model Processing | Pipeline execution on real assets | Process at least 2 independent real HoloDori models without manual file renaming. | **PASS** (5 models: `00007_001`, `00010_001`, `00010_004`, `00007_002`, `00007_003`) |
| **AG1R2-3** | Real Level 2 PASS | Structured 11-stage validator | At least 2 real models pass Level 2 validation (Moc/texture existence, relative resolution, path confinement, re-parseability). | **PASS** (5/5 models pass Level 2) |
| **AG1R2-4** | Real Runtime Acceptance | Official Live2D Cubism Viewer 5.3 | At least 1 model visibly renders in actual Live2D runtime (Cubism Core 06.00.0513, GPU texture binding). | **PASS** (2 models verified: `00007_001` and `00010_001`) |
| **AG1R2-5** | Source Integrity | SHA-256 pre vs post conversion | All input JSON and PNG source files remain bit-for-bit unchanged. | **PASS** |
| **AG1R2-6** | Deterministic Extraction | SHA-256 run 1 vs run 2 | Multi-pass binary MOC3 extraction is 100% deterministic. | **PASS** |
| **AG1R2-7** | Real Naming Findings | Empirical file inspection | Character/outfit ID rule verified; `001=nrml`, `002=uniq`, `003=cmmn`, `004=uniq` documented. | **PASS** |
| **AG1R2-8** | Multi-Atlas Verification | Database & asset audit | `REAL_MULTI_ATLAS = NOT_OBSERVED` documented; single 4096x4096 atlas observed in real assets. | **PASS** |
| **AG1R2-9** | Asset Protection | Git tracking inspection | Zero copyrighted assets committed or staged in git (`.gitignore` enforced). | **PASS** |
| **AG1R2-10**| Synthetic Regressions | Tests 26–29 added | Discovered real-world conditions (HoloDori naming, outfit 002/003 styles, space paths, Korean Unicode paths) tested synthetically. | **PASS** |
| **AG1R2-11**| Scope Discipline | Architectural audit | Zero Phase 2/3 features added; pure acceptance and hardening. | **PASS** |

---

## Acceptance Gate: HDM.AGENT.2 — Character Library & Batch Manager

HDM.AGENT.2 elevates HoloDori Live2D Manager into a desktop character library and batch conversion manager.

### Mandatory Acceptance Gates (HDM.AGENT.2)

| Gate ID | Requirement | Verification Method | Pass Criteria | Status |
|---|---|---|---|---|
| **AG2-1** | Zero Regression | `cargo test --workspace` | All 28 existing unit and integration tests remain 100% green. | **PASS** (28/28 pass) |
| **AG2-2** | Character Grouping | Domain BTreeMap grouping | Assets grouped deterministically by 5-digit Character ID. | **PASS** (`test_character_grouping`) |
| **AG2-3** | Outfit Ordering | Sub-entity ordering | Outfits sorted strictly ascending by Outfit ID within character. | **PASS** (`test_outfit_ordering`) |
| **AG2-4** | Unknown Outfit Discovery | Parser & Library retainment | Unknown/future outfit numbers (e.g. `005`) are retained, not discarded. | **PASS** (`test_unknown_outfit`) |
| **AG2-5** | Search Functionality | Character, outfit, and style queries | Instant search matches across character ID, outfit ID, and style tokens. | **PASS** (domain filter + UI search) |
| **AG2-6** | Multi-Criteria Filtering | Status and Style filters | Filters for Buildable, Built, Warnings, Ambiguous, Failed, and Style tags. | **PASS** (domain filter + UI filters) |
| **AG2-7** | Multi-Select & Scoping | Selection management | Single outfit, character-wide select, and "Select All Valid" working. | **PASS** (UI selection state) |
| **AG2-8** | Batch Build Engine | Batch conversion execution | Reuses core PackageBuilder for arbitrary $N$ selected models. | **PASS** (`test_batch_partial_failure`) |
| **AG2-9** | Fault Isolation | Partial failure resilience | 1 model failure never aborts or corrupts unrelated models in batch. | **PASS** (`test_batch_partial_failure`) |
| **AG2-10**| Progress & Cancellation | Atomic boundary cancellation | Emits actual progress events; clean cancellation between model boundaries. | **PASS** (`test_batch_cancellation`) |
| **AG2-11**| Scan Metadata Cache | `LibraryScanCache` index | Warm rescans hit cache without re-reading files or hashing. | **PASS** (`test_cache_hit`, `test_cache_invalidation`) |
| **AG2-12**| Scalability Benchmark | 500-model synthetic dataset | 500 models across 50 characters scanned and organized in < 1 second. | **PASS** (`test_500_model_synthetic_library`) |
| **AG2-13**| Real Local Sample Smoke Test | `smoke_test_library` execution | 7 real models across 3 characters (`00007`, `00010`, `00012`) scanned & built. | **PASS** |
| **AG2-14**| Source Immutability | Pre/post SHA-256 integrity | All source files in input directory remain bit-for-bit unmutated. | **PASS** |
| **AG2-15**| Zero Copyrighted Assets | `git status` & `git ls-files` audit | Zero game assets or proprietary textures committed to repository. | **PASS** |


