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

### [OBSERVED] Character and Outfit Identifier Schema
- **Character Identifier**: First 5 digits (e.g., `12345`).
- **Outfit Identifier**: Subsequent 3 digits (e.g., `001`).
- **Common Suffix Style Tokens**:
  - `001` -> `nrml` (Normal / default outfit)
  - `002` -> `cmmn` (Common / casual outfit)
  - `003` -> `uniq` (Unique / special outfit)

### [INFERRED] Outfit `004`
- Outfit `004` has been reported colloquially as a swimsuit/seasonal outfit.
- Style token mapping for `004` is NOT yet verified across multiple characters.
- Engine policy: Do not hard-code an assumed tag for `004`. If encountered, record identity `CharacterId=..., OutfitId=004, StyleTag=None/Unknown` and rely on stem/proximity matching.

### [VERIFIED] Multi-Atlas Texture Sets
- Models may utilize sequenced texture atlas sets (e.g., `texture_12345_001_00.png`, `texture_12345_001_01.png` or `texture_00.png`, `texture_01.png`).
- Sequenced multi-atlas sets are matched deterministically in ascending numerical order (`is_multi_atlas_set()`), rather than being falsely rejected as duplicate collisions.
- Un-sequenced identical duplicate candidates remain strictly rejected under the duplicate collision guard.

### [UNKNOWN] Auxiliary Live2D Files
- Physics (`.physics3.json`), pose (`.pose3.json`), and display info (`.cdi3.json`):
  - Phase 1 & 1R focus strictly on core MOC3 + PNG texture matching and valid `.model3.json` construction.
  - Auxiliary files are deferred to future phases.

---

## 5. Real HoloDori Sample Observations & Environment State

### [OBSERVED] Game Asset Packaging
- HoloDori game installation was verified at default Steam path:
  `E:\SteamLibrary\steamapps\common\hololiveDreams\hololive-Dreams_Data`
- The game packages Live2D data inside Unity asset bundles and Octo cache hierarchies.
- The pipeline processes loose extracted files non-destructively without modifying originals.
- All real game assets are strictly excluded from git tracking via root `.gitignore` (`samples/`, `real_samples/`, `local_samples/`, `output/`, `*.moc3`).

### [STATUS] AGENT.1R Runtime Rendering
- Level 1 (Container Candidate) and Level 2 (Package Structural Validation) are 100% automated and passing in the pure-Rust test suite.
- Level 3 (Cubism Runtime Validation) is explicitly reported as `NOT_TESTED` when external Live2D rendering has not been executed, producing `PASS_WITH_WARNINGS` to avoid false claims of runtime compatibility.
- Once manual or automated Live2D viewer validation is confirmed for a package, Level 3 transitions to `PASS`.
