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
  - Build status: `PASS`.
