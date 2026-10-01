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

### [VERIFIED] Magic Bytes
- Bytes `0..4`: ASCII characters `MOC3` (`0x4D`, 0x4F, 0x43, 0x33).
- Byte `4`: Version indicator:
  - `0x03` = Cubism 3.0 / 3.2
  - `0x04` = Cubism 3.3 / 4.0 / 4.1
  - `0x05` = Cubism 4.2 / 5.0
- Subsequent bytes encode binary model canvas, count tables, and section offsets.

### [VERIFIED] Validation Boundary
- HoloDori Live2D Manager validates:
  1. Payload has at least 64 bytes (minimum plausible MOC3 header structure).
  2. Byte `0..4` matches `MOC3` magic.
  3. Byte `4` is within known valid version range (`0x01..=0x06`).
- HoloDori Live2D Manager does NOT reverse-engineer or re-encode internal MOC3 byte offsets (that responsibility belongs to Live2DRecovery).

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

### [UNKNOWN] Multi-Atlas and Additional Assets
- Will some future models use multiple texture atlases (`texture_00.png`, `texture_01.png`)?
  - Engine design accommodates `Vec<PathBuf>` for textures.
- Are physics definitions stored inside separate JSON files in the same directory?
  - Phase 1 focuses exclusively on MOC3 + PNG texture matching.
