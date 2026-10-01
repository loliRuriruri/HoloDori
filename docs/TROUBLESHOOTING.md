# Troubleshooting Guide

This guide covers common issues, error messages, and resolutions when running **HoloDori Live2D Manager (HDM)**.

---

## 1. Live2D Cubism Core Issues

### Issue: "Live2D Cubism Core not detected" or blank canvas
- **Symptoms**: The viewer page opens, but the canvas remains black or displays a warning that `Live2DCubismCore` is undefined.
- **Cause**: The proprietary `live2dcubismcore.min.js` script is missing from the application's public assets folder.
- **Resolution**:
  1. Download the official **Cubism SDK for Web** from [Live2D Official Website](https://www.live2d.com/en/sdk/about-web/).
  2. Locate `Core/live2dcubismcore.min.js` within the downloaded ZIP package.
  3. Copy it into your HDM directory at:
     ```
     public/live2d/live2dcubismcore.min.js
     ```
  4. Reload the viewer or restart the application.

---

## 2. Steam & Game Detection Issues

### Issue: "Steam game installation not found"
- **Symptoms**: The Importer tab displays "Game Not Detected" or cannot locate `octocacheevai`.
- **Cause**: HoloDori is installed in a non-standard Steam library folder on another drive, or Steam is not running.
- **Resolution**:
  1. Verify in your Steam client that **hololive Dreams** is installed and updated.
  2. If installed on a secondary drive (e.g. `E:\SteamLibrary`), open the Importer Settings and browse directly to the game folder containing `hololive-Dreams_Data`.
  3. Ensure the `Octo/octocacheevai` file is present in the game directory.

### Issue: "Octocache decryption failed"
- **Symptoms**: The Importer reports an AES decryption error or corrupted header.
- **Cause**: The `octocacheevai` file is corrupted or was modified by an incomplete Steam update.
- **Resolution**:
  1. Open Steam, right-click **hololive Dreams** $\rightarrow$ **Properties** $\rightarrow$ **Installed Files** $\rightarrow$ **Verify integrity of game files**.
  2. Re-open HDM and rescan.

---

## 3. Desktop Character & Wallpaper Issues

### Issue: Character disappears when switching to True Wallpaper Mode
- **Symptoms**: The character is visible in Desktop Overlay mode, but disappears when clicking "Mode: True Wallpaper".
- **Causes & Resolutions**:
  1. **Virtual Desktop / Multi-Monitor Shift**: If your display configuration changed recently, the window may have been placed outside visible coordinates. Press `Ctrl + Shift + D` or right-click the System Tray icon and select **Mode: Desktop Overlay** to snap back to the primary display.
  2. **Custom Explorer Shell / Third-Party Theme**: Stardock Start11, Windhawk, or TranslucentTB may alter the `Progman` / `WorkerW` hierarchy.
     - Right-click the HDM System Tray icon and select **Recover Wallpaper Host**.
     - If your customized shell does not support `WorkerW`, HDM will automatically engage the **Desktop Overlay Fallback**, which floats above the wallpaper.

### Issue: Desktop icons cannot be clicked in Wallpaper Mode
- **Symptoms**: Mouse clicks on desktop shortcuts trigger nothing or get captured by the character.
- **Cause**: The wallpaper window did not receive the `WS_EX_TRANSPARENT` style or is positioned in front of `SHELLDLL_DefView`.
- **Resolution**:
  1. Open the System Tray menu and click **Recover Wallpaper Host**.
  2. This triggers the Win32 state machine to re-verify the Z-order behind `SHELLDLL_DefView` and re-apply click-through flags.

### Issue: Cannot move the Desktop Character window
- **Symptoms**: Dragging the character does nothing.
- **Cause**: The window is in **Lock Mode** or **Click-Through Mode**.
- **Resolution**:
  - Press `Ctrl + Shift + D` on your keyboard to instantly disengage Click-Through mode and reveal the repositioning handle.

---

## 4. Performance & Graphics Issues

### Issue: High GPU usage when running in the background
- **Symptoms**: Live2D rendering causes high GPU load during games or heavy applications.
- **Resolution**:
  1. Right-click the HDM System Tray icon and select **Pause Animation** when gaming.
  2. In the Viewer settings, reduce the target framerate from **60 FPS** to **30 FPS**.
  3. At 30 FPS, GPU utilization typically drops below 1.5% on modern systems.
