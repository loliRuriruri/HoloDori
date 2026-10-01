use crate::commands::desktop::{
    clamp_window_position, get_available_monitors, DESKTOP_WINDOW_LABEL,
};
use crate::desktop::wallpaper::{
    WallpaperBounds, WallpaperDiagnostics, WallpaperHostManager, WallpaperHostPreference,
    WallpaperStatus, WallpaperWatchdog,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

fn urlencoding_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.' || b == b'~' {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{:02X}", b));
        }
    }
    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnableWallpaperRequest {
    pub character_id: String,
    pub outfit_id: String,
    pub package_dir: String,
    pub display_name: Option<String>,
    pub preference: Option<WallpaperHostPreference>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
}

pub struct WallpaperAppState {
    pub manager: WallpaperHostManager,
    pub watchdog: Arc<WallpaperWatchdog>,
}

impl Default for WallpaperAppState {
    fn default() -> Self {
        Self {
            manager: WallpaperHostManager::new(),
            watchdog: Arc::new(WallpaperWatchdog::new()),
        }
    }
}

#[tauri::command]
pub async fn get_wallpaper_state(app: AppHandle) -> Result<WallpaperStatus, String> {
    let state = app.state::<WallpaperAppState>();
    Ok(state.manager.get_status())
}

#[tauri::command]
pub async fn get_wallpaper_diagnostics(app: AppHandle) -> Result<WallpaperDiagnostics, String> {
    let state = app.state::<WallpaperAppState>();
    Ok(state.manager.get_diagnostics())
}

#[tauri::command]
pub async fn enable_wallpaper(
    app: AppHandle,
    req: EnableWallpaperRequest,
) -> Result<WallpaperStatus, String> {
    let pref = req.preference.unwrap_or(WallpaperHostPreference::Auto);
    let req_width = req.width.unwrap_or(480.0).max(200.0);
    let req_height = req.height.unwrap_or(640.0).max(200.0);

    let monitors = get_available_monitors(app.clone()).await?;
    let req_x = req.x.unwrap_or(100.0);
    let req_y = req.y.unwrap_or(100.0);
    let (clamped_x, clamped_y) =
        clamp_window_position(req_x, req_y, req_width, req_height, &monitors);

    let state = app.state::<WallpaperAppState>();

    // 1. Ensure window exists
    let win = if let Some(existing) = app.get_webview_window(DESKTOP_WINDOW_LABEL) {
        let _ = existing.show();
        existing
    } else {
        let cid = req.character_id.clone();
        let oid = req.outfit_id.clone();
        let pdir = req.package_dir.clone();
        let dname = req.display_name.clone();

        let query = format!(
            "index.html?window=desktop&wallpaper=true&char={}&outfit={}&pkg={}&display={}",
            urlencoding_encode(&cid),
            urlencoding_encode(&oid),
            urlencoding_encode(&pdir),
            urlencoding_encode(dname.as_deref().unwrap_or("")),
        );

        let builder =
            WebviewWindowBuilder::new(&app, DESKTOP_WINDOW_LABEL, WebviewUrl::App(query.into()))
                .title("HoloDori Desktop Character")
                .transparent(true)
                .decorations(false)
                .shadow(false)
                .always_on_top(false)
                .inner_size(req_width, req_height)
                .position(clamped_x, clamped_y)
                .resizable(true)
                .skip_taskbar(true);

        builder
            .build()
            .map_err(|e| format!("Failed to create desktop window: {e}"))?
    };

    // Always enable click-through in wallpaper mode so desktop icons receive clicks
    let _ = win.set_ignore_cursor_events(true);

    // 2. Obtain HWND
    #[cfg(target_os = "windows")]
    let child_hwnd = {
        let hwnd_res = win.hwnd();
        match hwnd_res {
            Ok(h) => h.0 as usize,
            Err(e) => return Err(format!("Failed to retrieve native HWND: {e}")),
        }
    };
    #[cfg(not(target_os = "windows"))]
    let child_hwnd = 0usize;

    // 3. Attach using WallpaperHostManager
    let scale = win.scale_factor().unwrap_or(1.0);
    let bounds = WallpaperBounds {
        x: (clamped_x * scale).round() as i32,
        y: (clamped_y * scale).round() as i32,
        width: (req_width * scale).round() as u32,
        height: (req_height * scale).round() as u32,
    };

    let status = state.manager.attach(child_hwnd, pref, bounds)?;

    // 4. If active wallpaper, start watchdog
    if status.is_wallpaper_active {
        state
            .watchdog
            .start(app.clone(), state.manager.clone(), bounds);
    }

    // 5. Notify window and main app
    let _ = app.emit("wallpaper-status-changed", &status);
    let _ = win.emit(
        "switch-model",
        serde_json::json!({
            "characterId": req.character_id,
            "outfitId": req.outfit_id,
            "packageDir": req.package_dir,
            "displayName": req.display_name,
        }),
    );

    Ok(status)
}

#[tauri::command]
pub async fn disable_wallpaper(app: AppHandle) -> Result<(), String> {
    let state = app.state::<WallpaperAppState>();
    state.watchdog.stop();
    let _ = state.manager.detach();

    if let Some(win) = app.get_webview_window(DESKTOP_WINDOW_LABEL) {
        let _ = win.destroy();
    }

    let status = state.manager.get_status();
    let _ = app.emit("wallpaper-status-changed", &status);
    Ok(())
}

#[tauri::command]
pub async fn recover_wallpaper(app: AppHandle) -> Result<WallpaperStatus, String> {
    let state = app.state::<WallpaperAppState>();

    let bounds = if let Some(win) = app.get_webview_window(DESKTOP_WINDOW_LABEL) {
        let pos = win.outer_position().unwrap_or_default();
        let size = win.inner_size().unwrap_or_default();
        WallpaperBounds {
            x: pos.x,
            y: pos.y,
            width: size.width,
            height: size.height,
        }
    } else {
        WallpaperBounds {
            x: 100,
            y: 100,
            width: 480,
            height: 640,
        }
    };

    let status = state.manager.trigger_recovery(bounds)?;
    let _ = app.emit("wallpaper-status-changed", &status);
    Ok(status)
}

#[tauri::command]
pub async fn set_wallpaper_mode(
    app: AppHandle,
    preference: WallpaperHostPreference,
) -> Result<WallpaperStatus, String> {
    let state = app.state::<WallpaperAppState>();

    if let Some(win) = app.get_webview_window(DESKTOP_WINDOW_LABEL) {
        #[cfg(target_os = "windows")]
        let child_hwnd = {
            let hwnd_res = win.hwnd();
            match hwnd_res {
                Ok(h) => h.0 as usize,
                Err(e) => return Err(format!("Failed to retrieve native HWND: {e}")),
            }
        };
        #[cfg(not(target_os = "windows"))]
        let child_hwnd = 0usize;

        let pos = win.outer_position().unwrap_or_default();
        let size = win.inner_size().unwrap_or_default();
        let bounds = WallpaperBounds {
            x: pos.x,
            y: pos.y,
            width: size.width,
            height: size.height,
        };

        // Detach previous first if attached
        let _ = state.manager.detach();

        let status = state.manager.attach(child_hwnd, preference, bounds)?;
        if status.is_wallpaper_active {
            state
                .watchdog
                .start(app.clone(), state.manager.clone(), bounds);
            let _ = win.set_always_on_top(false);
            let _ = win.set_ignore_cursor_events(true);
        } else {
            state.watchdog.stop();
            // Overlay mode
            let _ = win.set_always_on_top(true);
        }

        let _ = app.emit("wallpaper-status-changed", &status);
        Ok(status)
    } else {
        Err("Desktop character window is not open".into())
    }
}
