use super::host::WallpaperHostManager;
use super::types::WallpaperBounds;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tracing::{info, warn};

#[derive(Default)]
pub struct WallpaperWatchdog {
    running: Arc<AtomicBool>,
}

impl WallpaperWatchdog {
    pub fn new() -> Self {
        Self {
            running: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn start(&self, app: AppHandle, manager: WallpaperHostManager, bounds: WallpaperBounds) {
        if self.running.swap(true, Ordering::SeqCst) {
            return; // Already running
        }

        let running = Arc::clone(&self.running);

        tauri::async_runtime::spawn_blocking(move || {
            info!("Wallpaper recovery watchdog started");

            while running.load(Ordering::Relaxed) {
                std::thread::sleep(Duration::from_millis(2500));
                if !running.load(Ordering::Relaxed) {
                    break;
                }

                if !manager.check_health() {
                    warn!("Wallpaper watchdog detected invalid host HWND. Attempting auto-recovery...");
                    let _ = app.emit("wallpaper-host-invalidated", ());

                    match manager.trigger_recovery(bounds) {
                        Ok(status) => {
                            info!("Wallpaper recovery finished: state={:?}", status.state);
                            let _ = app.emit("wallpaper-status-changed", &status);
                        }
                        Err(e) => {
                            warn!("Wallpaper recovery attempt failed: {e}");
                        }
                    }
                }
            }
            info!("Wallpaper recovery watchdog stopped");
        });
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }
}
