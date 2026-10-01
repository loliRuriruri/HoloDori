use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager};

pub mod commands;
pub mod desktop;
pub mod domain;
pub mod importer;

pub fn run() {
    tauri::Builder::default()
        .manage(commands::BatchState::default())
        .manage(commands::ImporterState::default())
        .manage(commands::DesktopState::default())
        .manage(commands::WallpaperAppState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Build system tray menu
            let show_main = MenuItem::with_id(
                app,
                "show_main",
                "Show HoloDori Manager",
                true,
                None::<&str>,
            )?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let show_desktop = MenuItem::with_id(
                app,
                "show_desktop",
                "Show Desktop Character",
                true,
                None::<&str>,
            )?;
            let hide_desktop = MenuItem::with_id(
                app,
                "hide_desktop",
                "Hide Desktop Character",
                true,
                None::<&str>,
            )?;
            let interactive_mode = MenuItem::with_id(
                app,
                "interactive_mode",
                "Interactive Mode (Click-Through OFF)",
                true,
                None::<&str>,
            )?;
            let click_through_mode = MenuItem::with_id(
                app,
                "click_through_mode",
                "Click-Through Mode (Click-Through ON)",
                true,
                None::<&str>,
            )?;
            let toggle_aot = MenuItem::with_id(
                app,
                "toggle_aot",
                "Toggle Always on Top",
                true,
                None::<&str>,
            )?;
            let toggle_pause = MenuItem::with_id(
                app,
                "toggle_pause",
                "Pause / Resume Animation",
                true,
                None::<&str>,
            )?;
            let mode_wallpaper = MenuItem::with_id(
                app,
                "mode_wallpaper",
                "Mode: True Wallpaper (WorkerW / Progman)",
                true,
                None::<&str>,
            )?;
            let mode_overlay = MenuItem::with_id(
                app,
                "mode_overlay",
                "Mode: Desktop Overlay",
                true,
                None::<&str>,
            )?;
            let recover_wp = MenuItem::with_id(
                app,
                "recover_wp",
                "Recover Wallpaper Host",
                true,
                None::<&str>,
            )?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let close_desktop = MenuItem::with_id(
                app,
                "close_desktop",
                "Close Desktop Character",
                true,
                None::<&str>,
            )?;
            let exit_app =
                MenuItem::with_id(app, "exit_app", "Exit HoloDori Manager", true, None::<&str>)?;

            let menu = Menu::with_items(
                app,
                &[
                    &show_main,
                    &sep1,
                    &show_desktop,
                    &hide_desktop,
                    &mode_wallpaper,
                    &mode_overlay,
                    &recover_wp,
                    &interactive_mode,
                    &click_through_mode,
                    &toggle_aot,
                    &toggle_pause,
                    &sep2,
                    &close_desktop,
                    &exit_app,
                ],
            )?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show_main" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "show_desktop" => {
                        if let Some(win) = app.get_webview_window("desktop_character") {
                            let _ = win.show();
                        }
                    }
                    "hide_desktop" => {
                        if let Some(win) = app.get_webview_window("desktop_character") {
                            let _ = win.hide();
                        }
                    }
                    "mode_wallpaper" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = commands::wallpaper::set_wallpaper_mode(
                                app_handle,
                                desktop::wallpaper::WallpaperHostPreference::Auto,
                            )
                            .await;
                        });
                    }
                    "mode_overlay" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = commands::wallpaper::set_wallpaper_mode(
                                app_handle,
                                desktop::wallpaper::WallpaperHostPreference::DesktopOverlay,
                            )
                            .await;
                        });
                    }
                    "recover_wp" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = commands::wallpaper::recover_wallpaper(app_handle).await;
                        });
                    }
                    "interactive_mode" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = commands::set_desktop_click_through(app_handle, false).await;
                        });
                    }
                    "click_through_mode" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = commands::set_desktop_click_through(app_handle, true).await;
                        });
                    }
                    "toggle_aot" => {
                        let state = app.state::<commands::DesktopState>();
                        let current = state
                            .always_on_top
                            .load(std::sync::atomic::Ordering::Relaxed);
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = commands::set_desktop_always_on_top(app_handle, !current).await;
                        });
                    }
                    "toggle_pause" => {
                        let state = app.state::<commands::DesktopState>();
                        let current = state.paused.load(std::sync::atomic::Ordering::Relaxed);
                        state
                            .paused
                            .store(!current, std::sync::atomic::Ordering::Relaxed);
                        let _ = app.emit(
                            "desktop-action",
                            serde_json::json!({
                                "action": if !current { "pause" } else { "resume" },
                                "payload": null,
                            }),
                        );
                    }
                    "close_desktop" => {
                        let app_handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            let _ = commands::close_desktop_window(app_handle).await;
                        });
                    }
                    "exit_app" => {
                        let wp_state = app.state::<commands::WallpaperAppState>();
                        let _ = wp_state.manager.detach();
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon().cloned() {
                tray_builder = tray_builder.icon(icon);
            }

            tray_builder.build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let app = window.app_handle();
                    // If desktop window is currently open, hide main window to tray instead of quitting!
                    if app.get_webview_window("desktop_character").is_some() {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::scan_inputs,
            commands::scan_library,
            commands::batch_build,
            commands::cancel_batch_build,
            commands::clear_library_cache,
            commands::build_models,
            commands::get_default_output_dir,
            commands::detect_game_install,
            commands::set_game_install_path,
            commands::load_game_catalog,
            commands::import_models,
            commands::cancel_import,
            commands::get_import_cache_stats,
            commands::clear_import_cache,
            commands::read_package_file,
            commands::get_model_animations,
            commands::get_expression_bytes,
            commands::get_motion_bytes,
            commands::get_physics_bytes,
            commands::load_player_settings,
            commands::save_player_settings,
            commands::desktop::get_available_monitors,
            commands::desktop::get_desktop_window_state,
            commands::desktop::open_desktop_window,
            commands::desktop::close_desktop_window,
            commands::desktop::set_desktop_click_through,
            commands::desktop::set_desktop_always_on_top,
            commands::desktop::set_desktop_bounds,
            commands::desktop::send_desktop_control,
            commands::wallpaper::get_wallpaper_state,
            commands::wallpaper::get_wallpaper_diagnostics,
            commands::wallpaper::enable_wallpaper,
            commands::wallpaper::disable_wallpaper,
            commands::wallpaper::recover_wallpaper,
            commands::wallpaper::set_wallpaper_mode
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
