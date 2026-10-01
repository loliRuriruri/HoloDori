use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder,
};

pub const DESKTOP_WINDOW_LABEL: &str = "desktop_character";
pub const MAIN_WINDOW_LABEL: &str = "main";

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
pub struct MonitorInfo {
    pub name: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub is_primary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DesktopWindowState {
    pub is_open: bool,
    pub is_visible: bool,
    pub click_through: bool,
    pub always_on_top: bool,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Clamps window position so it never restores completely off-screen.
/// If outside all monitors, clamps to primary monitor's bottom-right corner.
pub fn clamp_window_position(
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    monitors: &[MonitorInfo],
) -> (f64, f64) {
    if monitors.is_empty() {
        return (x.max(0.0), y.max(0.0));
    }

    // Check overlap with any monitor
    let min_visible_margin = 60.0;
    let mut overlaps_any = false;

    for m in monitors {
        let mx = m.x as f64;
        let my = m.y as f64;
        let mw = m.width as f64;
        let mh = m.height as f64;

        let overlap_x = (x < mx + mw - min_visible_margin) && (x + width > mx + min_visible_margin);
        let overlap_y =
            (y < my + mh - min_visible_margin) && (y + height > my + min_visible_margin);

        if overlap_x && overlap_y {
            overlaps_any = true;
            break;
        }
    }

    if overlaps_any {
        (x, y)
    } else {
        // Fall back to primary or first monitor bottom-right
        let target = monitors
            .iter()
            .find(|m| m.is_primary)
            .unwrap_or(&monitors[0]);
        let safe_x = (target.x as f64 + target.width as f64 - width - 40.0).max(target.x as f64);
        let safe_y = (target.y as f64 + target.height as f64 - height - 60.0).max(target.y as f64);
        (safe_x, safe_y)
    }
}

pub struct DesktopState {
    pub click_through: Arc<AtomicBool>,
    pub always_on_top: Arc<AtomicBool>,
    pub paused: Arc<AtomicBool>,
}

impl Default for DesktopState {
    fn default() -> Self {
        Self {
            click_through: Arc::new(AtomicBool::new(false)),
            always_on_top: Arc::new(AtomicBool::new(true)),
            paused: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[tauri::command]
pub async fn get_available_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let mut result = Vec::new();
    if let Ok(monitors) = app.available_monitors() {
        let primary = app.primary_monitor().ok().flatten();
        let primary_name = primary.as_ref().and_then(|p| p.name());

        for m in monitors {
            let name = m.name().cloned().unwrap_or_else(|| "Display".into());
            let is_primary = primary_name == Some(&name);
            let pos = m.position();
            let size = m.size();
            let scale_factor = m.scale_factor();

            result.push(MonitorInfo {
                name,
                x: pos.x,
                y: pos.y,
                width: size.width,
                height: size.height,
                scale_factor,
                is_primary,
            });
        }
    }
    Ok(result)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OpenDesktopWindowRequest {
    pub character_id: String,
    pub outfit_id: String,
    pub package_dir: String,
    pub display_name: Option<String>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub always_on_top: Option<bool>,
    pub click_through: Option<bool>,
}

#[tauri::command]
pub async fn get_desktop_window_state(app: AppHandle) -> Result<DesktopWindowState, String> {
    if let Some(win) = app.get_webview_window(DESKTOP_WINDOW_LABEL) {
        let is_visible = win.is_visible().unwrap_or(false);
        let pos = win.outer_position().unwrap_or_default();
        let size = win.inner_size().unwrap_or_default();
        let scale = win.scale_factor().unwrap_or(1.0);

        let state = app.state::<DesktopState>();

        Ok(DesktopWindowState {
            is_open: true,
            is_visible,
            click_through: state.click_through.load(Ordering::Relaxed),
            always_on_top: state.always_on_top.load(Ordering::Relaxed),
            x: pos.x as f64 / scale,
            y: pos.y as f64 / scale,
            width: size.width as f64 / scale,
            height: size.height as f64 / scale,
        })
    } else {
        Ok(DesktopWindowState {
            is_open: false,
            is_visible: false,
            click_through: false,
            always_on_top: true,
            x: 100.0,
            y: 100.0,
            width: 480.0,
            height: 640.0,
        })
    }
}

#[tauri::command]
pub async fn open_desktop_window(
    app: AppHandle,
    req: OpenDesktopWindowRequest,
) -> Result<DesktopWindowState, String> {
    let aot = req.always_on_top.unwrap_or(true);
    let ct = req.click_through.unwrap_or(false);
    let req_width = req.width.unwrap_or(480.0).max(200.0);
    let req_height = req.height.unwrap_or(640.0).max(200.0);

    // Clamp coordinates against active monitors
    let monitors = get_available_monitors(app.clone()).await?;
    let req_x = req.x.unwrap_or(100.0);
    let req_y = req.y.unwrap_or(100.0);
    let (clamped_x, clamped_y) =
        clamp_window_position(req_x, req_y, req_width, req_height, &monitors);

    let state = app.state::<DesktopState>();
    state.always_on_top.store(aot, Ordering::Relaxed);
    state.click_through.store(ct, Ordering::Relaxed);

    if let Some(existing) = app.get_webview_window(DESKTOP_WINDOW_LABEL) {
        // Window already exists: update model target and show
        let _ = existing.show();
        let _ = existing.set_always_on_top(aot);
        let _ = existing.set_ignore_cursor_events(ct);

        // Notify window of new target
        let _ = existing.emit(
            "switch-model",
            serde_json::json!({
                "characterId": req.character_id,
                "outfitId": req.outfit_id,
                "packageDir": req.package_dir,
                "displayName": req.display_name,
            }),
        );

        return get_desktop_window_state(app).await;
    }

    let cid = req.character_id.clone();
    let oid = req.outfit_id.clone();
    let pdir = req.package_dir.clone();
    let dname = req.display_name.clone();

    let query = format!(
        "index.html?window=desktop&char={}&outfit={}&pkg={}&display={}",
        urlencoding_encode(&cid),
        urlencoding_encode(&oid),
        urlencoding_encode(&pdir),
        urlencoding_encode(dname.as_deref().unwrap_or("")),
    );

    // Build new transparent desktop window
    let builder =
        WebviewWindowBuilder::new(&app, DESKTOP_WINDOW_LABEL, WebviewUrl::App(query.into()))
            .title("HoloDori Desktop Character")
            .transparent(true)
            .decorations(false)
            .shadow(false)
            .always_on_top(aot)
            .inner_size(req_width, req_height)
            .position(clamped_x, clamped_y)
            .resizable(true)
            .skip_taskbar(true);

    let win = builder
        .build()
        .map_err(|e| format!("Failed to create desktop window: {e}"))?;

    if ct {
        let _ = win.set_ignore_cursor_events(true);
    }

    let win_clone = win.clone();
    tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(std::time::Duration::from_millis(500));
        let _ = win_clone.emit(
            "switch-model",
            serde_json::json!({
                "characterId": cid,
                "outfitId": oid,
                "packageDir": pdir,
                "displayName": dname,
            }),
        );
    });

    get_desktop_window_state(app).await
}

#[tauri::command]
pub async fn close_desktop_window(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(DESKTOP_WINDOW_LABEL) {
        win.destroy()
            .map_err(|e| format!("Failed to destroy desktop window: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn set_desktop_click_through(app: AppHandle, click_through: bool) -> Result<(), String> {
    let state = app.state::<DesktopState>();
    state.click_through.store(click_through, Ordering::Relaxed);

    if let Some(win) = app.get_webview_window(DESKTOP_WINDOW_LABEL) {
        win.set_ignore_cursor_events(click_through)
            .map_err(|e| format!("Failed to set ignore_cursor_events: {e}"))?;
        let _ = win.emit("click-through-changed", click_through);
    }
    // Also notify main window so UI reflects state
    let _ = app.emit("desktop-click-through-changed", click_through);
    Ok(())
}

#[tauri::command]
pub async fn set_desktop_always_on_top(app: AppHandle, always_on_top: bool) -> Result<(), String> {
    let state = app.state::<DesktopState>();
    state.always_on_top.store(always_on_top, Ordering::Relaxed);

    if let Some(win) = app.get_webview_window(DESKTOP_WINDOW_LABEL) {
        win.set_always_on_top(always_on_top)
            .map_err(|e| format!("Failed to set always_on_top: {e}"))?;
        let _ = win.emit("always-on-top-changed", always_on_top);
    }
    let _ = app.emit("desktop-always-on-top-changed", always_on_top);
    Ok(())
}

#[tauri::command]
pub async fn set_desktop_bounds(
    app: AppHandle,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(DESKTOP_WINDOW_LABEL) {
        let scale = win.scale_factor().unwrap_or(1.0);
        let phys_pos =
            PhysicalPosition::new((x * scale).round() as i32, (y * scale).round() as i32);
        let phys_size = PhysicalSize::new(
            (width * scale).round() as u32,
            (height * scale).round() as u32,
        );

        let _ = win.set_position(phys_pos);
        let _ = win.set_size(phys_size);
    }
    Ok(())
}

#[tauri::command]
pub async fn send_desktop_control(
    app: AppHandle,
    action: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(DESKTOP_WINDOW_LABEL) {
        win.emit(
            "desktop-action",
            serde_json::json!({
                "action": action,
                "payload": payload,
            }),
        )
        .map_err(|e| format!("Failed to emit desktop-action: {e}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clamp_window_position_inside() {
        let monitors = vec![MonitorInfo {
            name: "Display 1".into(),
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
            is_primary: true,
        }];

        let (x, y) = clamp_window_position(200.0, 200.0, 400.0, 600.0, &monitors);
        assert_eq!(x, 200.0);
        assert_eq!(y, 200.0);
    }

    #[test]
    fn test_clamp_window_position_offscreen_falls_back() {
        let monitors = vec![MonitorInfo {
            name: "Display 1".into(),
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
            is_primary: true,
        }];

        // Completely outside (-5000, -5000)
        let (x, y) = clamp_window_position(-5000.0, -5000.0, 400.0, 600.0, &monitors);
        // Must fall back to safe bottom-right inside primary monitor
        assert_eq!(x, 1920.0 - 400.0 - 40.0);
        assert_eq!(y, 1080.0 - 600.0 - 60.0);
    }

    #[test]
    fn test_clamp_window_multi_monitor() {
        let monitors = vec![
            MonitorInfo {
                name: "Display 1 (Primary)".into(),
                x: 0,
                y: 0,
                width: 1920,
                height: 1080,
                scale_factor: 1.0,
                is_primary: true,
            },
            MonitorInfo {
                name: "Display 2 (Right)".into(),
                x: 1920,
                y: 0,
                width: 1920,
                height: 1080,
                scale_factor: 1.0,
                is_primary: false,
            },
        ];

        // Valid on secondary monitor
        let (x, y) = clamp_window_position(2100.0, 150.0, 400.0, 600.0, &monitors);
        assert_eq!(x, 2100.0);
        assert_eq!(y, 150.0);
    }
}
