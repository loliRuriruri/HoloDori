use super::types::WallpaperBounds;
use tracing::{debug, info};

#[derive(Debug, Clone, Copy, Default)]
pub struct OriginalWindowStyles {
    pub style: i32,
    pub ex_style: i32,
    pub parent: usize,
}

#[cfg(windows)]
mod win32 {
    use super::*;
    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetParent, GetWindowLongW, SetParent, SetWindowLongW, SetWindowPos, GWL_EXSTYLE,
        GWL_STYLE, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
        SWP_SHOWWINDOW, WS_CHILD, WS_CLIPSIBLINGS, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
        WS_EX_TRANSPARENT, WS_POPUP, WS_VISIBLE,
    };

    pub fn attach(
        child_raw: usize,
        workerw_raw: usize,
        bounds: WallpaperBounds,
    ) -> Result<OriginalWindowStyles, String> {
        let child = child_raw as HWND;
        let workerw = workerw_raw as HWND;

        unsafe {
            let orig_style = GetWindowLongW(child, GWL_STYLE);
            let orig_ex_style = GetWindowLongW(child, GWL_EXSTYLE);
            let orig_parent = GetParent(child) as usize;

            let orig = OriginalWindowStyles {
                style: orig_style,
                ex_style: orig_ex_style,
                parent: orig_parent,
            };

            // Convert to child window of WorkerW
            let new_style = (orig_style & !(WS_POPUP as i32)) | (WS_CHILD | WS_VISIBLE | WS_CLIPSIBLINGS) as i32;
            let new_ex_style = orig_ex_style
                | (WS_EX_TRANSPARENT | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW) as i32;

            SetWindowLongW(child, GWL_STYLE, new_style);
            SetWindowLongW(child, GWL_EXSTYLE, new_ex_style);

            let set_parent_res = SetParent(child, workerw);
            if set_parent_res.is_null() && orig_parent == 0 {
                let cur_parent = GetParent(child);
                if cur_parent != workerw {
                    return Err(format!(
                        "SetParent failed to reparent window to WorkerW 0x{:08X}",
                        workerw_raw
                    ));
                }
            }

            // Position and resize inside WorkerW
            let flags = SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW;
            SetWindowPos(
                child,
                std::ptr::null_mut(),
                bounds.x,
                bounds.y,
                bounds.width as i32,
                bounds.height as i32,
                flags,
            );

            info!(
                "Successfully attached window 0x{:08X} to WorkerW 0x{:08X} at ({}, {}) [{}x{}]",
                child_raw, workerw_raw, bounds.x, bounds.y, bounds.width, bounds.height
            );

            Ok(orig)
        }
    }

    pub fn detach(child_raw: usize, orig: OriginalWindowStyles) -> Result<(), String> {
        let child = child_raw as HWND;
        unsafe {
            debug!("Detaching window 0x{:08X} from wallpaper host", child_raw);
            SetParent(child, orig.parent as HWND);
            SetWindowLongW(child, GWL_STYLE, orig.style);
            SetWindowLongW(child, GWL_EXSTYLE, orig.ex_style);

            SetWindowPos(
                child,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
            );
            Ok(())
        }
    }
}

#[cfg(not(windows))]
mod non_windows {
    use super::*;

    pub fn attach(
        _child: usize,
        _workerw: usize,
        _bounds: WallpaperBounds,
    ) -> Result<OriginalWindowStyles, String> {
        Err("WorkerW wallpaper mode is only supported on Windows".to_string())
    }

    pub fn detach(_child: usize, _orig: OriginalWindowStyles) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(windows)]
pub use win32::*;

#[cfg(not(windows))]
pub use non_windows::*;
