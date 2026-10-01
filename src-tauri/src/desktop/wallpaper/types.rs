use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum WallpaperHostKind {
    WorkerW,
    Progman,
    #[default]
    DesktopOverlay,
}

impl std::fmt::Display for WallpaperHostKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::WorkerW => write!(f, "WorkerW"),
            Self::Progman => write!(f, "Progman"),
            Self::DesktopOverlay => write!(f, "DesktopOverlay"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum WallpaperState {
    #[default]
    Disabled,
    DiscoveringHost,
    Attaching,
    ActiveWorkerW,
    ActiveProgman,
    FallbackOverlay,
    Recovering,
    Error,
}

impl std::fmt::Display for WallpaperState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Disabled => write!(f, "DISABLED"),
            Self::DiscoveringHost => write!(f, "DISCOVERING_HOST"),
            Self::Attaching => write!(f, "ATTACHING"),
            Self::ActiveWorkerW => write!(f, "ACTIVE_WORKERW"),
            Self::ActiveProgman => write!(f, "ACTIVE_PROGMAN"),
            Self::FallbackOverlay => write!(f, "FALLBACK_OVERLAY"),
            Self::Recovering => write!(f, "RECOVERING"),
            Self::Error => write!(f, "ERROR"),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum WallpaperHostPreference {
    #[default]
    Auto,
    WorkerW,
    Progman,
    DesktopOverlay,
}


#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WallpaperTopology {
    ModernWin11ChildWorkerW,
    LegacyWin10SiblingWorkerW,
    ProgmanDirect,
    Unknown,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WallpaperHostInfo {
    pub host_kind: WallpaperHostKind,
    pub host_hwnd: usize,
    pub host_hwnd_hex: String,
    pub progman_hwnd: usize,
    pub defview_hwnd: usize,
    pub workerw_hwnd: Option<usize>,
    pub topology: WallpaperTopology,
    pub explorer_pid: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WallpaperStatus {
    pub state: WallpaperState,
    pub active_host: WallpaperHostKind,
    pub host_hwnd: Option<String>,
    pub is_wallpaper_active: bool,
    pub is_fallback: bool,
    pub error_message: Option<String>,
    pub timestamp_utc: String,
}

impl Default for WallpaperStatus {
    fn default() -> Self {
        Self {
            state: WallpaperState::Disabled,
            active_host: WallpaperHostKind::DesktopOverlay,
            host_hwnd: None,
            is_wallpaper_active: false,
            is_fallback: false,
            error_message: None,
            timestamp_utc: chrono::Utc::now().to_rfc3339(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WallpaperDiagnostics {
    pub os_caption: String,
    pub os_version: String,
    pub build_number: String,
    pub display_version: String,
    pub explorer_version: String,
    pub topology: WallpaperTopology,
    pub status: WallpaperStatus,
    pub host_info: Option<WallpaperHostInfo>,
    pub supported_hosts: Vec<WallpaperHostKind>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct WallpaperBounds {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}
