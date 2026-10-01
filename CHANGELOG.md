# Changelog & Development Milestones

All notable milestones and feature implementations of **HoloDori Live2D Manager (HDM)** are documented in this file.

---

## [HDM.AGENT.5B-R] — Windows Wallpaper Runtime Acceptance (2026-10-01)
- Verified all 11 live runtime acceptance gates on Windows 11 Pro 25H2 (Build 26200.9457).
- Verified WorkerW native attachment, style enforcement (`WS_CHILD`, `WS_EX_TRANSPARENT`), and desktop icon preservation.
- Passed 20 consecutive native attach/detach cycles (`Overlay` <-> `WorkerW`) with memory delta under 8 KB.
- Validated `WallpaperWatchdog` health check and auto-recovery mechanisms upon host invalidation.
- Confirmed Progman compatibility mode fallback and clean detachment.
- Baseline automated test count: 115 passing tests (84 Cargo / 17 JS Unit / 14 Browser WebGL).

## [HDM.AGENT.5B] — True Windows Wallpaper Mode (2026-10-01)
- Implemented native Win32 wallpaper hosting behind desktop icons via `WorkerW` and `Progman` reparenting.
- Added dynamic shell topology detection for Modern Windows 11 child WorkerW and Legacy Windows 10 sibling WorkerW.
- Established infallible fallback invariant: falls back to Desktop Character Overlay if Explorer reparenting fails.
- Integrated `WallpaperWatchdog` background thread monitoring host HWND validity every 2.5 seconds.
- Added System Tray quick controls and settings persistence for Wallpaper Mode.

## [HDM.AGENT.5A] — Desktop Character Mascot Window (2026-10-01)
- Added dedicated transparent frameless secondary window (`desktop_character`) for Live2D mascots.
- Supported OS-level click-through (`WS_EX_TRANSPARENT`), Always-on-Top toggle, and emergency shortcut `Ctrl + Shift + D`.
- Added Edit / Lock mode with repositioning handles and corner resizing.
- Implemented multi-monitor coordinate clamping and DPI-aware scaling.
- Added framerate throttling (30 FPS vs 60 FPS) and animation pause/resume.

## [HDM.AGENT.4C] — Authentic Physics & Character Player (2026-10-01)
- Extracted authentic Cubism physics definitions (`physics3.json`) from HoloDori assets.
- Integrated real-time pendulum physics simulation (hair, ribbons, accessories) into WebGL viewer.
- Implemented Character Player product features: Auto Motion cycling, Favorites, Recents, and fullscreen mode.
- Added persistent player settings via local configuration.

## [HDM.AGENT.4B] — Motion & Expression Integration (2026-10-01)
- Extracted authentic HoloDori motion clips and facial expression definitions.
- Supported simultaneous playback of body animations, facial expressions, and procedural eye blink/breath.
- Implemented smooth curve interpolation and 500ms fade-in/fade-out blending.

## [HDM.AGENT.4A] — Embedded WebGL Live2D Viewer Foundation (2026-10-01)
- Embedded official Live2D Cubism SDK for Web into the Tauri React application.
- Implemented hardware-accelerated WebGL rendering with alpha transparency and clipping masks.
- Built interactive camera controls (pan, zoom, fit) and live parameter slider inspector.
- Validated 20-cycle repeated load/unload stress without WebGL context loss or memory leaks.

## [HDM.AGENT.3B-R] — Importer Cold Acceptance (2026-10-01)
- Completed full production cold acceptance of the integrated asset acquisition pipeline.
- Hardened mock server socket draining and HTTP error code matching across chunked transfer states.
- Reached 73 passing Cargo tests across synthetic and live cached fixtures.

## [HDM.AGENT.3B] — Integrated HoloDori Source Importer (2026-10-01)
- Built automated Steam detection and `libraryfolders.vdf` parser.
- Decrypted `octocacheevai` AES-128-CBC asset catalog and indexed all bundles.
- Implemented verified streaming acquisition with size and MD5 hash checksum validation.

## [HDM.AGENT.3A] — Importer Format Audit & Spikes (2026-10-01)
- Audited 200 model bundles, 202 motion bundles, and 850 expression bundles in HoloDori.
- Reverse-engineered catalog encryption and verified deobfuscation masks.

## [HDM.AGENT.2] — Character Library & Batch Manager (2026-10-01)
- Created responsive grid UI for character cards and outfit variations.
- Added batch conversion pipeline with deduplication, cancellation, and progress reporting.
- Stress-tested with synthetic 500-model library scans.

## [HDM.AGENT.1R2] — Real Runtime Acceptance (2026-10-01)
- Verified extracted MOC3 models in official Live2D Cubism Viewer 5.3 (Cubism Core 06.00.0513).
- Confirmed single 4096x4096 lossless RGBA PNG atlas formatting.

## [HDM.AGENT.1R] — MOC3 Hardening & Validation Architecture (2026-10-01)
- Established 3-level validation model: Level 1 (Container), Level 2 (Package), Level 3 (Runtime).
- Added typed MOC3 version detection and multi-atlas sequencing.

## [HDM.AGENT.1] — Pure Rust Conversion Engine MVP (2026-10-01)
- Initial release of pure Rust conversion engine using `unity-rs-core`.
- Passed 12 negative test scenarios (malformed JSON, path traversal, byte overflow).
- Reached 100% zero-Python dependency milestone.
