# HoloDori Live2D Manager — Format Notes

Knowledge Classification Legend:
- **[VERIFIED]**: Confirmed by official specifications, format documentation, or direct binary/schema inspection.
- **[OBSERVED]**: Empirically observed in actual hololive Dreams / Unity resource dumps or test cases.
- **[INFERRED]**: Plausible deduction based on surrounding context, but not yet verified with multiple ground-truth samples.
- **[UNKNOWN]**: Open questions requiring additional real-world sample data or clarification.

---

## 1. Live2D Cubism model3.json Specification

### [VERIFIED] Official Cubism 3/4/5 Runtime Schema
- **Root Object**:
  - `Version`: Integer (typically `3`).
  - `FileReferences`:
    - `Moc`: String relative path to the `.moc3` file (e.g., `"12345_001.moc3"`).
    - `Textures`: Array of string relative paths to PNG texture atlas files (e.g., `["textures/texture_00.png"]`).
    - `Physics` (optional): String relative path to `.physics3.json`.
    - `Pose` (optional): String relative path to `.pose3.json`.
    - `DisplayInfo` (optional): String relative path to `.cdi3.json`.
    - `Expressions` (optional): Array of expression descriptor objects with `Name` and `File`.
    - `Motions` (optional): Key-value map of motion groups to motion arrays.
    - `UserData` (optional): String relative path to `.userdata3.json`.
  - `Groups` (optional): Array of parameter groups (e.g., EyeBlink, LipSync).
  - `HitAreas` (optional): Array of hit area definitions.

### [VERIFIED] Relative Path Constraint
- Cubism Native and Web runtimes resolve all `FileReferences` relative to the directory containing the `.model3.json` file.
- Absolute paths (such as `C:\...` or `/...`) break portability and must NEVER be emitted.
- Path traversal sequences (`../`) must be strictly prevented.

---

## 2. Binary MOC3 Header and Signatures

### [VERIFIED] Magic Bytes & Typed Version Classification
- Bytes `0..4`: ASCII characters `MOC3` (`0x4D`, `0x4F`, `0x43`, `0x33`).
- Byte `4`: Version indicator represented as typed `MocVersion`:
  - `MocVersion::Known(1)`: Cubism 3.0 / 3.2 (`V3.00`)
  - `MocVersion::Known(2)`: Cubism 3.3 (`V3.03`)
  - `MocVersion::Known(3)`: Cubism 4.0 / 4.1 (`V4.00`)
  - `MocVersion::Known(4)`: Cubism 4.2 (`V4.02`)
  - `MocVersion::Known(5)`: Cubism 5.0 (`V5.00`)
  - `MocVersion::Unknown(raw_byte)`: Syntactically valid candidate with unverified/future version identifier (e.g., `0x06`). Treated as candidate with warning; never claimed as officially supported without empirical runtime evidence.
  - `MocVersion::Invalid`: Missing magic, truncated header (<64 bytes), or invalid version (such as `0x00`).
- Subsequent bytes encode binary model canvas, count tables, and section offsets.

### [VERIFIED] Explicit Validation Levels
Validation is strictly partitioned into three independent tiers:
1. **Level 1 — Container Candidate**:
   - `MOC3` magic detection
   - Header availability (>= 64 bytes)
   - Recognized or unknown version byte
   - Sane non-zero payload size
   *(Note: Level 1 does NOT prove Cubism runtime compatibility).*
2. **Level 2 — Package Structural Validation**:
   - `model3.json` schema conformity (Version = 3)
   - MOC3 file existence and matching relative reference
   - All texture atlas existence and matching relative references
   - Strict containment within package directory (no path traversal escapes)
   - Package reopenable and verifiable by domain parser
   - Input source integrity (bit-for-bit SHA-256 match)
3. **Level 3 — Cubism Runtime Validation**:
   - Authoritative verification that the MOC3 and atlas textures initialize and render cleanly in an official or standard Cubism runtime/viewer (e.g. `csmHasMocConsistency()` or external Live2D viewer).
   - Explicitly tracked as `NOT_TESTED`, `PASS`, or `FAIL`.
   - Never silently converted from `NOT_TESTED` into `PASS`. Unverified runtime status generates `PASS_WITH_WARNINGS`.

---

## 3. Game Resource JSON Structure (`_bytes`)

### [OBSERVED] Unity Serialization of Binary Assets
- In extracted hololive Dreams / Unity resource JSON representations, raw binary blobs (such as compiled `.moc3` files) are serialized as JSON numeric arrays under the key `_bytes`.
- Structure example:
  ```json
  {
    "m_Name": "12345_001",
    "_bytes": [77, 79, 67, 51, 3, 0, 0, ...]
  }
  ```
- Sometimes the array may be nested under a sub-property:
  ```json
  {
    "data": {
      "modelBinary": {
        "_bytes": [77, 79, 67, 51, ...]
      }
    }
  }
  ```

### [VERIFIED] Byte Value Range
- Valid byte values must strictly satisfy `0 <= v <= 255`.
- Floating point values, negative integers, integers > 255, strings, or nulls are rejected as corrupt.

---

## 4. Naming Conventions & Identity

### [VERIFIED_ACROSS_SAMPLES] Character and Outfit Identifier Schema
- **Character Identifier**: First 5 digits (e.g., `00007`, `00010`, `00012`). Confirmed across independent character models.
- **Outfit Identifier**: Subsequent 3 digits (e.g., `001`, `002`, `003`, `004`).
- **Empirically Discovered Style Token Mapping**:
  - `001` -> `nrml` [VERIFIED_ACROSS_SAMPLES]: Confirmed on `00007_001` and `00010_001` paired with `t_live2d_*-nrml-*`.
  - `002` -> `uniq` [VERIFIED_ACROSS_SAMPLES]: Confirmed on `00007_002` and `00010_002` paired with `t_live2d_*-uniq-*`. (Contradicts initial legacy assumption of `002 -> cmmn`).
  - `003` -> `cmmn` [OBSERVED]: Confirmed on `00007_003` paired with `t_live2d_00007-cmmn-*`. (Contradicts initial legacy assumption of `003 -> uniq`).
  - `004` -> `uniq` [OBSERVED_ACROSS_SAMPLES]: Confirmed on `00010_004` and `00012_004` paired with `t_live2d_*-uniq-*`. Suffix corresponds to additional special/event attire, categorized under `uniq` rather than a dedicated "swimsuit" style tag.

### [IMPLEMENTED] Multi-Atlas Texture Capabilities
- Sequenced multi-atlas detection (`is_multi_atlas_set()`) is fully implemented and verified via synthetic tests.
- **[OBSERVED in Real Game]**: `REAL_MULTI_ATLAS = NOT_OBSERVED`. All inspected real HoloDori model sets package a single 4096x4096 texture atlas (`..._texture_00.png`).

### [UNKNOWN] Auxiliary Live2D Files
- Physics (`.physics3.json`), pose (`.pose3.json`), and display info (`.cdi3.json`):
  - Phase 1 & 1R focus strictly on core MOC3 + PNG texture matching and valid `.model3.json` construction.
  - Auxiliary files are deferred to future phases.

---

## 5. REAL SAMPLE EVIDENCE (HDM.AGENT.1R2)

Tested directly against extracted local assets from `hololive Dreams`:

### Sample 1: `00007_001` (Character 00007 / Outfit 001 / `nrml`)
- **Source JSON**: `00007_001.json` (14,002,464 bytes, SHA-256: `0881e65ce328a7cb66d8f9d10d77313c0797cd4371614686f38383cb1ac5972d`)
- **JSON Pointer**: `/_bytes` (1 candidate array)
- **Extracted MOC3**: 1,553,408 bytes (SHA-256: `7eab9201087f3ffb6bc05bbbfa2eb63d84e265c6980820353d872c89faa4ac3b`)
- **MOC Header**: Magic `MOC3`, Version `0x05` (`MocVersion::Known(5)` = Cubism 5.00)
- **Texture**: `t_live2d_00007-nrml-0008-00_texture_00.png` (3,191,677 bytes, 4096x4096 RGBA, SHA-256: `c668b25afef77ff9ba357f0cc646fcafae675ab570f4dbc7b07c53b38b83bdff`)
- **Matcher**: Exact character and style match (`score=70`, `MatchConfidence::High`)
- **Level 1**: PASS
- **Level 2**: PASS (All sub-stages A through J pass cleanly)
- **Source Integrity**: Bit-for-bit unchanged before and after conversion

### Sample 2: `00010_001` (Character 00010 / Outfit 001 / `nrml`)
- **Source JSON**: `00010_001.json` (17,402,908 bytes, SHA-256: `14861337c4e4e86adf4fb3b13e138463842f30d080d6b59ae17bc263148f18c7`)
- **JSON Pointer**: `/_bytes` (1 candidate array)
- **Extracted MOC3**: 1,932,928 bytes (SHA-256: `88cf2df92675ee341b9c5e4520c8b17d869b05cf5f6572f09c6428beb471879c`)
- **MOC Header**: Magic `MOC3`, Version `0x05` (`MocVersion::Known(5)` = Cubism 5.00)
- **Texture**: `t_live2d_00010-nrml-0010-00_texture_00.png` (5,696,049 bytes, 4096x4096 RGBA, SHA-256: `0d2bf152345dc128a5e1251928fdec774d60b5ec79eab5c62202375ec4091737`)
- **Matcher**: Exact character and style match (`score=70`, `MatchConfidence::High`)
- **Level 1**: PASS
- **Level 2**: PASS
- **Source Integrity**: Bit-for-bit unchanged

### Additional Samples Tested & Passing Level 2:
- `00010_004` (Character 00010, Outfit 004, `uniq`): Level 1 PASS, Level 2 PASS. (MOC3: 1,838,016 bytes, Cubism 5.00)
- `00007_002` (Character 00007, Outfit 002, `uniq`): Level 1 PASS, Level 2 PASS. (MOC3: 2,070,976 bytes, Cubism 5.00)
- `00007_003` (Character 00007, Outfit 003, `cmmn`): Level 1 PASS, Level 2 PASS. (MOC3: 2,372,736 bytes, Cubism 5.00)

---

## 6. REAL RUNTIME EVIDENCE (HDM.AGENT.1R2)

Tested and verified in the official **Live2D Cubism Viewer 5.3** (Cubism Editor ver5.3.04 [503040001]):

- **Runtime Engine**: Official Live2D Cubism Core `06.00.0513 (100663809)`
- **GPU Engine**: NVIDIA GeForce RTX 5090 (Driver 617.14) / OpenGL 4.6.0
- **Model 1 Verified (`00007_001`)**:
  - `model3.json` accepted: **YES**
  - MOC3 loaded: **YES** (Cubism Core confirmed startup & initialization complete)
  - Texture visible: **YES** (4096x4096 texture atlas bound)
  - Geometry & Mesh: **YES** (correct deformers and artmeshes parsed without errors)
  - Visual corruption: **NONE**
  - Runtime errors: **NONE**
- **Model 2 Verified (`00010_001`)**:
  - `model3.json` accepted: **YES**
  - MOC3 loaded: **YES**
  - Texture visible: **YES** (158 MB GPU texture allocated and bound)
  - Visual corruption: **NONE**
  - Runtime errors: **NONE**
- **Runtime Validation Status**: **PASS** (empirically confirmed in official Live2D Cubism runtime environment).
