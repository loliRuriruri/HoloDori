# Embedded Live2D Viewer Architecture & Guide

HDM.AGENT.4A introduces an embedded, real-time Live2D Cubism WebGL viewer directly inside the HoloDori Live2D Manager desktop application.

---

## 1. Overview & Workflow

The viewer enables immediate inspection and visualization of generated Live2D packages:
```
Character Library / Importer
  └── Select Model (e.g. 00007_001)
       └── Click "Open in Live2D Viewer"
            └── Embedded WebGL Canvas renders model
                 ├── Procedural Idle: Breathing + Eye Blink
                 ├── Camera: Interactive Pan (drag) & Zoom (wheel)
                 └── Parameter Inspector: Live sliders with categories & reset
                      └── Click "Back to Library" (Preserves search/filters/selection)
```

---

## 2. Component Structure

The viewer subsystem resides in `src/viewer/`:

```
src/viewer/
├── index.ts                     # Public API and component exports
├── types.ts                     # Viewport, parameter, diagnostics, and package types
├── settings.ts                  # Persistent settings, favorites, and recent models
├── ViewerPage.tsx               # Orchestrator container with loading/error boundaries
├── ViewerCanvas.tsx             # Interactive WebGL canvas with ResizeObserver & input handling
├── ViewerControls.tsx           # Player/Advanced modes, camera, switching, timeline, diagnostics
└── cubism/
    ├── runtime.ts               # CubismFramework singleton lifecycle & Core detection
    ├── resources.ts             # Memory-safe package loading via Tauri IPC
    ├── parameters.ts            # Parameter categorization, formatting, and reset logic
    ├── model.ts                 # Live2DModelWrapper extending CubismUserModel with physics
    ├── motion.ts                # HoloDori motion manager with progress tracking
    ├── expression.ts            # HoloDori expression manager
    ├── renderer.ts              # WebGL context, animation loop, FPS counter, and camera matrix math
    └── framework/               # Live2D Cubism 5 Web Framework modules (Open Software License)
```

See [CHARACTER_PLAYER.md](file:///D:/test/holodori/docs/CHARACTER_PLAYER.md) for detailed documentation on Player Mode, authentic Live2D physics extraction, in-viewer character switching, and automation features.


---

## 3. Subsystem Architecture

### 3.1 Cubism Framework & Core Runtime (`runtime.ts`)
- **Detection**: Checks `window.Live2DCubismCore` before initializing WebGL resources. If missing, displays an informative prompt explaining the proprietary binary requirement.
- **Reference Counting**: `acquireCubismFramework()` and `releaseCubismFramework()` ensure that repeated model openings and closings do not re-run costly framework memory allocations.

### 3.2 Safe IPC Asset Access (`resources.ts`)
- Rather than exposing local file paths to broad webview scopes, `loadModelPackageFromDisk()` uses the sandboxed `read_package_file` Tauri IPC command.
- Decodes `model3.json`, extracts `Moc` and `Textures` references.
- Instantiates textures via ephemeral `Blob` URLs (`URL.createObjectURL`).
- Tracks all created URLs and revokes them (`URL.revokeObjectURL`) immediately upon model disposal, preventing browser memory leaks.

### 3.3 Model Wrapper & Procedural Motion (`model.ts`)
- Extends `CubismUserModel`.
- Slices `.moc3` bytes and constructs `CubismModel`.
- Slices textures into WebGL `TEXTURE_2D` units with premultiplied alpha.
- Autodetects eye and breath parameter IDs (`ParamAngleX`, `ParamAngleY`, `ParamEyeLOpen`, `ParamEyeROpen`, `ParamBreath`, etc.) and attaches `CubismEyeBlink` and `CubismBreath`.
- Maintains a `_userOverrides` map so that user slider tweaks take precedence over procedural animations.

### 3.4 Camera & WebGL Renderer (`renderer.ts`, `ViewerCanvas.tsx`)
- Calculates aspect-ratio preserving view-projection matrices:
  - Scale factor: $\min(W/H, H/W)$ to maintain un-stretched unit coordinates.
  - Pan offset: translated relative to zoom factor.
  - Zoom factor: clamped between $0.2\times$ and $8.0\times$.
- Listens to `webglcontextlost` and `webglcontextrestored` events.
- Pauses the `requestAnimationFrame` loop when `document.hidden` is true to conserve system resources.

### 3.5 Parameter Inspector (`ViewerControls.tsx`, `parameters.ts`)
- Inspects all parameters present on the model (e.g. 131 parameters on `00007_001`, 162 parameters on `00010_001`).
- Groups them into intuitive categories:
  - **Angle**: Head and body rotations (`ParamAngleX/Y/Z`, `ParamBodyAngleX/Z`).
  - **Eye**: Open/close and eyeball directions (`ParamEyeL/ROpen`, `ParamEyeBallX/Y`).
  - **Eyebrow**: Brow heights and angles (`ParamBrowLY/RY`).
  - **Mouth**: Mouth form and open states (`ParamMouthForm`, `ParamMouthOpenY`).
  - **Body**: Arm, hand, and torso parameters (`ParamArmLA`, `ParamHandR`).
  - **Hair**: Hair sway and physics (`ParamHairFront/Side/Back`).
  - **Other**: Breathing, accessories, and special expressions.
- Live numeric displays and range sliders.
- Real-time modification with visual highlight for non-default values and one-click per-parameter reset (`↺`) plus "Reset All".

---

## 4. Proprietary Boundary & Git Safety Policy

1. **Open Framework**:
   The Cubism 5 Web Framework modules (`src/viewer/cubism/framework/`) and WebGL shaders (`public/shaders/`) are licensed under the **Live2D Open Software License** and are committed to Git.
2. **Proprietary Core**:
   `live2dcubismcore.min.js` is proprietary under the **Live2D Proprietary Software License**.
   - Kept in `public/live2d/live2dcubismcore.min.js`.
   - Strictly gitignored in `.gitignore`.
   - Never committed to any repository branch.
   - If missing, the application remains fully functional and displays a clear notice in the viewer window rather than crashing.

---

## 5. Verification & Acceptance Results

- **Unit Tests**: Parameter categorization, name formatting, aspect scaling, zoom clamping, settings persistence, favorites toggling, recent list capping, and random motion non-repeats verified (`tests/viewer_unit.test.mjs` - 11 PASS).
- **Headless Browser Acceptance**: Automated Edge browser tests (`scripts/test_viewer_runtime.mjs` - 9 PASS):
  - Model `00007_001`: 131 parameters verified, live slider adjustment PASS.
  - Model `00010_001`: 162 parameters verified, PASS.
  - 20-cycle stress test: 20 sequential load/unload cycles completed without error or memory leaks.
  - Real HoloDori motion playback and parameter mutation PASS.
  - Real HoloDori expression application and neutral reset PASS.
  - Concurrent motion + expression + procedural idle PASS.
  - In-viewer character and outfit switching on same WebGL context without context loss PASS.
  - Authentic Live2D physics attachment and 72-subrig evaluation PASS.
  - Player settings, favorites, and recent models persistence PASS.
