# HoloDori Character Player & Physics Guide

HDM.AGENT.4C productizes the embedded Live2D viewer into a practical **Character Player**, incorporates **authentic Live2D physics**, and enables continuous in-viewer character/outfit switching, auto-motion, favorites, and persistent user preferences.

---

## 1. Product Overview & User Experience

The Character Player provides an immediate, engaging character viewing experience:
- **Clean Player Default**: Displays character, outfit, active motion/expression, playback controls, random motion, auto-motion timer, camera fit, and fullscreen toggle.
- **Advanced Mode**: Detailed parameter sliders, category filtering, procedural idle toggles, physics rig inspector, and live WebGL diagnostics are cleanly organized under the Advanced tab.
- **In-Viewer Model Switching**: Users can navigate between imported characters and outfits directly in the player header bar without returning to the Library.

```
+-----------------------------------------------------------------------------------+
| [<- Library]  [Player | Advanced]  [Char: 00007 < > *]  [Outfit: 001 < > *]       |
| Background: Neutral | - [100%] + | Fit (F) | Reset (0) | [Full] | [Sidebar]       |
+-----------------------------------------------------------------------------------+
|                                            |  Sidebar (Tabs):                     |
|                                            |  [Motions | Exp | * Favs | Advanced] |
|                                            |                                      |
|             WebGL Live2D Canvas            |  - Active: joy-01_lv01 (3.3s)        |
|             (Authentic Physics Active)     |  - Timeline Progress Bar [======   ] |
|                                            |  - [Stop (Space)] [Random (R)]       |
|                                            |  - [x] Auto-Motion (Delay: 3s)       |
|                                            |  - Motion Catalog & Category Filter  |
+-----------------------------------------------------------------------------------+
```

---

## 2. Authentic Live2D Physics Audit & Integration

### 2.1 Audit Verdict: VERIFIED
During HDM.AGENT.4C discovery, authentic Live2D physics data was audited directly within the official HoloDori `live2d_mdl_*` asset bundles:
- Every model bundle contains a `CubismPhysicsController` MonoBehaviour (`class_id = 114`, referencing MonoScript `path_id = -6901686069553852335`, namespace `Live2D.Cubism.Framework.Physics`).
- The binary payload encodes the full physics rig specification:
  - SubRig count (e.g., 72 subrigs for `00001`, 65 subrigs for `00007`).
  - Per SubRig: Inputs (Weight, Type, Reflect), Outputs (VertexIndex, Scale, Weight, Type, Reflect), Vertices (Position, Mobility, Delay, Acceleration, Radius), and Normalization ranges.

### 2.2 Extraction Pipeline
1. `UnityExtractor::parse_physics_rig` parses the raw `CubismPhysicsController` MonoBehaviour binary buffer into structured Rust types.
2. Converts the data into standard Cubism 3/4 `.physics3.json` format.
3. `import_single_model` writes `<model>.physics3.json` into the output package directory.
4. Updates `model3.json` to reference `"Physics": "<model>.physics3.json"`.
5. `loadModelPackageFromDisk` automatically reads and attaches the physics buffer to `Live2DModelWrapper`.

### 2.3 Animation Precedence Hierarchy
To guarantee natural physics oscillations without overriding manual inspection:
```
1. Base Model Parameters (loadParameters)
2. HoloDori Motion (primary keyframe animation)
3. HoloDori Expression (additive/override facial morphs)
4. Eye Blink (procedural eye open/close)
5. Breath (procedural breathing sine waves)
6. Authentic Physics (secondary hair/bust/accessory physics reaction)
7. User Overrides (manual inspector sliders)
8. CubismModel.update() & drawModel()
```
Physics evaluates after Motion, Expression, EyeBlink, and Breath so hair and cloth react to all head and body movements. User slider overrides apply last so technical inspection is never fought by physics solvers.

---

## 3. In-Viewer Switching Architecture

To support continuous switching across models without memory leaks or WebGL context recreation:
- The `ViewerRenderer` and underlying WebGL context remain stable on the canvas across switches.
- When switching characters or outfits:
  1. The existing model wrapper cleanly deletes all GPU textures (`gl.deleteTexture`).
  2. Disposes the internal Cubism WebGL renderer and drops native buffers.
  3. Loads the new package via Tauri IPC (`read_package_file`).
  4. Initializes the new model wrapper onto the existing WebGL context.
  5. Updates model diagnostics and pushes the selection to Recent Models.
- **Stress-Test Validated**: Verified across 20 continuous load/unload switching cycles without WebGL context loss or memory leaks.

---

## 4. Playback & Automation Systems

### 4.1 Auto-Motion Controller
- When enabled, automatically schedules a random motion after the current animation completes and the character returns to idle.
- Configurable idle delay (default: 3.0 seconds, range: 1s – 30s).
- Pauses automatically when the window is hidden (`document.hidden`).

### 4.2 Non-Repeat Random Motion
- The random motion selector maintains a reference to the last played motion.
- When `motions.length > 1`, the previous motion is excluded from the candidate pool, preventing immediate repeat animations.

### 4.3 Timeline Progress Tracking
- Real-time progress bar (0% - 100%) and elapsed/total duration counter for active motions.

---

## 5. Persistence & User Preferences

Player state is stored locally via Tauri IPC (`load_player_settings` / `save_player_settings`) with localStorage fallback:
- **Settings**: Player/Advanced mode, Background style (`neutral`, `checkerboard`, `transparent`), Physics toggle, Breath toggle, Eye Blink toggle, Auto-Motion toggle, and Auto-Motion delay.
- **Favorites**: Starred characters, outfits, motions, and expressions.
- **Recent Models**: Tracks up to 10 most recently viewed models, with most recent at index 0 and automatic deduplication.

---

## 6. Controls & Keyboard Shortcuts

| Shortcut | Action | Description |
|:---|:---|:---|
| `Space` | Play / Stop | Stops current motion if playing; otherwise plays random motion |
| `R` | Random Motion | Plays a random motion (avoiding immediate repeats) |
| `F` | Fit to View | Centers and fits the model within the viewport |
| `0` | 100% Reset | Resets camera zoom to 1.0 and pan to (0, 0) |
| `F11` | Fullscreen | Toggles window/document fullscreen mode |
| `Esc` | Exit Fullscreen | Exits fullscreen mode if active |
| `Double Click` | Fit to View | Double-clicking the canvas centers and fits the model |

---

## 7. Desktop Character Mode (Send to Desktop)

Clicking the **"Send to Desktop"** button in the Character Player header launches the floating desktop companion window:
- **Frameless & Transparent**: Renders the character cleanly floating over Windows desktop and applications.
- **Dual Modes**: Edit Mode (draggability, scale 25%–300%, 30/60 FPS toggle, always on top) vs Lock Mode (clean character only).
- **OS Click-Through**: Allows clicks to pass through to underlying windows; recover via `Ctrl + Shift + D` or System Tray.
- **System Tray Integration**: Manage visibility, click-through, pause, and closing from the Windows taskbar.
- Full architectural and operational details are documented in `docs/DESKTOP_CHARACTER.md`.

