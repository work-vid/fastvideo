use std::path::Path;
use std::fs;
use serde::{Serialize, Deserialize};
use walkdir::WalkDir;

#[derive(Serialize, Deserialize, Debug, Clone)]
struct FileNode {
    path: String,
    name: String,
    kind: String, // "file" or "dir"
    children: Option<Vec<FileNode>>,
    media_type: Option<String>, // "image", "video", "xml", or None
}

#[derive(Serialize, Deserialize, Debug)]
struct ScanResult {
    media: Option<FileNode>,
    xmls: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct PathMapping {
    old_virtual_path: String,
    new_virtual_path: String,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn is_hidden(entry: &walkdir::DirEntry) -> bool {
    entry.file_name()
         .to_str()
         .map(|s| s.starts_with(".") || s.starts_with("._"))
         .unwrap_or(false)
}

fn get_media_type(path: &Path) -> Option<String> {
    if let Some(ext) = path.extension().and_then(|s| s.to_str()) {
        let ext = ext.to_lowercase();
        match ext.as_str() {
            "png" | "jpg" | "jpeg" | "webp" | "bmp" => Some("image".to_string()),
            "mp4" | "mkv" | "mov" | "avi" | "webm" => Some("video".to_string()),
            "xml" => Some("xml".to_string()),
            _ => None,
        }
    } else {
        None
    }
}

fn build_tree(path: &Path) -> Option<FileNode> {
    if !path.exists() {
        return None;
    }

    let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
    let path_str = path.to_string_lossy().to_string();

    if path.is_dir() {
        let mut children = Vec::new();
        if let Ok(entries) = fs::read_dir(path) {
            for entry in entries.flatten() {
                let p = entry.path();
                let file_name = p.file_name().unwrap_or_default().to_string_lossy();
                if file_name.starts_with(".") || file_name.starts_with("._") {
                    continue;
                }
                
                if let Some(node) = build_tree(&p) {
                    children.push(node);
                }
            }
        }
        children.sort_by(|a, b| {
            if a.kind == "dir" && b.kind != "dir" {
                std::cmp::Ordering::Less
            } else if a.kind != "dir" && b.kind == "dir" {
                std::cmp::Ordering::Greater
            } else {
                a.name.cmp(&b.name)
            }
        });

        Some(FileNode {
            path: path_str,
            name,
            kind: "dir".to_string(),
            children: Some(children),
            media_type: None,
        })
    } else {
        let media_type = get_media_type(path);
        Some(FileNode {
            path: path_str,
            name,
            kind: "file".to_string(),
            children: None,
            media_type,
        })
    }
}

#[tauri::command]
async fn scan_project(root: String) -> Result<ScanResult, String> {
    let root_path = Path::new(&root);
    let media_assets_path = root_path.join("MediaAssets");

    let media_tree = if media_assets_path.exists() {
        build_tree(&media_assets_path)
    } else {
        None
    };

    let mut xmls = Vec::new();
    for entry in WalkDir::new(root_path).into_iter().filter_entry(|e| !is_hidden(e)) {
        if let Ok(entry) = entry {
            let p = entry.path();
            if p.is_file() {
                if let Some(ext) = p.extension() {
                    if ext.to_string_lossy().to_lowercase() == "xml" {
                        xmls.push(p.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    Ok(ScanResult {
        media: media_tree,
        xmls,
    })
}

#[tauri::command]
fn update_xml_refs(mappings: Vec<PathMapping>, xml_paths: Vec<String>) -> Result<u32, String> {
    let mut count = 0;
    
    for xml_path_str in xml_paths {
        let path = Path::new(&xml_path_str);
        if !path.exists() { continue; }

        match fs::read_to_string(path) {
            Ok(mut content) => {
                let mut changed = false;
                for mapping in &mappings {
                    // Escape the old path for regex
                    let escaped_old = regex::escape(&mapping.old_virtual_path);
                    // Create case-insensitive regex: (?i)escaped_path
                    let pattern = format!("(?i){}", escaped_old);
                    
                    if let Ok(re) = regex::Regex::new(&pattern) {
                        if re.is_match(&content) {
                             content = re.replace_all(&content, &mapping.new_virtual_path).to_string();
                             changed = true;
                        }
                    }
                }

                if changed {
                    if let Err(e) = fs::write(path, content) {
                        return Err(format!("Failed to write {}: {}", xml_path_str, e));
                    }
                    count += 1;
                }
            },
            Err(e) => return Err(format!("Failed to read {}: {}", xml_path_str, e)),
        }
    }
    Ok(count)
}

#[tauri::command]
async fn extract_zip(zip_path: String, dest_path: String) -> Result<String, String> {
    let file = fs::File::open(&zip_path).map_err(|e| e.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let dest = Path::new(&dest_path);

    if !dest.exists() {
        fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    }

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        
        // Sanitize path (mitigate usage of absolute paths in zip)
        let outpath = match file.enclosed_name() {
            Some(path) => dest.join(path),
            None => continue,
        };

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
            }
            let mut outfile = fs::File::create(&outpath).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
        }
    }
    Ok(dest_path)
}

#[tauri::command]
async fn compress_zip(source_dir: String, zip_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let src_path = Path::new(&source_dir);
        let file = fs::File::create(&zip_path).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipWriter::new(file);
        let options = zip::write::FileOptions::<()>::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o755);

        for entry in WalkDir::new(src_path).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            
            if is_hidden(&entry) { continue; }

            let name = path.strip_prefix(src_path)
                .map_err(|e| e.to_string())?
                .to_string_lossy();
                
            if name.is_empty() { continue; } // Skip root dir itself

            if path.is_file() {
                zip.start_file(name, options).map_err(|e| e.to_string())?;
                let mut f = fs::File::open(path).map_err(|e| e.to_string())?;
                std::io::copy(&mut f, &mut zip).map_err(|e| e.to_string())?;
            } else if path.is_dir() && !name.is_empty() {
                zip.add_directory(name, options).map_err(|e| e.to_string())?;
            }
        }
        zip.finish().map_err(|e| e.to_string())?;
        Ok(zip_path)
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn copy_project(source: String, target: String) -> Result<usize, String> {
    let source_path = Path::new(&source);
    let target_path = Path::new(&target);

    if !source_path.exists() {
        return Err("Source directory does not exist".to_string());
    }

    if !target_path.exists() {
        fs::create_dir_all(target_path).map_err(|e| e.to_string())?;
    }

    let mut count = 0;
    
    // Canonicalize paths to ensure correct prefix checking
    let target_abs = fs::canonicalize(target_path).unwrap_or(target_path.to_path_buf());

    for entry in WalkDir::new(source_path).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        
        // Skip hidden files/dirs (optional, but consistent with scan)
        if is_hidden(&entry) {
            continue;
        }

        // Calculate relative path
        let relative = match path.strip_prefix(source_path) {
            Ok(r) => r,
            Err(_) => continue,
        };

        if relative.as_os_str().is_empty() {
            continue; // Root folder
        }

        let dest = target_path.join(relative);

        // AUTO-EXCLUDE: If the file being copied IS inside the target directory (e.g. recursive copy into self)
        // Check if `path` starts with `target_abs`?
        // Actually simplest is: if `path` == `target_path` or inside, skip.
        // But `WalkDir` iterates source. If target is inside source, we encounter it.
        // We must check if `dest` would be inside `source`? No.
        // We must check if `path` (source file) IS the target folder or inside it.
        if path.starts_with(&target_abs) {
            continue;
        }

        if path.is_dir() {
            if !dest.exists() {
                fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
            }
        } else {
            // Ensure parent exists
            if let Some(parent) = dest.parent() {
                if !parent.exists() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
            }
            fs::copy(path, &dest).map_err(|e| format!("Failed to copy {:?} to {:?}: {}", path, dest, e))?;
            count += 1;
        }
    }

    Ok(count)
}

#[tauri::command]
fn delete_dir(path: String) -> Result<(), String> {
    fs::remove_dir_all(path).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet, 
            list_video_files,
            ensure_dir, 
            file_exists, 
            delete_file,
            delete_dir,
            scan_project,
            update_xml_refs,
            copy_project,
            extract_zip,
            compress_zip
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// Re-declaring list_video_files to keep compatibility
#[tauri::command]
fn list_video_files(path: String) -> Result<Vec<String>, String> {
    let supported_extensions = vec!["mp4", "mkv", "mov", "avi", "webm", "flv", "wmv", "m4v"];
    let mut video_files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                    if supported_extensions.contains(&ext.to_lowercase().as_str()) {
                       if let Some(fname) = path.file_name().and_then(|n| n.to_str()) {
                           video_files.push(fname.to_string());
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
