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

---

## Acceptance Gate: HDM.AGENT.3B — Integrated HoloDori Importer

HDM.AGENT.3B integrates direct Steam game detection, master asset catalog (`octocacheevai`) parsing, raw bundle acquisition with caching, and pure-Rust UnityFS extraction into the HoloDori Live2D Manager desktop application.

### Mandatory Acceptance Gates (HDM.AGENT.3B)

| Gate ID | Requirement | Verification Method | Pass Criteria | Status |
|---|---|---|---|---|
| **AG3B-1** | Zero Regression | `cargo test --workspace` & `npm run build` | All 47 existing AGENT.1–3A tests remain 100% green; zero frontend/backend compiler errors. | **PASS** (59/59 total tests pass) |
| **AG3B-2** | Steam Installation Detection | Multi-strategy detector | Auto-detects Steam AppID 4282500 via Windows Registry, `libraryfolders.vdf`, default paths; provides manual folder validation fallback. | **PASS** (`test_steam_libraryfolders_vdf_parsing`, `test_steam_detection_synthetic_unicode_and_spaces`) |
| **AG3B-3** | Octocache Decryption & Parsing | Pure-Rust AES-128-CBC + Protobuf | Decrypts Revision 20 `octocacheevai`, extracts master catalog, filters to `live2d_mdl_*`, and parses Character/Style tokens. | **PASS** (`test_synthetic_octocache_roundtrip`, `test_importer_catalog_from_synthetic_octocache`) |
| **AG3B-4** | Bundle Acquisition & Integrity | Streaming HTTP + MD5 check | Downloads raw bundles from CDN template with streaming MD5 hashing and atomic `.part` replacement; rejects corrupted payloads. | **PASS** (`test_corrupted_md5`, `test_hash_mask_and_bundle_deobfuscation`) |
| **AG3B-5** | Local Cache Management | `%LOCALAPPDATA%` bundle cache | Stores raw bundles, skips redownloading verified cached bundles, supports cache clearing and disk usage inspection. | **PASS** (`test_importer_cache_management`) |
| **AG3B-6** | Pure-Rust UnityFS & Asset Extraction | `unity-rs-core` (Unity 6000.3.15f1) | Deobfuscates 256-byte rolling XOR header, decompresses UnityFS blocks, extracts `MonoBehaviour` MOC3 bytes (100% bit-for-bit SHA-256 match) and decodes `Texture2D` atlas RGBA32 into PNG. | **PASS** (`test_real_bundle_extraction_if_cached`) |
| **AG3B-7** | Pipeline Integration & Package Generation | Coordinator to `ConversionPipeline` | Feeds extracted MOC3 and textures into existing PackageBuilder, generating standard Cubism runtime packages (`.model3.json`, `.moc3`, `textures/texture_00.png`) with Level 1 and Level 2 validation. | **PASS** (`test_importer_coordinator_end_to_end_if_cached`) |
| **AG3B-8** | Fault Isolation & Cancellation | Partial failure & cancellation handling | Network/extraction failure on model $N$ does not corrupt or abort model $N+1$; cancellation cleanly halts at model boundary. | **PASS** (Atomic cancellation token, per-model error catching in `ImporterCoordinator`) |
| **AG3B-9** | Complete User Interface | Source Mode navigation & Importer UI | Provides Source Mode toggle ("Local Resource Files" vs "HoloDori Installation"), Steam install status banner, catalog table with search/filters, bundle cache management, live progress modal, and post-import Library switch. | **PASS** (`ImporterView.tsx`, verified with `npm run build`) |
| **AG3B-10**| Safe Read-Only Operation & Clean Repo | Repository & process audit | Zero writes or modifications to Steam game files; zero proprietary game bundles or assets committed to git. | **PASS** (`git status` audit) |

---

## Acceptance Gate: HDM.AGENT.3B-R — Final Product Acceptance

HDM.AGENT.3B-R closes the final end-to-end acceptance evidence for the integrated HoloDori source importer. It verifies cold CDN acquisition, local cache persistence, bit-for-bit MOC3 identity against AGENT.1R2, official Live2D Cubism Viewer 5.3 runtime rendering, production cancellation, deterministic HTTP failure regressions, dynamic Unity version override provenance, third-party licensing, and batch performance.

### Mandatory Acceptance Gates (HDM.AGENT.3B-R)

| Gate ID | Requirement | Verification Method | Pass Criteria | Status |
|---|---|---|---|---|
| **AG3BR-1** | Baseline & Regression Suite | `cargo test --workspace` | All 72 automated unit and integration tests pass without failure (13 lib + 16 importer integration + 15 library batch + 28 pipeline integration). | **PASS** (72/72 tests green) |
| **AG3BR-2** | Mandatory Cold CDN Import | `validate_agent3b_r` runner | Enforces cold cache state (targets deleted prior to run); acquires real bundles via CDN for `00007_001` (`DCgZ7m`), `00010_001` (`LTdJTw`), and `00010_004` (`Cfywj9`); verifies HTTP 200, byte length, MD5, and atomic `.part` replacement upon publication. | **PASS** (3/3 models cold acquired and published) |
| **AG3BR-3** | Bit-for-bit MOC3 Identity | SHA-256 comparison against AGENT.1R2 | Extracted `.moc3` files match known AGENT.1R2 SHA-256 hashes bit-for-bit:<br>• `00007_001`: `7eab9201087f3ffb6bc05bbbfa2eb63d84e265c6980820353d872c89faa4ac3b`<br>• `00010_001`: `88cf2df92675ee341b9c5e4520c8b17d869b05cf5f6572f09c6428beb471879c`<br>• `00010_004`: `7e950781c77d52bb73ddc18cdee46a47e5ee04ebcd91311e7bb1aa666040a2b1` | **PASS** (100% bit-for-bit match) |
| **AG3BR-4** | Warm Cache Verification | Second import execution | Re-running import reuses local bundle cache, completely skips network requests, and produces identical SHA-256 output. | **PASS** (Zero network dependency, identical hashes) |
| **AG3BR-5** | Official Live2D Runtime Acceptance | Live2D Cubism Viewer 5.3 (`CubismViewer5.bat`) | Generated packages loaded into official Cubism Viewer 5.3. Log verification in `log_viewer.txt` confirms Cubism Core 06.00.0513 runtime acceptance, mesh deformation, and texture binding without errors for `00007_001` and `00010_001`. | **PASS** (Cubism Viewer 5.3 runtime verified) |
| **AG3BR-6** | Production Cancellation | Token-triggered abort | Cancelling import halts acquisition cleanly at model boundary, cleans up partial files, and reports `cancelled: true` without corrupting state. | **PASS** (`validate_agent3b_r` cancellation gate verified) |
| **AG3BR-7** | HTTP Failure Regressions | Deterministic local mock server | 10 integration test scenarios verifying handling of HTTP 200, HTTP 404, timeouts, connection drops, truncated bodies, Content-Length mismatches, size mismatches, MD5 mismatches, cancellation, and cache hit/miss/invalidation. | **PASS** (10/10 mock tests green) |
| **AG3BR-8** | Unity Version Provenance | `importer::unity` module | Isolate `DEFAULT_UNITY_VERSION_OVERRIDE = "6000.3.15f1"`, document origin in `UnityPlayer.dll` (ProductVersion `6000.3.15f1 (c1aa84e375f6)`), dynamically resolve with fallback, and log diagnostic info. | **PASS** (`test_unity_version_override_resolution`) |
---

## Acceptance Gate: HDM.AGENT.4A — Embedded Live2D Viewer Foundation

HDM.AGENT.4A implements an embedded real-time WebGL Live2D viewer inside the HoloDori Live2D Manager desktop application using the Live2D Cubism 5 Web SDK.

### Mandatory Acceptance Gates (HDM.AGENT.4A)

| Gate ID | Requirement | Verification Method | Pass Criteria | Status |
|---|---|---|---|---|
| **AG4A-1** | Baseline & Zero Regression | `cargo test --workspace` & `npm run build` | All 73 backend unit/integration tests pass; frontend compiles with 0 errors via `tsc` and `vite build`. | **PASS** (73/73 cargo tests green; 0 build errors) |
| **AG4A-2** | Cubism SDK Web Integration | Framework & Shader pipeline | Live2D Cubism 5 Web Framework and 13 WebGL shaders integrated into `src/viewer/cubism/framework/` and `public/shaders/` under Live2D Open Software License. | **PASS** (`docs/CUBISM_SDK_INTEGRATION.md`) |
| **AG4A-3** | Proprietary License Compliance | Git audit & Graceful degradation | `live2dcubismcore.min.js` strictly gitignored; if missing, app launches normally and displays informative diagnostic card rather than crashing. | **PASS** (`.gitignore` audit, Core availability check) |
| **AG4A-4** | Sandboxed File Bridge | `read_package_file` Tauri IPC | Backend enforces canonical path prefix containment against directory traversal (`../`). | **PASS** (`test_read_package_file_success_and_traversal`) |
| **AG4A-5** | Real Model Runtime Acceptance | Headless Edge browser runner (`scripts/test_viewer_runtime.mjs`) | Verified on real packages:<br>• `00007_001`: 131 parameters extracted, size 1x1.5, live slider modification verified.<br>• `00010_001`: 162 parameters extracted. | **PASS** (Edge headless WebGL acceptance test) |
| **AG4A-6** | Viewport & Camera Controls | Aspect & transform math tests | Aspect-preserving letterbox scaling, drag pan, wheel zoom (0.2x to 8.0x), Fit, and Reset verified. | **PASS** (`tests/viewer_unit.test.mjs`) |
| **AG4A-7** | Parameter Inspector | Live parameter controls & reset | Parameters categorized into Angle, Eye, Eyebrow, Mouth, Body, Hair, Other; live sliders with default restore (`↺`) and "Reset All". | **PASS** (`tests/viewer_unit.test.mjs`, `ViewerControls.tsx`) |
| **AG4A-8** | Procedural Idle Animations | `CubismBreath` & `CubismEyeBlink` | Auto-detects model parameter IDs and applies breathing and eye blink oscillation; user overrides take priority. | **PASS** (`model.ts`, verified in runtime test) |
| **AG4A-9** | 20-Cycle Repeated Load/Unload Stress Test | Automated alternating loop | 20 sequential cycles alternating between `00007_001` and `00010_001` with complete texture/buffer disposal and zero leaks. | **PASS** (20/20 cycles complete) |
| **AG4A-10**| Clean Repository & Zero Game Assets | Git audit (`git status`, `git ls-files`) | Zero game assets, zero `.moc3`/`.png` samples, and zero proprietary Core binaries committed to git. | **PASS** (Strict `.gitignore` enforcement) |

---

## Acceptance Gate: HDM.AGENT.4B — HoloDori Motion & Expression Integration

HDM.AGENT.4B integrates authentic HoloDori motions and expressions into the embedded Live2D viewer.

### Mandatory Acceptance Gates (HDM.AGENT.4B)

| Gate ID | Requirement | Verification Method | Pass Criteria | Status |
|---|---|---|---|---|
| **AG4B-1** | Baseline Preservation | `cargo test --workspace` & `npm test` | All 76 Rust tests pass, unit and browser runtime tests pass. | **PASS** (76 Rust / 7 JS unit / 6 runtime) |
| **AG4B-2** | Motion & Expression Catalog Discovery | `ImporterCoordinator` & `CatalogLoader` | Discovers all 202 universal motions and character-scoped expressions directly from octocache metadata. | **PASS** (`get_model_animations` IPC) |
| **AG4B-3** | Binary Animation Extraction | `UnityExtractor` | Converts `AnimationClip` (StreamedClip) and `CubismExpressionData` MonoBehaviours into standard Cubism 3/4 `.motion3.json` and `.exp3.json`. | **PASS** (`test_extract_real_expression_and_motion_if_cached`) |
| **AG4B-4** | Real Motion Playback | Headless Edge browser test | Real HoloDori motion reproduces duration, curve interpolation, and parameter mutation over time. | **PASS** (`scripts/test_viewer_runtime.mjs` Test Case 4) |
| **AG4B-5** | Real Expression Application | Headless Edge browser test | Real expressions apply additive/overwrite morphs and restore clean neutral baseline upon clear. | **PASS** (`scripts/test_viewer_runtime.mjs` Test Case 5) |
| **AG4B-6** | Concurrent Layering | Headless Edge browser test | Motion + Expression + Procedural Idle run concurrently with clean layer precedence. | **PASS** (`scripts/test_viewer_runtime.mjs` Test Case 6) |

---

## Acceptance Gate: HDM.AGENT.4C — Character Player, Physics & Viewer Productization

HDM.AGENT.4C productizes the viewer into a practical Character Player, integrates authentic Live2D physics from HoloDori bundles, enables continuous in-viewer switching, auto-motion, favorites, and settings persistence.

### Mandatory Acceptance Gates (HDM.AGENT.4C)

| Gate ID | Requirement | Verification Method | Pass Criteria | Status |
|---|---|---|---|---|
| **AG4C-1** | Baseline & Zero Regression | `cargo test --workspace`, `npm test`, `npm run build` | All 76 Rust tests pass, all 11 frontend unit tests pass, all 9 browser runtime tests pass, 0 TS build errors. | **PASS** (76 Rust / 11 JS unit / 9 runtime) |
| **AG4C-2** | Authentic Physics Audit & Extraction | `UnityExtractor::parse_physics_rig` | Audit verdict: **VERIFIED**. `live2d_mdl_*` bundles contain `CubismPhysicsController` MonoBehaviour; parsed and written as `<model>.physics3.json` into package. | **PASS** (`test_extract_real_physics_if_cached`, 72 subrigs verified) |
| **AG4C-3** | Evaluation Precedence Hierarchy | Live2DModelWrapper pipeline | Base -> Motion -> Expression -> EyeBlink -> Breath -> Physics -> UserOverrides -> model.update. Secondary hair/clothing physics reacts dynamically to head/body motion. | **PASS** (`tests/viewer_unit.test.mjs`, runtime Test Case 8) |
| **AG4C-4** | In-Viewer Character & Outfit Switching | Headless Edge browser test | Characters and outfits switch directly within the player on the same WebGL canvas and renderer without context loss or memory leaks. | **PASS** (`scripts/test_viewer_runtime.mjs` Test Case 7) |
| **AG4C-5** | Auto-Motion & Non-Repeating Random Motion | Playback controller | Auto-motion timer schedules random motion upon idle; repeat prevention algorithm avoids back-to-back duplicate motions when candidates > 1. | **PASS** (`tests/viewer_unit.test.mjs`, `ViewerPage.tsx`) |
| **AG4C-6** | Persistent Settings & Favorites | Tauri IPC & localStorage | Settings (mode, background, toggles, delay), favorites (characters, outfits, motions, expressions), and recent models (capped at 10) persisted. | **PASS** (`tests/viewer_unit.test.mjs`, runtime Test Case 9) |
| **AG4C-7** | Dual Mode Character Player UI | `ViewerControls.tsx` | Clean default Player mode (character, outfit, motion, expression, timeline, auto-motion, fit, fullscreen) with technical sliders organized under Advanced tab. | **PASS** (UI layout verified, 0 TypeScript errors) |
| **AG4C-8** | Git & Boundary Safety | Repository audit | Zero proprietary Cubism Core binaries, game bundles, or sample models committed to git. | **PASS** (Strict `.gitignore` enforcement) |

---

## Acceptance Gate: HDM.AGENT.5A — Desktop Character Window

HDM.AGENT.5A delivers the Desktop Character Window: a dedicated, transparent, frameless Windows desktop companion mode for HoloDori Live2D models with dual Edit/Lock modes, OS click-through, multi-monitor clamping, System Tray integration, and remote control IPC.

### Mandatory Acceptance Gates (HDM.AGENT.5A)

| Gate ID | Requirement | Verification Method | Pass Criteria | Status |
|---|---|---|---|---|
| **AG5A-1** | Baseline & Zero Regression | `cargo test --workspace`, `npm test`, `npm run build`, `cargo clippy` | All 79 Rust tests pass, all 15 frontend unit tests pass, all 12 browser runtime acceptance tests pass, 0 clippy warnings, 0 TS build errors. | **PASS** (79 Rust / 15 JS unit / 12 runtime / 0 warnings) |
| **AG5A-2** | Dedicated Transparent Desktop Window | Tauri window architecture & CSS | Dedicated `desktop_character` window initialized with `transparent: true, decorations: false, shadow: false`; `.desktop-mode` transparency rules on HTML/body; transparent WebGL canvas. | **PASS** (`commands/desktop.rs`, `App.css`, runtime Test Case 12) |
| **AG5A-3** | Dual Operation Modes (Edit vs. Lock) | `DesktopCharacterWindow.tsx` | Edit Mode: drag region, scale controls (25% to 300%), 30/60 FPS toggle, always on top toggle, click-through toggle, lock button. Lock Mode: zero chrome, floating character. | **PASS** (`DesktopCharacterWindow.tsx`, `tests/viewer_unit.test.mjs`) |
| **AG5A-4** | OS-Level Click-Through & Recovery | Windows cursor event management | Click-through passes mouse events directly to background applications; emergency toggle via `Ctrl + Shift + D` or System Tray guarantees instant recovery. | **PASS** (`commands/desktop.rs`, `lib.rs`, `DesktopCharacterWindow.tsx`) |
| **AG5A-5** | Multi-Monitor Discovery & Clamping | Coordinate bounds validator | Clamps window position so it never restores off-screen; falls back safely to primary monitor bottom-right if coordinates are invalid. | **PASS** (`commands::desktop::tests`, `tests/viewer_unit.test.mjs`) |
| **AG5A-6** | Performance Throttling & Pause | `ViewerRenderer.ts` animation loop | Target framerate throttling (30 FPS vs 60 FPS) and pause state verified in WebGL rendering loop. | **PASS** (`renderer.ts`, runtime Test Case 10) |
| **AG5A-7** | Bidirectional Remote Control IPC | Tauri IPC & event bridge | Main Character Player displays "Desktop Active" badge with remote controls (`send_desktop_control`, `desktop-action`, `switch-model`). | **PASS** (`ViewerControls.tsx`, `ViewerPage.tsx`, `commands/desktop.rs`) |
| **AG5A-8** | 20-Cycle Lifecycle Stress Test | Headless browser stress test | 20 sequential model switch/load/unload cycles run cleanly on transparent canvas without WebGL resource leaks or crashes. | **PASS** (`scripts/test_viewer_runtime.mjs` Test Case 11) |
| **AG5A-9** | Strict WorkerW Wallpaper Boundary | Architecture audit | Zero WorkerW / Progman / SetParent / wallpaper injection code committed in Phase 5A (strictly reserved for Phase 5B). | **PASS** (Architectural boundary preserved) |
| **AG5A-10**| Git & Binary Safety | Repository audit | Zero proprietary Cubism Core binaries, game bundles, or sample models committed to git. | **PASS** (Strict `.gitignore` enforcement) |

---

## Acceptance Gate: HDM.AGENT.5B — True Windows Wallpaper Mode

HDM.AGENT.5B delivers True Windows Wallpaper Mode: native Win32 window hosting behind desktop icons via `WorkerW` and `Progman` reparenting, with dynamic topology discovery, watchdog crash recovery, zero desktop icon impact, and infallible Desktop Overlay fallback.

### Mandatory Acceptance Gates (HDM.AGENT.5B)

| Gate ID | Requirement | Verification Method | Pass Criteria | Status |
|---|---|---|---|---|
| **AG5B-1** | Baseline Preservation & Zero Regression | `cargo test --workspace`, `npm test`, `npm run build` | All 84 Rust tests pass, all 17 JS unit tests pass, all 14 browser runtime acceptance tests pass, 0 TS build errors. | **PASS** (84 Rust / 17 JS unit / 14 runtime) |
| **AG5B-2** | Windows Shell Compatibility Spike | Native Win32 desktop audit | Recorded OS edition, version, build, Explorer version; audited Progman, WorkerW, and SHELLDLL_DefView pre/post 0x052C. Documented in `docs/WINDOWS_WALLPAPER_HOST_AUDIT.md`. | **PASS** (`docs/WINDOWS_WALLPAPER_HOST_AUDIT.md`) |
| **AG5B-3** | Dynamic Shell Topology Discovery | `desktop/wallpaper/shell.rs` | Auto-detects Modern Windows 11 child WorkerW, Legacy Windows 10 sibling WorkerW, and Progman direct hosting. | **PASS** (`desktop::wallpaper::shell`) |
| **AG5B-4** | Native Win32 Wallpaper Hosting | `desktop/wallpaper/host.rs` | `SetParent` reparenting with `WS_CHILD`, `WS_CLIPSIBLINGS`, `WS_EX_TRANSPARENT`. Clean detachment restores original styles and parent on exit. | **PASS** (`desktop::wallpaper::workerw`, `desktop::wallpaper::progman`) |
| **AG5B-5** | Desktop Overlay Fallback Invariant | `desktop/wallpaper/host.rs` | Infallible fallback to AGENT.5A Desktop Overlay if Explorer host is unsupported or fails. Never claims wallpaper is active in fallback mode. | **PASS** (`test_fallback_overlay_never_claims_wallpaper_active`) |
| **AG5B-6** | Desktop Icon & Shell Safety Invariant | Architecture & runtime review | `SHELLDLL_DefView` is NEVER reparented or hidden; desktop icons remain 100% clickable; `explorer.exe` is never terminated. | **PASS** (Zero shell disruption verified) |
| **AG5B-7** | Host Recovery Watchdog | `desktop/wallpaper/recovery.rs` | Background watchdog polls host HWND validity every 2.5s; auto-recovers upon Explorer restart or transitions safely to overlay fallback. | **PASS** (`WallpaperWatchdog`, IPC events) |
| **AG5B-8** | Real-Time Mode Switching | `DesktopCharacterWindow.tsx` & System Tray | Real-time seamless toggle between True Wallpaper and Desktop Overlay on the same WebGL canvas without context loss. | **PASS** (`scripts/test_viewer_runtime.mjs` Test Case 14) |
| **AG5B-9** | Settings Persistence & Migration | `types.ts`, `settings.ts` | Wallpaper settings (`preference`, `fallbackEnabled`, `autoRecover`, `targetFps`) cleanly merged and migrated from legacy state. | **PASS** (`tests/viewer_unit.test.mjs`) |
| **AG5B-10**| Git & Binary Safety | Repository audit | Zero proprietary Cubism Core binaries, game bundles, or copyrighted assets committed to git. | **PASS** (Strict `.gitignore` enforcement) |







