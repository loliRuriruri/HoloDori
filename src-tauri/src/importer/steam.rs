use std::path::{Path, PathBuf};
use tracing::{debug, info, warn};

use super::types::{SteamDetectionResult, SteamDetectionSource};

const HOLODORI_APP_ID: &str = "4282500";
const GAME_DIR_NAME: &str = "hololive Dreams";
const DATA_DIR_NAME: &str = "hololive Dreams_Data";
const OCTOCACHE_FILENAME: &str = "octocacheevai";

pub struct SteamDetector;

impl SteamDetector {
    /// Attempts automatic detection of HoloDori Steam installation across:
    /// 1. Windows Uninstall Registry for Steam App 4282500
    /// 2. Steam client installation path & `libraryfolders.vdf`
    /// 3. Well-known default Steam library directories
    pub fn auto_detect() -> SteamDetectionResult {
        info!(
            "Beginning automated Steam installation detection for HoloDori (AppID: {})",
            HOLODORI_APP_ID
        );

        // 1. Check registry uninstall key directly for AppID 4282500
        if let Some(path) = Self::detect_from_app_uninstall_registry() {
            if let Some(octo_path) = Self::find_octocache_in_game_dir(&path) {
                info!(
                    "Found HoloDori via App Uninstall Registry: {}",
                    path.display()
                );
                return SteamDetectionResult {
                    found: true,
                    install_path: Some(path.to_string_lossy().to_string()),
                    octocache_path: Some(octo_path.to_string_lossy().to_string()),
                    source: Some(SteamDetectionSource::Registry),
                    message: "Discovered installation via Windows Steam App registry".to_string(),
                };
            }
        }

        // 2. Discover Steam installation root and inspect libraryfolders.vdf
        if let Some(steam_root) = Self::detect_steam_root() {
            debug!("Discovered Steam root directory: {}", steam_root.display());
            let vdf_path = steam_root.join("steamapps").join("libraryfolders.vdf");
            if vdf_path.exists() {
                if let Ok(vdf_content) = std::fs::read_to_string(&vdf_path) {
                    let libraries = Self::parse_library_folders_vdf(&vdf_content);
                    for lib in libraries {
                        let candidate = lib.join("steamapps").join("common").join(GAME_DIR_NAME);
                        if let Some(octo_path) = Self::find_octocache_in_game_dir(&candidate) {
                            info!(
                                "Found HoloDori via libraryfolders.vdf in {}",
                                candidate.display()
                            );
                            return SteamDetectionResult {
                                found: true,
                                install_path: Some(candidate.to_string_lossy().to_string()),
                                octocache_path: Some(octo_path.to_string_lossy().to_string()),
                                source: Some(SteamDetectionSource::LibraryFolders),
                                message: format!(
                                    "Discovered installation via Steam library folder ({})",
                                    lib.display()
                                ),
                            };
                        }
                    }
                }
            }
        }

        // 3. Check well-known default locations across drives C..H
        for drive in ["C", "D", "E", "F", "G", "H"] {
            let candidates = [
                format!(r"{drive}:\Program Files (x86)\Steam\steamapps\common\{GAME_DIR_NAME}"),
                format!(r"{drive}:\Program Files\Steam\steamapps\common\{GAME_DIR_NAME}"),
                format!(r"{drive}:\SteamLibrary\steamapps\common\{GAME_DIR_NAME}"),
                format!(r"{drive}:\Steam\steamapps\common\{GAME_DIR_NAME}"),
                format!(r"{drive}:\Games\Steam\steamapps\common\{GAME_DIR_NAME}"),
            ];

            for candidate_str in candidates {
                let candidate = PathBuf::from(candidate_str);
                if let Some(octo_path) = Self::find_octocache_in_game_dir(&candidate) {
                    info!(
                        "Found HoloDori in common default path: {}",
                        candidate.display()
                    );
                    return SteamDetectionResult {
                        found: true,
                        install_path: Some(candidate.to_string_lossy().to_string()),
                        octocache_path: Some(octo_path.to_string_lossy().to_string()),
                        source: Some(SteamDetectionSource::CommonDefault),
                        message: "Discovered installation in standard Steam library path"
                            .to_string(),
                    };
                }
            }
        }

        warn!("Automatic Steam detection did not locate HoloDori installation");
        SteamDetectionResult {
            found: false,
            install_path: None,
            octocache_path: None,
            source: None,
            message: "HoloDori installation not automatically detected. Please select the game folder manually.".to_string(),
        }
    }

    /// Validates a user-supplied directory path (manual fallback).
    pub fn validate_path(path: &Path) -> SteamDetectionResult {
        if !path.exists() {
            return SteamDetectionResult {
                found: false,
                install_path: None,
                octocache_path: None,
                source: Some(SteamDetectionSource::ManualFallback),
                message: format!("Directory does not exist: {}", path.display()),
            };
        }

        if let Some(octo_path) = Self::find_octocache_in_game_dir(path) {
            let root = if path.file_name().is_some_and(|n| n == DATA_DIR_NAME) {
                path.parent().unwrap_or(path).to_path_buf()
            } else {
                path.to_path_buf()
            };

            return SteamDetectionResult {
                found: true,
                install_path: Some(root.to_string_lossy().to_string()),
                octocache_path: Some(octo_path.to_string_lossy().to_string()),
                source: Some(SteamDetectionSource::ManualFallback),
                message: "Valid HoloDori installation confirmed".to_string(),
            };
        }

        SteamDetectionResult {
            found: false,
            install_path: None,
            octocache_path: None,
            source: Some(SteamDetectionSource::ManualFallback),
            message: format!(
                "No '{OCTOCACHE_FILENAME}' found in selected directory: {}",
                path.display()
            ),
        }
    }

    /// Searches for `octocacheevai` within a potential game installation directory.
    pub fn find_octocache_in_game_dir(dir: &Path) -> Option<PathBuf> {
        // Direct match if passed hololive Dreams_Data
        let direct = dir.join(OCTOCACHE_FILENAME);
        if direct.is_file() {
            return Some(direct);
        }

        // Direct match if passed root hololive Dreams
        let in_data = dir.join(DATA_DIR_NAME).join(OCTOCACHE_FILENAME);
        if in_data.is_file() {
            return Some(in_data);
        }

        None
    }

    /// Queries the Windows registry for the uninstall entry of Steam App 4282500.
    fn detect_from_app_uninstall_registry() -> Option<PathBuf> {
        #[cfg(target_os = "windows")]
        {
            use std::process::Command;
            let subkey = format!(
                r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Steam App {HOLODORI_APP_ID}"
            );
            let output = Command::new("reg")
                .args(["query", &subkey, "/v", "InstallLocation"])
                .output()
                .ok()?;

            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                for line in stdout.lines() {
                    if line.contains("InstallLocation") {
                        let parts: Vec<&str> = line.split("REG_SZ").collect();
                        if parts.len() >= 2 {
                            let path_str = parts[1].trim();
                            if !path_str.is_empty() {
                                let p = PathBuf::from(path_str);
                                if p.exists() {
                                    return Some(p);
                                }
                            }
                        }
                    }
                }
            }
        }
        None
    }

    /// Queries Windows registry to locate the main Steam client root directory.
    fn detect_steam_root() -> Option<PathBuf> {
        #[cfg(target_os = "windows")]
        {
            use std::process::Command;
            // Try HKCU first
            let output = Command::new("reg")
                .args(["query", r"HKCU\Software\Valve\Steam", "/v", "SteamPath"])
                .output()
                .ok();

            if let Some(out) = output {
                if out.status.success() {
                    let stdout = String::from_utf8_lossy(&out.stdout);
                    for line in stdout.lines() {
                        if line.contains("SteamPath") {
                            let parts: Vec<&str> = line.split("REG_SZ").collect();
                            if parts.len() >= 2 {
                                let path_str = parts[1].trim();
                                if !path_str.is_empty() {
                                    let p = PathBuf::from(path_str);
                                    if p.exists() {
                                        return Some(p);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        None
    }

    /// Parses Steam's `libraryfolders.vdf` format to extract library root paths.
    pub fn parse_library_folders_vdf(content: &str) -> Vec<PathBuf> {
        let mut paths = Vec::new();
        let re = regex::Regex::new(r#""path"\s+"([^"]+)""#).ok();
        if let Some(re) = re {
            for cap in re.captures_iter(content) {
                if let Some(m) = cap.get(1) {
                    let unescaped = m.as_str().replace(r"\\", r"\");
                    let p = PathBuf::from(unescaped);
                    if p.exists() && !paths.contains(&p) {
                        paths.push(p);
                    }
                }
            }
        }
        paths
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_parse_library_folders_vdf() {
        let sample_vdf = r#"
        "libraryfolders"
        {
            "0"
            {
                "path"		"C:\\Program Files (x86)\\Steam"
                "label"		""
            }
            "1"
            {
                "path"		"D:\\SteamLibrary"
                "label"		"Games"
            }
        }
        "#;
        // Since C: and D: may or may not exist on arbitrary build systems, we verify regex extraction
        let re = regex::Regex::new(r#""path"\s+"([^"]+)""#).unwrap();
        let captured: Vec<String> = re
            .captures_iter(sample_vdf)
            .map(|c| c.get(1).unwrap().as_str().replace(r"\\", r"\"))
            .collect();
        assert_eq!(captured.len(), 2);
        assert_eq!(captured[0], r"C:\Program Files (x86)\Steam");
        assert_eq!(captured[1], r"D:\SteamLibrary");
    }

    #[test]
    fn test_find_octocache_in_game_dir() {
        let dir = tempdir().unwrap();
        let game_dir = dir.path().join("hololive Dreams");
        let data_dir = game_dir.join("hololive Dreams_Data");
        std::fs::create_dir_all(&data_dir).unwrap();
        let octo_file = data_dir.join("octocacheevai");
        std::fs::write(&octo_file, b"test").unwrap();

        // Check finding from root
        let found = SteamDetector::find_octocache_in_game_dir(&game_dir);
        assert_eq!(found, Some(octo_file.clone()));

        // Check finding from data dir
        let found_data = SteamDetector::find_octocache_in_game_dir(&data_dir);
        assert_eq!(found_data, Some(octo_file));

        // Check non-existent
        let empty = dir.path().join("empty");
        std::fs::create_dir_all(&empty).unwrap();
        assert_eq!(SteamDetector::find_octocache_in_game_dir(&empty), None);
    }

    #[test]
    fn test_validate_path() {
        let dir = tempdir().unwrap();
        let game_dir = dir.path().join("hololive Dreams");
        let data_dir = game_dir.join("hololive Dreams_Data");
        std::fs::create_dir_all(&data_dir).unwrap();
        let octo_file = data_dir.join("octocacheevai");
        std::fs::write(&octo_file, b"test").unwrap();

        let result = SteamDetector::validate_path(&game_dir);
        assert!(result.found);
        assert!(result.octocache_path.is_some());

        let invalid = dir.path().join("invalid");
        let result_invalid = SteamDetector::validate_path(&invalid);
        assert!(!result_invalid.found);
    }
}
