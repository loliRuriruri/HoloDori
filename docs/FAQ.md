# Frequently Asked Questions (FAQ)

### General

**Q: What is HoloDori Live2D Manager (HDM)?**  
A: HDM is an unofficial Windows desktop application for extracting and converting Live2D models from your legally owned copy of **hololive Dreams** on Steam into standardized Cubism model packages (`.model3.json`), which can then be previewed in an embedded player, floating desktop mascot, or live wallpaper.

**Q: Is HDM free to use?**  
A: Yes, HDM is completely free. However, you must legally own **hololive Dreams** on Steam to import authentic game characters, motions, and expressions.

**Q: Does HDM include the 3D or Live2D models in the download?**  
A: **No.** To respect copyright and intellectual property laws, no game assets, models, textures, motions, or audio are bundled with HDM. All content is imported locally from your own Steam game files.

**Q: Can I get banned from Steam for using HDM?**  
A: **No.** HDM operates purely as an offline file parser and viewer. It does not hook into game processes, inject DLLs, modify game memory, or make unauthorized network requests to game servers.

---

### Technical & Features

**Q: Why do I need to download `live2dcubismcore.min.js` separately?**  
A: Live2D Cubism Core is proprietary software owned by Live2D Inc. Its license agreement prohibits third-party redistribution in open-source repositories without a commercial agreement. Providing your own copy takes less than a minute and ensures compliance with Live2D's terms.

**Q: How does True Wallpaper Mode differ from standard Desktop Character Mode?**  
A: 
- **Desktop Character Mode (Overlay)**: Spawns a floating, transparent window that hovers above other desktop windows or sits on top of your existing wallpaper.
- **True Wallpaper Mode (WorkerW / Progman)**: Reparents the Live2D canvas directly into the Windows Explorer shell *behind* your desktop icons. Your desktop shortcuts and selection box remain fully clickable in front of the animated character.

**Q: What happens if Windows Explorer crashes or restarts?**  
A: HDM runs an internal `WallpaperWatchdog` background thread that checks host handle validity every 2.5 seconds. When Explorer restarts, the watchdog detects the new shell handles and automatically re-attaches the wallpaper without requiring an application restart.

**Q: Does HDM support multi-monitor setups?**  
A: Yes. HDM detects all active displays and clamps coordinates to ensure your character does not become lost off-screen when displays are connected, disconnected, or rearranged.

**Q: Are physics and motions authentic to the game?**  
A: Yes. HDM does not synthesize artificial movements; it extracts the actual animation curves, physics pendulum rigs, and facial expression presets authored by the game developers.

---

### Compatibility

**Q: Does HDM run on Windows 10?**  
A: Yes, Windows 10 (64-bit, version 1903+) and Windows 11 are fully supported.

**Q: Is macOS or Linux supported?**  
A: Not for Desktop Character and True Wallpaper modes, which are deeply integrated with the Win32 API (`user32.dll`, `gdi32.dll`). The core Rust conversion pipeline is portable, but the desktop experience is Windows-exclusive.
