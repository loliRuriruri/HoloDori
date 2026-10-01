# HoloDori Motion & Expression Integration Architecture

HDM.AGENT.4B connects official HoloDori game motions and character expressions to the embedded Live2D Cubism WebGL viewer.

---

## 1. Overview & Workflow

The motion and expression subsystem retrieves animation assets directly from the HoloDori octocache catalog and renders them in real time:

```
Character Library
  └── Select Outfit (e.g. 00007_001)
       └── Click "Open in Live2D Viewer"
            ├── Fetches animation metadata via Tauri IPC (get_model_animations)
            │    ├── Character Expressions (e.g. 15 for 00007, 13 for 00010)
            │    └── Shared Motions (202 motions grouped into categories: joy, smile, yes, wink, etc.)
            ├── WebGL Canvas Renders Model
            └── Sidebar Animation Controls
                 ├── Motions Tab: Play, Replay, Stop, Category Pills, Duration/Progress
                 ├── Expressions Tab: Apply, Clear, Active Expression Badge
                 └── Parameters Tab: Real-time Sliders with Category Grouping & Reset
```

---

## 2. Asset Discovery & Catalog Extraction

From the HoloDori Steam `octocacheevai` binary cache, animations are discovered using dedicated asset prefix patterns:

1. **Expressions (`live2d_exp_*`)**:
   - Pattern: `live2d_exp_{name}_{character_id}_{version}` (e.g., `live2d_exp_anger-01_00007_000`).
   - Character-scoped: Indexed by character ID (`00007`, `00010`, etc.).
   - Asset Type: Unity `MonoBehaviour` holding `CubismExpressionData`.
2. **Motions (`live2d_mot_*`)**:
   - Pattern: `live2d_mot_{category}-{variant}_{level}` (e.g., `live2d_mot_joy-01_lv01`).
   - Shared pool: 202 universal motions usable across all characters.
   - Asset Type: Unity `AnimationClip` (`StreamedClip`) paired with `Live2DMotionDefine` MonoBehaviour.

Catalog acquisition uses the existing audited CDN and local bundle cache pipeline with atomic hash validation (`CacheManager`).

---

## 3. Binary Asset Extraction & Conversion

The extraction engine in `src-tauri/src/importer/unity.rs` converts proprietary Unity serialized assets into standard Cubism 3/4 runtime JSON representations:

### 3.1 Expressions: `extract_expression`
- Reads Unity `MonoBehaviour` containing `CubismExpressionData`.
- Locates parameter bindings array and reads:
  - Parameter ID strings (e.g. `ParamEyeBallForm`, `ParamBrowLY`).
  - Target values (`f32`).
  - Blend mode (`CubismParameterBlendMode`):
    - `0` (`Overwrite`): Overwrite base value.
    - `1` (`Add`): Additive offset for facial/emotional accents (brows, mouth, tear offsets).
    - `2` (`Multiply`): Multiplicative factor (e.g. eye opening).
- Exports standard `.exp3.json`:
  ```json
  {
    "Type": "Live2D Expression",
    "FadeInTime": 0.3,
    "FadeOutTime": 0.3,
    "Parameters": [
      { "Id": "ParamBrowLY", "Value": -1.0, "Blend": "Add" },
      { "Id": "ParamBrowRY", "Value": -1.0, "Blend": "Add" }
    ]
  }
  ```

### 3.2 Motions: `extract_motion`
- Unity packages motion data into a `StreamedClip` inside an `AnimationClip` asset, paired with a `Live2DMotionDefine` MonoBehaviour defining curve names and fade timings.
- **Curve Names**: Extracted from `Live2DMotionDefine` string bindings (e.g., `ParamAngleX`, `ParamBodyAngleX`).
- **Hermite Stream Decoding**: Scans dense 16-byte frame blocks containing `time: f32`, curve index `u32`, and Hermite spline value/tangent floats.
- **Curve Segment Generation**: Converts linear/Hermite keyframes into standard Cubism cubic Bezier or linear segments (`[time, value, 0, ...]`).
- Exports standard `.motion3.json`:
  ```json
  {
    "Version": 3,
    "Meta": {
      "Duration": 3.3,
      "Fps": 30.0,
      "Loop": false,
      "CurveCount": 36,
      "TotalSegmentCount": 240,
      "TotalPointCount": 516
    },
    "Curves": [
      {
        "Target": "Parameter",
        "Id": "ParamAngleX",
        "Segments": [0.0, 0.0, 0, 0.33, -0.76, ...]
      }
    ]
  }
  ```

---

## 4. Animation Pipeline & Precedence Hierarchy

To prevent conflicting parameter updates and visual jitter, `Live2DModelWrapper` (`src/viewer/cubism/model.ts`) enforces a strict evaluation order each render frame:

```
1. Base Parameter Restore (load neutral baseline from model save)
   ↓
2. HoloDori Motion Layer (CubismMotionManager Hermite curve evaluation)
   ↓
3. HoloDori Expression Layer (CubismExpressionMotionManager with Add/Multiply/Overwrite)
   ↓
4. Procedural Eye Blink (CubismEyeBlink)
   ↓
5. Procedural Breath (CubismBreath)
   ↓
6. User Manual Overrides (Live sliders in Parameter Inspector)
   ↓
7. Model Physics & Draw (model.update() + WebGL render)
```

### Key Technical Fixes
- **Baseline Retention**: Neutral parameter values are saved once during model initialization and restored at the beginning of each frame. The redundant `model.saveParameters()` at the end of the update loop was removed to ensure a clean return to neutral when expressions or motions finish.
- **Effect IDs Initialization**: `CubismMotion` is initialized with explicit empty effect parameter lists (`setEffectIds([], [])`) to avoid null pointer dereferences during parameter evaluation.
- **Expression Additive Blending**: HoloDori expressions using blend mode `1` (`Add`) correctly apply subtle emotional offsets on top of baseline poses without wiping out active facial contours.

---

## 5. Frontend UI Controls

The viewer sidebar in `src/viewer/ViewerControls.tsx` provides three tabs:

1. **Motions Tab**:
   - Filter search input for quick lookup.
   - Category filter pills (`All`, `Joy`, `Smile`, `Yes`, `No`, `Wink`, `Dance`, `Special`, etc.).
   - Play/Stop toggle buttons with real-time state badge (`Playing`, `Stopping`, `Idle`).
   - Duration readout and replay button.
2. **Expressions Tab**:
   - Filter search input.
   - Current active expression badge with a prominent "Clear Expression" button.
   - Expression cards with one-click "Apply Expression" action.
3. **Parameters Tab**:
   - Categorized parameter sliders (Angle, Eye, Eyebrow, Mouth, Body, Hair, Other).
   - Numerical value indicators with non-default highlight.
   - Per-parameter and master "Reset All" buttons.

---

## 6. Acceptance & Verification

All automated tests pass across both backend Rust suites and frontend headless browser environments:

- **Cargo Test Suite**: 76 tests passing (17 unit + 16 importer integration + 15 library batch + 28 pipeline integration).
- **Frontend Unit Tests**: 7 unit tests covering motion categorization, expression extraction, and pipeline precedence.
- **Headless Edge Browser Runtime Acceptance**:
  - Test Case 1: Model `00007_001` load and parameter inspection (PASS).
  - Test Case 2: Model `00010_001` load and parameter inspection (PASS).
  - Test Case 3: 20-cycle repeated load/unload stress test (PASS).
  - Test Case 4: Real HoloDori motion playback and parameter mutation over time (PASS).
  - Test Case 5: Real HoloDori expression application and neutral reset (PASS).
  - Test Case 6: Concurrent motion, expression, and procedural idle (PASS).
