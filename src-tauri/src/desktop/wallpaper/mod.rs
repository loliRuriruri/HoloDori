pub mod host;
pub mod progman;
pub mod recovery;
pub mod shell;
pub mod types;
pub mod workerw;

pub use host::WallpaperHostManager;
pub use recovery::WallpaperWatchdog;
pub use types::*;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_wallpaper_status_default_is_disabled() {
        let status = WallpaperStatus::default();
        assert_eq!(status.state, WallpaperState::Disabled);
        assert_eq!(status.active_host, WallpaperHostKind::DesktopOverlay);
        assert!(!status.is_wallpaper_active);
        assert!(!status.is_fallback);
        assert!(status.host_hwnd.is_none());
    }

    #[test]
    fn test_wallpaper_state_display() {
        assert_eq!(WallpaperState::Disabled.to_string(), "DISABLED");
        assert_eq!(WallpaperState::DiscoveringHost.to_string(), "DISCOVERING_HOST");
        assert_eq!(WallpaperState::Attaching.to_string(), "ATTACHING");
        assert_eq!(WallpaperState::ActiveWorkerW.to_string(), "ACTIVE_WORKERW");
        assert_eq!(WallpaperState::ActiveProgman.to_string(), "ACTIVE_PROGMAN");
        assert_eq!(WallpaperState::FallbackOverlay.to_string(), "FALLBACK_OVERLAY");
        assert_eq!(WallpaperState::Recovering.to_string(), "RECOVERING");
        assert_eq!(WallpaperState::Error.to_string(), "ERROR");
    }

    #[test]
    fn test_fallback_overlay_never_claims_wallpaper_active() {
        let mgr = WallpaperHostManager::new();
        // Request DesktopOverlay explicitly
        let bounds = WallpaperBounds {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let status = mgr
            .attach(0x1234, WallpaperHostPreference::DesktopOverlay, bounds)
            .unwrap();

        assert_eq!(status.state, WallpaperState::FallbackOverlay);
        assert_eq!(status.active_host, WallpaperHostKind::DesktopOverlay);
        assert!(!status.is_wallpaper_active, "Fallback overlay must never claim wallpaper is active!");
        assert!(status.is_fallback);
        assert!(status.host_hwnd.is_none());
    }

    #[test]
    fn test_detach_resets_state_to_disabled() {
        let mgr = WallpaperHostManager::new();
        let bounds = WallpaperBounds {
            x: 100,
            y: 100,
            width: 800,
            height: 600,
        };
        let _ = mgr.attach(0x1234, WallpaperHostPreference::DesktopOverlay, bounds);
        assert_eq!(mgr.get_status().state, WallpaperState::FallbackOverlay);

        mgr.detach().unwrap();
        let status = mgr.get_status();
        assert_eq!(status.state, WallpaperState::Disabled);
        assert!(!status.is_wallpaper_active);
        assert!(!status.is_fallback);
    }

    #[test]
    fn test_diagnostics_structure() {
        let mgr = WallpaperHostManager::new();
        let diag = mgr.get_diagnostics();
        assert!(!diag.os_caption.is_empty());
        assert!(!diag.os_version.is_empty());
        assert!(!diag.supported_hosts.is_empty());
        assert!(diag.supported_hosts.contains(&WallpaperHostKind::DesktopOverlay));
    }
}
