# Getting Started with HoloDori Live2D Manager (HDM)

Welcome to **HoloDori Live2D Manager (HDM)**. This guide will walk you through the setup, initial import of characters, previewing them in the embedded viewer, and displaying them as desktop mascots or live Windows wallpapers.

---

## 1. Prerequisites & System Requirements

- **Operating System**: Windows 10 (64-bit, 1903+) or Windows 11 (all versions: 21H2, 22H2, 23H2, 24H2, 25H2+)
- **Display**: Any resolution from 1080p to 4K UHD. Multi-monitor and high-DPI scaling (100% to 250%) are fully supported.
- **Steam Game**: A legitimate local installation of **hololive Dreams** on Steam.
- **WebView2 Runtime**: Pre-installed on Windows 10/11 by default.

---

## 2. Live2D Cubism Core Setup (One-Time)

To respect Live2D Inc.'s intellectual property and software license, the proprietary Live2D Cubism Core JavaScript library is **not bundled** with HDM. You need to configure it locally once:

1. Visit the official [Live2D Cubism SDK for Web Download Page](https://www.live2d.com/en/sdk/about-web/).
2. Download the latest Cubism SDK for Web archive.
3. Extract `live2dcubismcore.min.js` (located inside the `Core/` folder of the SDK archive).
4. Place the file into your HDM directory at:
   ```
   public/live2d/live2dcubismcore.min.js
   ```

---

## 3. Starting HDM

Launch the pre-built `holodori-live2d-manager.exe` or start development mode:

```powershell
npm run tauri dev
```

Upon launch, HDM automatically queries your Steam configuration (`libraryfolders.vdf`) to detect where hololive Dreams is installed.

---

## 4. Discovering & Importing Models

1. Click on the **Importer** tab in the main navigation.
2. The importer will automatically locate the game's encrypted `octocacheevai` catalog and display all available idol characters and outfits (e.g. `00007`, `00010`).
3. Select the desired character and outfit card.
4. Click **Import Selected**.
5. HDM will:
   - Verify bundle size and MD5 hash checksums.
   - Extract raw MOC3 geometry and Texture2D atlases from the UnityFS container.
   - Reconstruct authentic Cubism physics (`physics3.json`), motions, and expressions.
   - Assemble a standardized `.model3.json` package in your local library.

---

## 5. Previewing in the Embedded Viewer

1. Navigate to the **Library** tab.
2. Select your imported character card and click **Open Viewer**.
3. **Controls**:
   - **Rotate / Pan**: Right-click and drag across the canvas.
   - **Zoom**: Scroll your mouse wheel (zooms smoothly between 0.2x and 8.0x).
   - **Motions**: Click any motion name in the right panel (greeting, idle, dance, performance).
   - **Expressions**: Select facial expressions (smiles, blushes, surprises, winks).
   - **Auto Motion**: Toggle the **Auto Motion** switch in the playback bar to enable continuous, non-repeating idle motion cycling.

---

## 6. Sending to Desktop Mascot Mode

1. In the Character Player window, click **Send to Desktop** in the top-right toolbar.
2. A transparent, borderless window will appear containing your animated character.
3. **Toolbar Controls (Top of Character)**:
   - **Move**: Click and drag the handle bar to reposition.
   - **Scale**: Use the +/- buttons or drag the bottom-right corner.
   - **Lock**: Click the lock icon to enter clean presentation mode (hides handles).
   - **Click-Through**: Enable the click-through button (`WS_EX_TRANSPARENT`) so mouse clicks pass straight through the character to underlying applications.
4. **Emergency Shortcut**: Press `Ctrl + Shift + D` at any time to toggle click-through off and restore toolbar controls.

---

## 7. Enabling True Windows Wallpaper Mode

1. While in Desktop Character mode, open the toolbar menu or right-click the HDM System Tray icon in the Windows taskbar.
2. Select **Mode: True Wallpaper (WorkerW / Progman)**.
3. The Live2D window will reparent behind your Windows desktop icons.
4. **Features**:
   - All desktop icons, shortcuts, and selection rectangles remain 100% visible, clickable, and responsive.
   - If Windows Explorer restarts, the built-in watchdog recovers the wallpaper automatically within 2.5 seconds.
   - To return to floating overlay mode, right-click the tray icon and select **Mode: Desktop Overlay**.

---

## 8. Korean Localization & Help System (한국어 지원 및 도움말)

HDM v1.0.0 is built with first-class Korean localization and an offline help system:

- **Language Switch**: Click `🌐 한국어` or `English` in the top header to instantly switch languages. HDM defaults to Korean on Korean Windows systems.
- **Interactive Tooltips**: Hover over any button or setting for 450ms to view its purpose, shortcut keys, and technical explanations.
- **Offline Help Manual**: Click `? 도움말` in the header or press `F1` at any time to open the built-in 12-topic manual, complete with search, keyboard shortcuts, technical glossary, and FAQ.
- **First-Run Guide**: Click `ⓘ 사용법` to reopen the step-by-step onboarding walkthrough at any time.
