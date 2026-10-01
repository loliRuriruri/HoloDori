# Live2D Cubism SDK Web Integration Guide

This document defines the integration architecture, license boundaries, and operational pipeline for the Live2D Cubism 5 Web SDK in HoloDori Live2D Manager.

---

## 1. SDK Provenance & Version Details

| Component | Exact Version / Commit | License | Distribution Policy |
| :--- | :--- | :--- | :--- |
| **SDK Package** | Cubism 5 SDK for Web R5 (`5-r.5`, 2026-04-02) | Composite | Developer local (`vendor/live2d-local/`) |
| **Cubism Framework** | `5-r.5` (Git commit `a49bc546...`) | Live2D Open Software License | Committed (`src/viewer/cubism/framework/`) |
| **WebGL Shaders** | Live2D WebGL Shaders (13 files) | Live2D Open Software License | Committed (`public/shaders/`) |
| **Cubism Core** | `06.00.0001` (Git commit `d96fa37f...`) | Live2D Proprietary Software License | **STRICTLY GITIGNORED** (`public/live2d/`) |

### Acquisition Source
- Download URL: `https://cubism.live2d.com/sdk-web/bin/CubismSdkForWeb-5-r.5.zip`
- Archive Size: 20,707,311 bytes
- Archive SHA256: Verified against official Live2D distribution

---

## 2. Licensing Boundary & Git Safety Rules

### Rule 1: Zero Proprietary Binaries in Git
The core binary `live2dcubismcore.min.js` and `live2dcubismcore.js` are proprietary software belonging to Live2D Inc.
- They must **never** be committed to Git.
- Enforced via `.gitignore`:
  ```gitignore
  # Proprietary Vendor SDKs & Cubism Core (Never committed)
  vendor/
  vendor/live2d-local/
  public/live2d/
  public/live2dcubismcore*.js
  ```
- Any developer or user deploying HDM places `live2dcubismcore.min.js` in `public/live2d/`.

### Rule 2: Open Source Framework
The TypeScript framework code in `Framework/src/` is explicitly licensed under the **Live2D Open Software License Agreement**, which allows modification and distribution alongside user applications.
- Compiled as clean ES6 modules into `src/viewer/cubism/framework/`.
- Type declarations in `src/types/live2dcubismcore.d.ts` enable strict TypeScript compilation without requiring the proprietary runtime JS binary during build time.

### Rule 3: Graceful Degradation
If `live2dcubismcore.min.js` is absent:
- The Tauri desktop application launches normally.
- The Character Library and Game Importer work without limitation.
- Opening the Live2D viewer displays a graceful diagnostic dialog explaining the missing binary and instructions for placement, rather than a crash.

---

## 3. Sandboxed Asset Security

The Webview runtime is isolated from the host file system:
- **Tauri IPC Command**: `read_package_file(package_dir: String, relative_path: String) -> Result<Vec<u8>, String>`
- **Path Traversal Protection**: Enforces canonical path prefix validation to prevent directory traversal (`../`).
- **Memory Safety**: Textures are loaded into WebGL via ephemeral object URLs (`URL.createObjectURL`), and all URLs are immediately revoked via `URL.revokeObjectURL` upon model unload.

---

## 4. Verification & Testing

The integration is verified by automated test suites:
- `npm test`: Runs unit tests (`tests/viewer_unit.test.mjs`) and headless Edge browser integration (`scripts/test_viewer_runtime.mjs`).
- `cargo test --workspace`: Validates Tauri backend security and IPC handlers (73 PASS).
- 20-cycle repeated load/unload test confirms zero resource accumulation or WebGL context leaks.
