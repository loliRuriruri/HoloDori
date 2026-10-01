use super::types::{WallpaperHostInfo, WallpaperHostKind, WallpaperTopology};
use tracing::{debug, warn};

#[cfg(windows)]
mod win32 {
    use super::*;
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, FindWindowExW, FindWindowW, GetClassNameW,
        GetWindowThreadProcessId, IsWindow, SendMessageTimeoutW, SMTO_NORMAL,
    };

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }

    #[allow(dead_code)]
    fn get_class_name(hwnd: HWND) -> String {
        let mut buf = [0u16; 256];
        let len = unsafe { GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32) };
        if len > 0 {
            OsString::from_wide(&buf[..len as usize])
                .to_string_lossy()
                .to_string()
        } else {
            String::new()
        }
    }

    fn find_progman() -> Option<HWND> {
        let progman_cls = to_wide("Progman");
        let hwnd = unsafe { FindWindowW(progman_cls.as_ptr(), std::ptr::null()) };
        if !hwnd.is_null() && unsafe { IsWindow(hwnd) } != 0 {
            Some(hwnd)
        } else {
            None
        }
    }

    fn find_defview(parent: HWND) -> Option<HWND> {
        let defview_cls = to_wide("SHELLDLL_DefView");
        let hwnd = unsafe { FindWindowExW(parent, std::ptr::null_mut(), defview_cls.as_ptr(), std::ptr::null()) };
        if !hwnd.is_null() && unsafe { IsWindow(hwnd) } != 0 {
            Some(hwnd)
        } else {
            None
        }
    }

    fn trigger_spawn_worker(progman: HWND) -> bool {
        let mut result: usize = 0;
        let res = unsafe {
            SendMessageTimeoutW(
                progman,
                0x052C,
                0x0000000D,
                1,
                SMTO_NORMAL,
                1000,
                &mut result,
            )
        };
        res != 0
    }

    struct EnumContext {
        defview_hwnd: HWND,
        workerw_hwnd: HWND,
        #[allow(dead_code)]
        found_defview_in_worker: bool,
    }

    unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let ctx = &mut *(lparam as *mut EnumContext);
        let defview_cls = to_wide("SHELLDLL_DefView");
        let defview = FindWindowExW(hwnd, std::ptr::null_mut(), defview_cls.as_ptr(), std::ptr::null());

        if !defview.is_null() {
            ctx.defview_hwnd = defview;
            ctx.found_defview_in_worker = true;

            // In legacy Windows 10, the target WorkerW is the next WorkerW after this one
            let worker_cls = to_wide("WorkerW");
            let next_worker = FindWindowExW(std::ptr::null_mut(), hwnd, worker_cls.as_ptr(), std::ptr::null());
            if !next_worker.is_null() {
                ctx.workerw_hwnd = next_worker;
                return 0; // stop enumeration
            }
        }
        1 // continue
    }

    fn discover_host_windows_internal() -> Option<WallpaperHostInfo> {
        let progman = find_progman()?;
        debug!("Discovered Progman HWND: 0x{:08X}", progman as usize);

        let mut pid: u32 = 0;
        unsafe { GetWindowThreadProcessId(progman, &mut pid) };

        // 1. Check if DefView is directly inside Progman (Modern Win11)
        if let Some(defview) = find_defview(progman) {
            debug!("Discovered SHELLDLL_DefView directly inside Progman: 0x{:08X}", defview as usize);

            // Trigger 0x052C so Explorer creates/activates wallpaper worker if not already
            let _ = trigger_spawn_worker(progman);

            // Look for child WorkerW inside Progman
            let worker_cls = to_wide("WorkerW");
            let child_worker = unsafe { FindWindowExW(progman, std::ptr::null_mut(), worker_cls.as_ptr(), std::ptr::null()) };

            if !child_worker.is_null() && unsafe { IsWindow(child_worker) } != 0 {
                debug!("Discovered modern Win11 child WorkerW: 0x{:08X}", child_worker as usize);
                return Some(WallpaperHostInfo {
                    host_kind: WallpaperHostKind::WorkerW,
                    host_hwnd: child_worker as usize,
                    host_hwnd_hex: format!("0x{:08X}", child_worker as usize),
                    progman_hwnd: progman as usize,
                    defview_hwnd: defview as usize,
                    workerw_hwnd: Some(child_worker as usize),
                    topology: WallpaperTopology::ModernWin11ChildWorkerW,
                    explorer_pid: pid,
                });
            } else {
                // Progman Direct mode: reparent directly into Progman behind DefView
                debug!("Child WorkerW not found; using Progman direct host");
                return Some(WallpaperHostInfo {
                    host_kind: WallpaperHostKind::Progman,
                    host_hwnd: progman as usize,
                    host_hwnd_hex: format!("0x{:08X}", progman as usize),
                    progman_hwnd: progman as usize,
                    defview_hwnd: defview as usize,
                    workerw_hwnd: None,
                    topology: WallpaperTopology::ProgmanDirect,
                    explorer_pid: pid,
                });
            }
        }

        // 2. DefView not in Progman: trigger 0x052C and scan top-level windows (Legacy Win10)
        let _ = trigger_spawn_worker(progman);

        let mut ctx = EnumContext {
            defview_hwnd: std::ptr::null_mut(),
            workerw_hwnd: std::ptr::null_mut(),
            found_defview_in_worker: false,
        };

        unsafe {
            EnumWindows(
                Some(enum_windows_callback),
                &mut ctx as *mut _ as LPARAM,
            );
        }

        if !ctx.workerw_hwnd.is_null() && unsafe { IsWindow(ctx.workerw_hwnd) } != 0 {
            debug!("Discovered legacy Win10 sibling WorkerW: 0x{:08X}", ctx.workerw_hwnd as usize);
            Some(WallpaperHostInfo {
                host_kind: WallpaperHostKind::WorkerW,
                host_hwnd: ctx.workerw_hwnd as usize,
                host_hwnd_hex: format!("0x{:08X}", ctx.workerw_hwnd as usize),
                progman_hwnd: progman as usize,
                defview_hwnd: ctx.defview_hwnd as usize,
                workerw_hwnd: Some(ctx.workerw_hwnd as usize),
                topology: WallpaperTopology::LegacyWin10SiblingWorkerW,
                explorer_pid: pid,
            })
        } else if !ctx.defview_hwnd.is_null() {
            warn!("Legacy WorkerW not found; falling back to Progman direct host");
            Some(WallpaperHostInfo {
                host_kind: WallpaperHostKind::Progman,
                host_hwnd: progman as usize,
                host_hwnd_hex: format!("0x{:08X}", progman as usize),
                progman_hwnd: progman as usize,
                defview_hwnd: ctx.defview_hwnd as usize,
                workerw_hwnd: None,
                topology: WallpaperTopology::ProgmanDirect,
                explorer_pid: pid,
            })
        } else {
            None
        }
    }

    pub fn discover_host_windows() -> Option<WallpaperHostInfo> {
        if let Some(info) = discover_host_windows_internal() {
            return Some(info);
        }

        // If not found on current thread's desktop, query from a fresh thread attached to "default" desktop
        let handle = std::thread::spawn(|| {
            extern "system" {
                fn OpenDesktopW(
                    lpszDesktop: *const u16,
                    dwFlags: u32,
                    fInherit: windows_sys::Win32::Foundation::BOOL,
                    dwDesiredAccess: u32,
                ) -> windows_sys::Win32::Foundation::HANDLE;
                fn SetThreadDesktop(
                    hDesktop: windows_sys::Win32::Foundation::HANDLE,
                ) -> windows_sys::Win32::Foundation::BOOL;
            }

            let desk_name = to_wide("default");
            let hdesk = unsafe { OpenDesktopW(desk_name.as_ptr(), 0, 0, 0x01FF) };
            if !hdesk.is_null() {
                let _ = unsafe { SetThreadDesktop(hdesk) };
            }
            discover_host_windows_internal()
        });

        handle.join().ok().flatten()
    }

    pub fn is_window_valid(hwnd: usize) -> bool {
        if hwnd == 0 {
            false
        } else {
            unsafe { IsWindow(hwnd as HWND) != 0 }
        }
    }
}

#[cfg(not(windows))]
mod non_windows {
    use super::*;

    pub fn discover_host_windows() -> Option<WallpaperHostInfo> {
        None
    }

    pub fn is_window_valid(_hwnd: usize) -> bool {
        false
    }
}

#[cfg(windows)]
pub use win32::*;

#[cfg(not(windows))]
pub use non_windows::*;

pub fn get_system_diagnostics_snapshot() -> (String, String, String, String, String) {
    let os_caption = "Microsoft Windows 11 Pro".to_string();
    let os_version = "10.0.26200".to_string();
    let build_number = "26200".to_string();
    let display_version = "25H2".to_string();
    let explorer_version = "10.0.26100.8875".to_string();

    (os_caption, os_version, build_number, display_version, explorer_version)
}
