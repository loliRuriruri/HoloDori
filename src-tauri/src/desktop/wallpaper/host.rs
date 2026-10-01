use std::sync::{Arc, Mutex};
use super::progman;
use super::shell::{discover_host_windows, get_system_diagnostics_snapshot, is_window_valid};
use super::types::{
    WallpaperBounds, WallpaperDiagnostics, WallpaperHostInfo, WallpaperHostKind,
    WallpaperHostPreference, WallpaperState, WallpaperStatus, WallpaperTopology,
};
use super::workerw::{self, OriginalWindowStyles};
use tracing::{info, warn};

#[derive(Default)]
pub struct HostStateInner {
    pub state: WallpaperState,
    pub active_host: WallpaperHostKind,
    pub active_child_hwnd: Option<usize>,
    pub active_host_hwnd: Option<usize>,
    pub original_styles: Option<OriginalWindowStyles>,
    pub host_info: Option<WallpaperHostInfo>,
    pub preference: WallpaperHostPreference,
    pub last_error: Option<String>,
}

#[derive(Clone, Default)]
pub struct WallpaperHostManager {
    inner: Arc<Mutex<HostStateInner>>,
}

impl WallpaperHostManager {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(HostStateInner {
                state: WallpaperState::Disabled,
                active_host: WallpaperHostKind::DesktopOverlay,
                active_child_hwnd: None,
                active_host_hwnd: None,
                original_styles: None,
                host_info: None,
                preference: WallpaperHostPreference::Auto,
                last_error: None,
            })),
        }
    }

    pub fn get_status(&self) -> WallpaperStatus {
        let guard = self.inner.lock().unwrap();
        let is_wallpaper_active = matches!(
            guard.state,
            WallpaperState::ActiveWorkerW | WallpaperState::ActiveProgman
        );
        let is_fallback = guard.state == WallpaperState::FallbackOverlay;

        WallpaperStatus {
            state: guard.state,
            active_host: guard.active_host,
            host_hwnd: guard.active_host_hwnd.map(|h| format!("0x{:08X}", h)),
            is_wallpaper_active,
            is_fallback,
            error_message: guard.last_error.clone(),
            timestamp_utc: chrono::Utc::now().to_rfc3339(),
        }
    }

    pub fn get_diagnostics(&self) -> WallpaperDiagnostics {
        let guard = self.inner.lock().unwrap();
        let (os_caption, os_version, build_number, display_version, explorer_version) =
            get_system_diagnostics_snapshot();

        let topology = guard
            .host_info
            .as_ref()
            .map(|h| h.topology)
            .unwrap_or(WallpaperTopology::Unknown);

        let is_wallpaper_active = matches!(
            guard.state,
            WallpaperState::ActiveWorkerW | WallpaperState::ActiveProgman
        );
        let is_fallback = guard.state == WallpaperState::FallbackOverlay;

        let status = WallpaperStatus {
            state: guard.state,
            active_host: guard.active_host,
            host_hwnd: guard.active_host_hwnd.map(|h| format!("0x{:08X}", h)),
            is_wallpaper_active,
            is_fallback,
            error_message: guard.last_error.clone(),
            timestamp_utc: chrono::Utc::now().to_rfc3339(),
        };

        let mut supported_hosts = vec![WallpaperHostKind::DesktopOverlay];
        #[cfg(windows)]
        {
            supported_hosts.insert(0, WallpaperHostKind::Progman);
            supported_hosts.insert(0, WallpaperHostKind::WorkerW);
        }

        WallpaperDiagnostics {
            os_caption,
            os_version,
            build_number,
            display_version,
            explorer_version,
            topology,
            status,
            host_info: guard.host_info.clone(),
            supported_hosts,
        }
    }

    pub fn attach(
        &self,
        child_hwnd: usize,
        pref: WallpaperHostPreference,
        bounds: WallpaperBounds,
    ) -> Result<WallpaperStatus, String> {
        let mut guard = self.inner.lock().unwrap();
        guard.preference = pref;
        guard.active_child_hwnd = Some(child_hwnd);
        guard.state = WallpaperState::DiscoveringHost;

        info!(
            "Attempting to attach wallpaper for child HWND 0x{:08X} with preference {:?}",
            child_hwnd, pref
        );

        if pref == WallpaperHostPreference::DesktopOverlay {
            guard.state = WallpaperState::FallbackOverlay;
            guard.active_host = WallpaperHostKind::DesktopOverlay;
            guard.active_host_hwnd = None;
            guard.last_error = None;
            drop(guard);
            return Ok(self.get_status());
        }

        #[cfg(not(windows))]
        {
            guard.state = WallpaperState::FallbackOverlay;
            guard.active_host = WallpaperHostKind::DesktopOverlay;
            guard.last_error = Some("Wallpaper host reparenting only supported on Windows".into());
            drop(guard);
            return Ok(self.get_status());
        }

        #[cfg(windows)]
        {
            guard.state = WallpaperState::DiscoveringHost;
            let discovered = discover_host_windows();

            if let Some(host_info) = discovered {
                guard.host_info = Some(host_info.clone());
                guard.state = WallpaperState::Attaching;

                // Priority 1: Try WorkerW if preferred or Auto
                let can_try_workerw = (pref == WallpaperHostPreference::Auto
                    || pref == WallpaperHostPreference::WorkerW)
                    && host_info.workerw_hwnd.is_some();

                if can_try_workerw {
                    let workerw_hwnd = host_info.workerw_hwnd.unwrap();
                    match workerw::attach(child_hwnd, workerw_hwnd, bounds) {
                        Ok(orig) => {
                            guard.state = WallpaperState::ActiveWorkerW;
                            guard.active_host = WallpaperHostKind::WorkerW;
                            guard.active_host_hwnd = Some(workerw_hwnd);
                            guard.original_styles = Some(orig);
                            guard.last_error = None;
                            info!("Successfully established True Wallpaper on WorkerW host");
                            drop(guard);
                            return Ok(self.get_status());
                        }
                        Err(e) => {
                            warn!("WorkerW attachment failed: {e}. Checking fallback...");
                            guard.last_error = Some(format!("WorkerW failed: {e}"));
                            if pref == WallpaperHostPreference::WorkerW {
                                // Specific preference requested and failed -> fallback to overlay
                                guard.state = WallpaperState::FallbackOverlay;
                                guard.active_host = WallpaperHostKind::DesktopOverlay;
                                drop(guard);
                                return Ok(self.get_status());
                            }
                        }
                    }
                }

                // Priority 2: Try Progman Compatibility if Auto or Progman
                let can_try_progman = pref == WallpaperHostPreference::Auto
                    || pref == WallpaperHostPreference::Progman;

                if can_try_progman && host_info.progman_hwnd != 0 {
                    match progman::attach(
                        child_hwnd,
                        host_info.progman_hwnd,
                        host_info.defview_hwnd,
                        bounds,
                    ) {
                        Ok(orig) => {
                            guard.state = WallpaperState::ActiveProgman;
                            guard.active_host = WallpaperHostKind::Progman;
                            guard.active_host_hwnd = Some(host_info.progman_hwnd);
                            guard.original_styles = Some(orig);
                            guard.last_error = None;
                            info!("Successfully established True Wallpaper on Progman host");
                            drop(guard);
                            return Ok(self.get_status());
                        }
                        Err(e) => {
                            warn!("Progman attachment failed: {e}. Falling back to overlay...");
                            guard.last_error = Some(format!("Progman failed: {e}"));
                        }
                    }
                }
            } else {
                warn!("No compatible Explorer wallpaper host discovered");
                guard.last_error = Some("Explorer shell wallpaper host window not found".into());
            }

            // Priority 3: Fallback to Desktop Overlay
            info!("Engaging Desktop Overlay Fallback mode");
            guard.state = WallpaperState::FallbackOverlay;
            guard.active_host = WallpaperHostKind::DesktopOverlay;
            guard.active_host_hwnd = None;
            drop(guard);
            Ok(self.get_status())
        }
    }

    pub fn detach(&self) -> Result<(), String> {
        let mut guard = self.inner.lock().unwrap();
        if let (Some(child), Some(orig)) = (guard.active_child_hwnd, guard.original_styles) {
            #[cfg(windows)]
            {
                let _ = workerw::detach(child, orig);
            }
        }
        guard.state = WallpaperState::Disabled;
        guard.active_host = WallpaperHostKind::DesktopOverlay;
        guard.active_child_hwnd = None;
        guard.active_host_hwnd = None;
        guard.original_styles = None;
        guard.last_error = None;
        info!("Wallpaper mode disabled and window detached");
        Ok(())
    }

    pub fn check_health(&self) -> bool {
        let guard = self.inner.lock().unwrap();
        if !matches!(
            guard.state,
            WallpaperState::ActiveWorkerW | WallpaperState::ActiveProgman
        ) {
            return true;
        }

        if let Some(host_hwnd) = guard.active_host_hwnd {
            is_window_valid(host_hwnd)
        } else {
            false
        }
    }

    pub fn trigger_recovery(&self, bounds: WallpaperBounds) -> Result<WallpaperStatus, String> {
        let (child, pref) = {
            let mut guard = self.inner.lock().unwrap();
            guard.state = WallpaperState::Recovering;
            (guard.active_child_hwnd, guard.preference)
        };

        if let Some(child_hwnd) = child {
            warn!("Triggering wallpaper recovery for window 0x{:08X}", child_hwnd);
            self.attach(child_hwnd, pref, bounds)
        } else {
            Err("No active window to recover".into())
        }
    }
}
