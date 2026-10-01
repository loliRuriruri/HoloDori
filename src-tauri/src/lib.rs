pub mod commands;
pub mod domain;
pub mod importer;

pub fn run() {
    tauri::Builder::default()
        .manage(commands::BatchState::default())
        .manage(commands::ImporterState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            commands::clear_import_cache
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
