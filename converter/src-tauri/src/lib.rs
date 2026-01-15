// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn list_video_files(path: String) -> Result<Vec<String>, String> {
    let supported_extensions = vec!["mp4", "mkv", "mov", "avi", "webm", "flv", "wmv", "m4v"];
    let mut video_files = Vec::new();

    let entries = std::fs::read_dir(path).map_err(|e| e.to_string())?;

    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.is_file() {
                if let Some(extension) = path.extension() {
                    if let Some(ext_str) = extension.to_str() {
                        if supported_extensions.contains(&ext_str.to_lowercase().as_str()) {
                            if let Some(file_name) = path.file_name() {
                                if let Some(name_str) = file_name.to_str() {
                                    video_files.push(name_str.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(video_files)
}

#[tauri::command]
fn ensure_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    std::fs::remove_file(path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, list_video_files, ensure_dir, file_exists, delete_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
