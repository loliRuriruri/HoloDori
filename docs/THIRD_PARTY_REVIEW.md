# HoloDori Live2D Manager — Third Party Review & Licensing Audit

## External Project Review Policy

To protect intellectual property, prevent license contamination, and ensure safe distribution, this project enforces a clean-room implementation policy.
No third-party repository code may be copy-pasted or adapted without an explicit permissive license audit.

---

## Referenced Projects Registry

### 1. `CyleAR/hololive-toolkit`
- **Project**: hololive-toolkit
- **URL**: `https://github.com/CyleAR/hololive-toolkit`
- **Author**: CyleAR
- **Purpose**: Community toolkit exploring resource extraction and file naming conventions for hololive Dreams.
- **License**: Unspecified / Proprietary Default (Public repository without explicit open source license).
- **Code Copied?**: **NO** (0 lines of code copied).
- **Algorithm Copied?**: **NO** (No Python or third-party code adapted).
- **Behavioral Reference Only?**: **YES**. Used solely to understand:
  1. The presence of serialized `_bytes` arrays in Unity JSON dumps.
  2. The character (5-digit) and outfit (3-digit) naming structure.
  3. Style tokens (`nrml`, `cmmn`, `uniq`).
- **Notes**: All file discovery, JSON stream parsing, byte extraction, validation, matching logic, and manifest generation are independently authored from first principles in Rust.

---

## Built-in Runtime Dependencies Policy

All application dependencies are audited permissive open-source packages:
- **Rust Domain & Backend**:
  - `tauri` (Apache-2.0 / MIT)
  - `serde`, `serde_json` (Apache-2.0 / MIT)
  - `thiserror` (Apache-2.0 / MIT)
  - `tracing`, `tracing-subscriber` (MIT)
  - `regex` (Apache-2.0 / MIT)
  - `sha2` (Apache-2.0 / MIT)
  - `tempfile` (Apache-2.0 / MIT)
  - `walkdir` (Apache-2.0 / MIT / Unlicense)
- **Frontend**:
  - `react`, `react-dom` (MIT)
  - `vite` (MIT)
  - `typescript` (Apache-2.0)
  - `@tauri-apps/api` (Apache-2.0 / MIT)
