# Feature Support Matrix

This document provides a factual matrix of implemented, planned, and intentionally excluded features in **HoloDori Live2D Manager (HDM)**.

---

## 1. Core Conversion & Importer

| Feature | Status | Notes |
|---|:---:|---|
| **Steam Installation Auto-Detection** | ✅ Supported | Automatically parses `libraryfolders.vdf` across multiple drives. |
| **Octocache AES-128-CBC Decryption** | ✅ Supported | In-memory decryption of `octocacheevai` binary header and index. |
| **Character & Outfit Catalog Indexing** | ✅ Supported | Catalogs all `live2d_mdl_*`, `live2d_mot_*`, and `live2d_exp_*` bundles. |
| **Bundle Acquisition & Integrity Check** | ✅ Supported | Strict size + MD5 verification with atomic swap caching. |
| **UnityFS Archive Unpacking** | ✅ Supported | Extracts raw MOC3 and Texture2D streams via `unity-rs-core`. |
| **MOC3 Geometry Extraction** | ✅ Supported | Generates valid, uncorrupted Cubism `.moc3` files. |
| **Texture2D Atlas Extraction** | ✅ Supported | Extracts 4096x4096 lossless RGBA PNG atlas files. |
| **Authentic Physics Extraction** | ✅ Supported | Reconstructs Cubism `physics3.json` with input/output pendulum rigs. |
| **Cubism 3 Manifest Generation** | ✅ Supported | Standardized `model3.json` compliant with official Live2D runtimes. |
| **Directory Traversal Protection** | ✅ Supported | Rejects paths containing `../` or absolute roots. |
| **Batch Importer** | ✅ Supported | Multi-threaded conversion of all characters and outfits. |

---

## 2. Viewer & Presentation

| Feature | Status | Notes |
|---|:---:|---|
| **Embedded WebGL Viewer** | ✅ Supported | Full WebGL hardware-accelerated canvas with alpha transparency. |
| **Official Cubism Web SDK Integration** | ✅ Supported | Integrates with official Live2D Cubism Core and Web Framework. |
| **Authentic Game Motion Playback** | ✅ Supported | Plays genuine in-game HoloDori motions with smooth curve transitions. |
| **Expression Overlay & Blending** | ✅ Supported | Facial expressions layer on top of active body motions with neutral reset. |
| **Authentic Physics Simulation** | ✅ Supported | Evaluates hair, ribbon, and skirt pendulum physics in real time. |
| **Procedural Eye Blink & Breathing** | ✅ Supported | Natural idle behavior blended with motion playback. |
| **Camera Pan, Zoom & Fit** | ✅ Supported | Smooth panning, mouse-wheel zoom (0.2x–8.0x), and auto letterboxing. |
| **Live Parameter Inspector** | ✅ Supported | Real-time sliders with manual override capability for all model parameters. |
| **Random & Auto Motion** | ✅ Supported | Configurable timer interval with non-repeating shuffle queue. |
| **Favorites & Recent Models** | ✅ Supported | Fast access list persisted in local configuration. |

---

## 3. Desktop Mascot & Wallpaper Mode

| Feature | Status | Notes |
|---|:---:|---|
| **Transparent Frameless Desktop Window** | ✅ Supported | Dedicated borderless secondary window with alpha transparency. |
| **Always-on-Top Toggle** | ✅ Supported | Floats above active windows or docks to desktop level. |
| **OS-Level Click-Through** | ✅ Supported | `WS_EX_TRANSPARENT` allows mouse clicks to pass through to underlying apps. |
| **Emergency Click-Through Shortcut** | ✅ Supported | `Ctrl + Shift + D` restores controls instantly. |
| **Multi-Monitor Boundary Clamping** | ✅ Supported | Clamps window position to prevent off-screen loss when monitors disconnect. |
| **True Windows Wallpaper (WorkerW)** | ✅ Supported | Reparents into `WorkerW` behind desktop icons on Windows 10 & 11. |
| **Desktop Icon Preservation** | ✅ Supported | `SHELLDLL_DefView` is never reparented or hidden; icons remain 100% responsive. |
| **Explorer Crash Recovery Watchdog** | ✅ Supported | Polls host validity every 2.5s; auto-recovers within 2.5s of Explorer restart. |
| **Progman Compatibility Mode** | ✅ Supported | Fallback host for customized or legacy shell environments. |
| **Desktop Overlay Fallback** | ✅ Supported | Infallible fallback if shell reparenting is unsupported on target machine. |
| **Framerate Throttling (30 / 60 FPS)** | ✅ Supported | Reduces CPU/GPU overhead when running in the background. |

---

## 4. Localization & User Experience

| Feature | Status | Notes |
|---|:---:|---|
| **Primary Korean Localization (한국어)** | ✅ Supported | Complete UI localization in natural Korean without raw machine translation. |
| **English Fallback Localization** | ✅ Supported | 100% dictionary key parity with instant fallback. |
| **Interactive Hover Tooltip System** | ✅ Supported | 450ms floating tooltips with title, body, keyboard shortcuts, and notes. |
| **Offline User Manual (`HelpManual`)** | ✅ Supported | 12 structured topics accessible offline directly within the application. |
| **Guided First-Run Onboarding** | ✅ Supported | 6-step walkthrough introducing the import-to-wallpaper workflow. |
| **Normal Mode vs. Advanced Mode** | ✅ Supported | Clean view for casual users with optional deep diagnostics view. |

---

## 5. Platform & Distribution Boundary

| Category | Status | Rationale |
|---|:---:|---|
| **Windows 10 / 11 (64-bit)** | ✅ Supported | Target platform utilizing native Win32 APIs and WebView2. |
| **macOS Support** | ❌ Not Supported | True Wallpaper Mode relies on Win32 Explorer shell APIs (`user32.dll`). |
| **Linux Support** | ❌ Not Supported | Wallpaper reparenting is specific to the Windows desktop architecture. |
| **Bundling Proprietary Cubism Core** | ❌ By Design | Prohibited by Live2D Inc. licensing; user must provide locally. |
| **Bundling Game Assets / Models** | ❌ By Design | Copyrighted content owned by COVER Corp.; extracted locally from Steam. |
| **Online Asset Downloading** | ❌ By Design | Operates strictly locally against the user's authentic game files. |
