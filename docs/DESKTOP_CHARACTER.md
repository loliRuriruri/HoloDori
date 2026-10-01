# HDM Desktop Character Window — Architecture & Operational Guide

## 1. Overview

**HDM.AGENT.5A** delivers the **Desktop Character Window**: a dedicated, frameless, transparent Windows desktop companion mode for HoloDori Live2D models.

```
                    ┌───────────────────────────────┐
                    │   HDM Character Player (Main) │
                    │   - Library / Outfits         │
                    │   - Motions & Expressions     │
                    │   - "Send to Desktop" Button  │
                    └──────────────┬────────────────┘
                                   │ Tauri IPC: open_desktop_window
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Windows Desktop (Desktop Character Window)                                  │
│                                                                             │
│   ┌─────────────────────────────────────────────────────────────┐           │
│   │ [✥ Character Name] [-] [100%] [+] [60 FPS] [📌] [🖱️] [🔒] [✕] │ (Edit Mode) │
│   └─────────────────────────────────────────────────────────────┘           │
│                                                                             │
│                                                                             │
│                     ┌───────────────────────┐                               │
│                     │                       │                               │
│                     │   Live2D Character    │                               │
│                     │   - Transparent WebGL │                               │
│                     │   - Physics & Motions │                               │
│                     │   - Breath & Blink    │                               │
│                     │                       │                               │
│                     └───────────────────────┘                               │
│                                                                             │
│   Lock Mode: Zero chrome, transparent canvas, click-through or right-click  │
│   Emergency Toggle: Ctrl + Shift + D                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                   ▲
                                   │
               ┌───────────────────┴───────────────────┐
               │         Windows System Tray           │
               │  - Show / Hide HoloDori Manager       │
               │  - Show / Hide Desktop Character      │
               │  - Interactive Mode                   │
               │  - Click-Through Mode                 │
               │  - Always On Top Toggle               │
               │  - Pause / Resume Animation           │
               │  - Close Desktop Character            │
               │  - Exit Application                   │
               └───────────────────────────────────────┘
```

---

## 2. Window Architecture & WebGL Transparency

### Dedicated Tauri Webview Window
- **Label**: `desktop_character`
- **Url Route**: `index.html?window=desktop&char=<id>&outfit=<id>&pkg=<dir>&display=<name>`
- **Window Properties**:
  - `transparent: true`
  - `decorations: false`
  - `shadow: false`
  - `always_on_top: true` (configurable)
  - `resizable: true`
  - `skip_taskbar: true` (relies on System Tray for clean desktop experience)
- **DOM Transparency Pipeline**:
  - HTML root and body assigned `.desktop-mode` class on mount.
  - CSS enforces:
    ```css
    html.desktop-mode,
    body.desktop-mode,
    body.desktop-mode #root {
      background: transparent !important;
      background-color: transparent !important;
      overflow: hidden !important;
      user-select: none !important;
    }
    ```
  - `ViewerCanvas` rendered with `background="transparent"`.
  - WebGL context initialized with `alpha: true, premultipliedAlpha: true`.
  - WebGL clear color set to `(0.0, 0.0, 0.0, 0.0)`.

---

## 3. Dual Mode Operation: Edit Mode vs. Lock Mode

### Edit Mode (`editMode: true`)
- **Visuals**:
  - Top translucent floating pill toolbar.
  - Border highlight (`2px dashed rgba(59, 130, 246, 0.7)`) clearly demarcating window bounds for positioning and resizing.
- **Controls**:
  - **Drag Region**: Entire top toolbar acts as `data-tauri-drag-region` with native pointer dragging.
  - **Zoom & Scale**: Scale slider and `[-]` / `[+]` buttons bounded between **25% (0.25x)** and **300% (3.0x)**.
  - **Framerate Selector**: Toggle between **30 FPS** (power-saving) and **60 FPS** (fluid motion).
  - **Always on Top (📌)**: Toggle foreground attachment.
  - **Click-Through (🖱️)**: Configure whether clicks will pass through when locked.
  - **Lock Character (🔒)**: Exits Edit Mode into Lock Mode.
  - **Close (✕)**: Destroys the desktop window.

### Lock Mode (`editMode: false`)
- **Visuals**: Zero chrome, zero borders, 100% transparent background. Only the animated character is visible.
- **Click-Through Mode**:
  - When enabled, `set_ignore_cursor_events(true)` is activated on the Windows OS level.
  - Mouse clicks pass completely through to applications beneath (e.g. IDEs, browsers, games).
- **Interactive Mode**:
  - Left click / double click plays a random motion from the HoloDori catalog.
  - Right click displays a dark translucent context menu:
    - 🔓 **Edit Mode** (`Ctrl + Shift + D`)
    - 🎲 **Play Random Motion**
    - ⏸️ / ▶️ **Pause / Resume Animation**
    - 📌 **Toggle Always On Top**
    - 🖱️ **Enable Click-Through**
    - ✕ **Close Character**

---

## 4. Multi-Monitor Coordinate Clamping & Recovery

To prevent characters from being restored off-screen (e.g., after disconnecting an external display), `clamp_window_position` validates window coordinates on startup against all available monitors:

1. Query all connected monitors (`get_available_monitors`).
2. Verify that at least a `60px` margin overlaps with any active monitor bounding box.
3. If the window is completely off-screen, clamp its coordinates to the primary display's bottom-right safe corner:
   ```rust
   let safe_x = (primary.x + primary.width - width - 40.0).max(primary.x);
   let safe_y = (primary.y + primary.height - height - 60.0).max(primary.y);
   ```

---

## 5. Click-Through Recovery Guarantees

When Click-Through Mode is active, the window ignores all mouse inputs. Two independent recovery mechanisms guarantee the user can always regain control:

1. **Global Keyboard Shortcut**: `Ctrl + Shift + D` toggles Edit Mode on and off from anywhere while the window has focus.
2. **System Tray Menu**: Right-clicking the HoloDori tray icon in the Windows taskbar exposes:
   - `Interactive Mode`: Calls `set_desktop_click_through(false)`, immediately re-enabling mouse events.
   - `Click-Through Mode`: Calls `set_desktop_click_through(true)`.
   - `Close Desktop Character`: Safely tears down the desktop window.

---

## 6. Remote Control IPC Protocol

The Character Player and System Tray communicate with the Desktop Character Window via bidirectional Tauri IPC events:

| Event | Direction | Payload | Description |
|---|---|---|---|
| `switch-model` | Main/Tray → Desktop | `{ characterId, outfitId, packageDir, displayName }` | Switches active Live2D model without tearing down WebGL context |
| `desktop-action` | Main/Tray → Desktop | `{ action, asset_name?, paused?, fps? }` | Remote action execution (`play_motion`, `apply_expression`, `stop_motion`, `clear_expression`, `random_motion`, `toggle_pause`, `set_fps`, `toggle_lock`, `close`) |
| `click-through-changed` | Backend → Webviews | `boolean` | Synchronizes click-through toggle across all views |
| `always-on-top-changed` | Backend → Webviews | `boolean` | Synchronizes always-on-top toggle across all views |
| `desktop-state-changed` | Backend → Main | `{ is_open: boolean }` | Updates the Main Window's "Desktop Active" badge |

---

## 7. Performance & Throttling

- **30 FPS / Low Power Mode**: Implemented inside `ViewerRenderer.ts` animation loop. Frame rendering throttles using timestamp delta checks:
  ```typescript
  if (this._targetFps > 0) {
    const minInterval = 1000 / this._targetFps;
    if (now - this._lastRenderTime < minInterval - 2.0) return;
  }
  ```
- **Pause Support**: When paused, `ViewerRenderer` halts all WebGL render calls, updates, and RAF computations, consuming 0% GPU while keeping model state loaded in VRAM.
- **20-Cycle Lifecycle Stress Test**: Verified in headless browser runtime tests—repeatedly loading, unloading, and switching models across 20 cycles introduces zero memory leaks, orphaned WebGL textures, or crashes.

---

## 8. Integration with True Windows Wallpaper Mode (HDM.AGENT.5B)

The Desktop Character Window seamlessly transitions between **Desktop Overlay Mode** and **True Windows Wallpaper Mode**:
- In **Overlay Mode**, the window floats as an always-on-top or standard desktop window.
- In **Wallpaper Mode**, the window is reparented directly beneath desktop icons inside Windows Explorer's `WorkerW` or `Progman` hierarchy (`SetParent`), allowing desktop icons to remain fully interactive.
- Seamless, zero-flicker switching between Overlay and Wallpaper modes is supported in real time without reloading the Live2D model or reconstructing the WebGL context.
- For complete technical specifications, see [`docs/WALLPAPER_MODE.md`](file:///D:/test/holodori/docs/WALLPAPER_MODE.md) and [`docs/WINDOWS_WALLPAPER_HOST_AUDIT.md`](file:///D:/test/holodori/docs/WINDOWS_WALLPAPER_HOST_AUDIT.md).

