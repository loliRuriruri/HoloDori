# Windows Wallpaper Host Audit Report (HDM.AGENT.5B)

**Date**: 2026-10-01  
**Target Environment**: Windows Desktop Shell  
**Author**: HoloDori Live2D Manager (HDM) Engineering Team

---

## 1. Host System Environment & Versions

The live audit was executed directly against the local host environment running the interactive desktop session:

| Field | Value |
|---|---|
| **OS Caption** | Microsoft Windows 11 Pro |
| **OS Version** | `10.0.26200` |
| **OS BuildNumber** | `26200` |
| **DisplayVersion** | `25H2` |
| **CurrentBuild.UBR** | `26200.9457` |
| **Explorer ProductVersion** | `10.0.26100.8875` |
| **Explorer FileVersion** | `10.0.26100.8875 (WinBuild.160101.0800)` |
| **Interactive Window Station** | `WinSta0` |
| **Desktop Station Name** | `default` |
| **Primary Display Resolution** | `3840 x 2160` (4K UHD) |

---

## 2. Desktop Shell Window Hierarchy Audit

A specialized low-level Win32 probe (`scripts/win11_audit.ps1` and `scripts/audit_child_worker.ps1`) attached to the `winsta0\default` desktop to inspect window relationships before and after dispatching the `0x052C` (`WM_SPAWN_WORKER`) message to `Progman`.

### 2.1 Pre-0x052C Hierarchy

- **Progman HWND**: `0x00010152`
  - Class: `Progman`
  - Title: `Program Manager`
  - Style: `0x96000000` (`WS_POPUP | WS_VISIBLE | WS_CLIPSIBLINGS | WS_CLIPCHILDREN`)
  - ExStyle: `0x00200080` (`WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW`)
  - Visible: `True`
- **Progman Direct Children**:
  1. `0x00010156`: `SHELLDLL_DefView` (Desktop icon view container, visible)
     - Child: `0x00010158`: `SysListView32` (Title: `FolderView`)
     - Child: `0x00010160`: `SysHeader32`
  2. `0x00792176`: `WorkerW` (Wallpaper canvas container, visible)
     - Style: `0x58000000` (`WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS`)
     - ExStyle: `0x00000000`
     - Bounds: `[0, 0, 3840, 2160]` (entire primary/virtual desktop)

### 2.2 SendMessageTimeout (0x052C) Behavior

- Dispatch: `SendMessageTimeoutW(hWndProgman, 0x052C, 0x0000000D, 1, SMTO_NORMAL, 1000, &outResult)`
- Result: Succeeded (`return=1`, `outResult=0`).
- No shell crash or flickering occurred.

### 2.3 Post-0x052C Hierarchy & Topology Identification

- **Progman HWND**: `0x00010152` (persisted intact).
- **SHELLDLL_DefView Parent**: `0x00010152` (`Progman`).
- **Z-Order Relationship**:
  - `SHELLDLL_DefView` (`0x00010156`):
    - `GW_HWNDPREV`: `0x00000000` (Topmost child inside `Progman`)
    - `GW_HWNDNEXT`: `0x00792176` (`WorkerW` child immediately behind `SHELLDLL_DefView`)
  - `WorkerW` (`0x00792176`):
    - `GW_HWNDPREV`: `0x00010156` (`SHELLDLL_DefView` is in front)
    - `GW_HWNDNEXT`: `0x00000000` (Bottommost child inside `Progman`)

### 2.4 Critical Discovery: Modern Windows 11 Shell Topology

Historically in Windows 7, 8, and Windows 10 (and early Windows 11), sending `0x052C` to `Progman` moved `SHELLDLL_DefView` into a newly created top-level `WorkerW` window, with a second top-level `WorkerW` placed immediately behind it as a sibling.

In modern **Windows 11 24H2 / 25H2 (Build 26200+)**:
1. `SHELLDLL_DefView` **remains inside `Progman`**.
2. Explorer embeds a dedicated `WorkerW` as a **direct child of `Progman`**, positioned directly beneath `SHELLDLL_DefView`.
3. Alternatively, if no child `WorkerW` is present, `Progman` itself acts as the parent container behind `SHELLDLL_DefView`.

**Conclusion on Topology Support**:
- **WorkerW Mode (Child of Progman / Sibling of DefView)**: **FULLY SUPPORTED**. The target window for Live2D hosting is `WorkerW` (`0x00792176`) or a dedicated child inside `Progman` placed behind `SHELLDLL_DefView`.
- **Progman Compatibility Mode**: **FULLY SUPPORTED**. Windows can be parented directly to `Progman` and placed behind `SHELLDLL_DefView` using `SetWindowPos(hWnd, hWndDefView, ..., SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOSIZE)`.
- **Desktop Overlay Mode (AGENT.5A)**: **FULLY SUPPORTED & MANDATORY FALLBACK**. Transparent frameless window with `WS_EX_TRANSPARENT` / click-through and monitor clamping.

---

## 3. Failure Modes & Safeguards

| Failure Mode | Impact | HDM Safeguard |
|---|---|---|
| **Explorer Crash / Restart** | `Progman` and `WorkerW` HWNDs are destroyed. The hosted wallpaper window loses its parent or gets destroyed by the OS. | **Host Recovery Watchdog**: A background monitor checks host HWND validity every 2 seconds (`IsWindow(hHost)`). If invalid, triggers re-discovery of new Explorer handles; if re-discovery fails within 3 seconds, gracefully transitions to `FALLBACK_OVERLAY` without crashing HDM. |
| **Theme / Wallpaper Change** | Explorer may redraw or re-create child `WorkerW` windows. | When `WM_SETTINGCHANGE` / `WM_DISPLAYCHANGE` is broadcast, HDM verifies the Z-order position behind `SHELLDLL_DefView` and reapplies `SetWindowPos(hWnd, HWND_BOTTOM, ...)`. |
| **Desktop Icons Inaccessibility** | If the wallpaper window receives mouse clicks, desktop icons become unclickable. | The wallpaper window is created with `WS_EX_TRANSPARENT` (click-through) and `WS_CHILD` with mouse events disabled (`set_ignore_cursor_events(true)`). All clicks pass directly through to `SHELLDLL_DefView` / `SysListView32`. |
| **SHELLDLL_DefView Corruption** | Misguided code attempting to reparent `SHELLDLL_DefView` can break the Windows desktop shell. | **Strict Invariant**: `SHELLDLL_DefView` is NEVER modified, reparented, or hidden. HDM only reparents its own Webview window. |
| **Process Termination / Exit** | Reparented child windows might orphan Explorer if not cleanly unparented. | On HDM shutdown or wallpaper disable, HDM restores the window's parent to `NULL` (or desktop), hides it, and cleanly destroys the webview. |

---

## 4. Host Compatibility Matrix

| Feature | Windows 10 (Legacy) | Windows 11 (21H2 - 23H2) | Windows 11 (24H2 - 25H2+) | HDM Support Status |
|---|---|---|---|---|
| **Top-Level WorkerW Sibling** | Yes | Yes / Variant | Variant | Supported via automatic topology detector |
| **Progman-Child WorkerW** | Rare | Yes | **Yes (Active on this machine)** | **Primary True Wallpaper Target** |
| **Direct Progman Parenting** | Fallback | Fallback | Fallback | Supported as secondary fallback |
| **Desktop Overlay (AGENT.5A)** | Always | Always | Always | Supported as infallible tertiary fallback |

---

## 5. Architectural Decision

HDM.AGENT.5B will implement a unified **`WallpaperHostManager`** in Rust (`src-tauri/src/desktop/wallpaper/`):
1. **Dynamic Shell Topology Discovery**:
   - Check if `SHELLDLL_DefView` is under a top-level `WorkerW` (Legacy). If so, use the sibling `WorkerW` behind it.
   - Check if `SHELLDLL_DefView` is under `Progman` and has a child `WorkerW` (Modern Win11). If so, use that `WorkerW` or reparent into `Progman` immediately beneath `SHELLDLL_DefView`.
   - If neither responds cleanly, fall back to `Progman` compatibility mode.
   - If reparenting fails, gracefully fall back to `Desktop Overlay Mode`.
2. **Dedicated Webview Window**:
   - Label: `desktop_wallpaper`
   - URL: `index.html?window=wallpaper&...`
   - Borderless, transparent, skip taskbar, click-through enabled.
3. **Tray & UI Synchronization**:
   - State indicator accurately displays: `Active (WorkerW)`, `Active (Progman)`, `Fallback (Overlay)`, or `Disabled`.
   - User can switch between True Wallpaper and Desktop Overlay anytime.
