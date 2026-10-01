pub mod commands;
pub mod domain;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::scan_inputs,
            commands::build_models,
            commands::get_default_output_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
