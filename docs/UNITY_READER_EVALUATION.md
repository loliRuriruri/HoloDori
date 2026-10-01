# Unity Reader Candidate Evaluation: HDM.AGENT.3B

## 1. Objective

Evaluate candidate pure-Rust Unity readers (`unity-rs-core` vs `io_unity`) to extract `MonoBehaviour` (Cubism `.moc3` bytes) and `Texture2D` (atlas PNG) from unmasked HoloDori UnityFS asset bundles without calling external executables or Python scripts.

Target Unity version: `6000.3.15f1` (Unity 6).
Obfuscation: 256-byte rolling XOR mask keyed by asset name.

---

## 2. Evaluation Candidates

### Candidate A: `unity-rs-core = "0.5.2"`
- **Author/License**: Seiunx / MIT
- **Architecture**: Headless Unity asset parsing in pure Rust.
- **Built-in Capabilities**:
  - `UnityFsBundle`: block-based decompression (LZ4/LZMA/Brotli).
  - `SerializedFile`: supports format versions up to Unity 6 (format version 22).
  - `cubism_moc`: native `read_cubism_moc` / `CubismMoc` extraction.
  - `texture`: version-aware `Texture2D` layout reading and pixel decoding (RGBA32, DXT, ASTC, Crunch).
  - `image_export`: pure-Rust PNG, QOI, WebP encoders (`write_rgba_image`).
  - Strict resource and allocation bounds.

### Candidate B: `io_unity = "0.3.0"`
- **Author/License**: gameltb / MIT
- **Architecture**: Rust wrapper based on `binrw` for Unity asset structures.
- **Observations**:
  - Emits rustc future-incompatibility warnings on `binrw v0.10.0`.
  - Lacks built-in pure-Rust image encoder pipeline without external `image` crate.
  - Type-tree deserialization is generic but less specialized for bounded Live2D extraction.

---

## 3. Empirical Test Results

Tested with spike script `src-tauri/examples/spike_unity_readers.rs` against all 3 canonical HoloDori test assets:

| Sample Asset Name | Bundle Size | Extracted MOC3 Size | Extracted MOC3 SHA-256 | Reference Hash (AGENT.1R2) | Status | Extracted Texture |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `live2d_mdl_00007-nrml-0008-00` (`DCgZ7m`) | 3,265,045 B | 1,553,408 B | `7eab9201087f3ffb6bc05bbbfa2eb63d84e265c6980820353d872c89faa4ac3b` | `7eab9201087f3ffb6bc05bbbfa2eb63d84e265c6980820353d872c89faa4ac3b` | **EXACT MATCH** | 4096×4096 PNG (3.2 MB) |
| `live2d_mdl_00010-nrml-0010-00` (`LTdJTw`) | 4,977,814 B | 1,932,928 B | `88cf2df92675ee341b9c5e4520c8b17d869b05cf5f6572f09c6428beb471879c` | `88cf2df92675ee341b9c5e4520c8b17d869b05cf5f6572f09c6428beb471879c` | **EXACT MATCH** | 4096×4096 PNG (5.7 MB) |
| `live2d_mdl_00010-uniq-0069-00` (`Cfywj9`) | 4,084,627 B | 1,838,016 B | `7e950781c77d52bb73ddc18cdee46a47e5ee04ebcd91311e7bb1aa666040a2b1` | `7e950781c77d52bb73ddc18cdee46a47e5ee04ebcd91311e7bb1aa666040a2b1` | **EXACT MATCH** | 4096×4096 PNG (4.2 MB) |

### Key Discovery: Unity Version Override
HoloDori bundles carry stripped header revisions (`0.0.0`). Setting `unity_version_override = Some("6000.3.15f1".parse()?)` on `SerializedOpenOptions` enables `unity-rs-core` to resolve the version-dependent `Texture2D` layout and link with the external `.resS` stream seamlessly.

---

## 4. Final Selection

**Winner**: `unity-rs-core = "0.5.2"`.

Rationale:
1. 100% bit-for-bit identity against all reference MOC3 hashes.
2. Built-in, high-performance PNG encoding.
3. Clean compilation without future-incompatibility warnings.
4. Direct support for `BlockDecodeCache`, external `.resS` resources, and bounded memory allocation.
