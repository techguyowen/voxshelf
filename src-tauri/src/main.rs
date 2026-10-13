// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

struct ServerProcess(Mutex<Option<Child>>);

const DEFAULT_PORT: u16 = 48291;

/// Find an available TCP port starting from the preferred port.
fn find_available_port(preferred: u16) -> u16 {
    if TcpListener::bind(("127.0.0.1", preferred)).is_ok() {
        return preferred;
    }
    // Fall back to OS-assigned ephemeral port
    match TcpListener::bind(("127.0.0.1", 0)) {
        Ok(listener) => listener.local_addr().map(|a| a.port()).unwrap_or(preferred),
        Err(_) => preferred,
    }
}

/// Poll the /api/health endpoint until the server is responsive.
async fn wait_for_health(port: u16, timeout: Duration) -> bool {
    let url = format!("http://127.0.0.1:{}/api/health", port);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(500))
        .build()
        .unwrap_or_default();

    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if let Ok(res) = client.get(&url).send().await {
            if res.status().is_success() {
                return true;
            }
        }
        tokio::time::sleep(Duration::from_millis(200)).await;
    }
    false
}

/// Locate the standalone Next.js server entry point.
fn resolve_server_entry(app_handle: &AppHandle) -> Option<(PathBuf, PathBuf)> {
    // 1. In development, check root .next/standalone
    let dev_root = std::env::current_dir().unwrap_or_default();
    let dev_entry = dev_root.join(".next").join("standalone").join("server.js");
    if dev_entry.exists() {
        return Some((dev_root.join(".next").join("standalone"), dev_entry));
    }

    // 2. In packaged production, resolve from resource directory
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let entry = resource_dir.join("standalone").join("server.js");
        if entry.exists() {
            return Some((resource_dir.join("standalone"), entry));
        }
    }

    None
}

/// Spawn the standalone Node.js server.
fn start_backend_server(app_handle: &AppHandle, port: u16) -> Option<Child> {
    let (work_dir, server_entry) = resolve_server_entry(app_handle)?;

    // Determine persistent data directory in OS user app data
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| dirs::data_dir().unwrap_or_default().join("VoxShelf"))
        .join("voxshelf-data");

    let _ = std::fs::create_dir_all(&data_dir);

    println!(
        "[voxshelf] Starting standalone server from {:?} on 127.0.0.1:{}",
        server_entry, port
    );

    let child = Command::new("node")
        .arg(&server_entry)
        .current_dir(&work_dir)
        .env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("DATA_DIR", data_dir.to_string_lossy().to_string())
        .spawn()
        .map_err(|e| {
            eprintln!("[voxshelf] Failed to spawn Node.js backend: {}", e);
            e
        })
        .ok()?;

    Some(child)
}

fn main() {
    tauri::Builder::default()
        .manage(ServerProcess(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle().clone();

            // Only spawn standalone server in release/packaged mode when devUrl is not overriding
            let is_dev = cfg!(debug_assertions);
            let port = if is_dev {
                DEFAULT_PORT
            } else {
                find_available_port(DEFAULT_PORT)
            };

            if !is_dev {
                if let Some(child) = start_backend_server(&handle, port) {
                    let state = app.state::<ServerProcess>();
                    let mut lock = state.0.lock().unwrap();
                    *lock = Some(child);
                }
            }

            // In background, ensure window navigates to the active port
            let handle_clone = handle.clone();
            tauri::async_runtime::spawn(async move {
                if !is_dev {
                    let _ = wait_for_health(port, Duration::from_secs(15)).await;
                }
                if let Some(window) = handle_clone.get_webview_window("main") {
                    let _ = window.eval("window.voxshelf = { isDesktop: true, platform: 'darwin' };");
                    let url = format!("http://127.0.0.1:{}", port);
                    if let Ok(parsed_url) = url.parse() {
                        let _ = window.navigate(parsed_url);
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // If the main window closes, kill the child backend process
                let state = window.state::<ServerProcess>();
                let mut lock = state.0.lock().unwrap();
                if let Some(mut child) = lock.take() {
                    println!("[voxshelf] Terminating backend server child process");
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
