// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::ffi::OsString;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

struct ServerProcess(Mutex<Option<Child>>);

const DEFAULT_PORT: u16 = 48291;

/// Parse a node version directory name like "v22.14.0" into a sortable tuple.
fn parse_semver_dir(name: &str) -> (u64, u64, u64) {
    let trimmed = name.trim_start_matches('v');
    let mut parts = trimmed.split('.').map(|s| s.parse::<u64>().unwrap_or(0));
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

/// Find the Node.js binary across GUI/Finder environments where PATH is minimal.
fn resolve_node_binary() -> PathBuf {
    if let Ok(explicit) = std::env::var("VOXSHELF_NODE_BIN") {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            let candidate = PathBuf::from(trimmed);
            if candidate.is_file() {
                return candidate;
            }
        }
    }

    let finder = if cfg!(windows) { "where" } else { "which" };
    let mut finder_cmd = Command::new(finder);
    finder_cmd.arg("node");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        finder_cmd.creation_flags(0x08000000);
    }
    if let Ok(output) = finder_cmd.output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let candidate = PathBuf::from(line.trim());
                if candidate.is_file() {
                    return candidate;
                }
            }
        }
    }

    let mut candidates: Vec<PathBuf> = vec![
        PathBuf::from("/opt/homebrew/bin/node"),
        PathBuf::from("/usr/local/bin/node"),
        PathBuf::from("/opt/local/bin/node"),
        PathBuf::from("/usr/bin/node"),
    ];

    if let Some(home) = dirs::home_dir() {
        let bin_name = if cfg!(windows) { "node.exe" } else { "node" };
        candidates.push(home.join(".volta").join("bin").join(bin_name));

        let nvm_dir = home.join(".nvm").join("versions").join("node");
        if let Ok(entries) = std::fs::read_dir(nvm_dir) {
            let mut versions: Vec<((u64, u64, u64), PathBuf)> = entries
                .filter_map(|e| e.ok())
                .filter_map(|e| {
                    let name = e.file_name().to_string_lossy().into_owned();
                    let bin = e.path().join("bin").join(bin_name);
                    if bin.is_file() {
                        Some((parse_semver_dir(&name), bin))
                    } else {
                        None
                    }
                })
                .collect();
            versions.sort_by(|a, b| b.0.cmp(&a.0));
            for (_, bin) in versions {
                candidates.push(bin);
            }
        }
    }

    #[cfg(windows)]
    {
        candidates.push(PathBuf::from(r"C:\Program Files\nodejs\node.exe"));
        if let Ok(pf) = std::env::var("ProgramFiles") {
            candidates.push(PathBuf::from(pf).join("nodejs").join("node.exe"));
        }
        if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
            candidates.push(
                PathBuf::from(local_app)
                    .join("Programs")
                    .join("nodejs")
                    .join("node.exe"),
            );
        }
    }

    for candidate in candidates {
        if candidate.is_file() {
            return candidate;
        }
    }

    PathBuf::from("node")
}

/// Build an augmented PATH so child tools (ffmpeg, say, espeak-ng, piper, ollama) resolve on GUI launches.
fn build_augmented_path(node_bin: &Path) -> OsString {
    let mut dirs_list: Vec<PathBuf> = Vec::new();
    let mut push_unique = |p: PathBuf| {
        if !p.as_os_str().is_empty() && !dirs_list.contains(&p) {
            dirs_list.push(p);
        }
    };

    if let Some(parent) = node_bin.parent() {
        if !parent.as_os_str().is_empty() {
            push_unique(parent.to_path_buf());
        }
    }

    #[cfg(not(windows))]
    {
        for standard in [
            "/opt/homebrew/bin",
            "/opt/homebrew/sbin",
            "/usr/local/bin",
            "/opt/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
        ] {
            push_unique(PathBuf::from(standard));
        }
        if let Some(home) = dirs::home_dir() {
            push_unique(home.join(".local").join("bin"));
            push_unique(home.join(".cargo").join("bin"));
        }
    }

    #[cfg(windows)]
    {
        let mut win_candidates = vec![
            PathBuf::from(r"C:\Program Files\nodejs"),
            PathBuf::from(r"C:\Program Files\ffmpeg\bin"),
            PathBuf::from(r"C:\Program Files\eSpeak NG"),
            PathBuf::from(r"C:\Program Files (x86)\eSpeak NG"),
            PathBuf::from(r"C:\ProgramData\chocolatey\bin"),
        ];
        if let Ok(local_app) = std::env::var("LOCALAPPDATA") {
            let base = PathBuf::from(local_app);
            win_candidates.push(base.join("Programs").join("Ollama"));
            win_candidates.push(base.join("Programs").join("piper"));
            win_candidates.push(base.join("Microsoft").join("WinGet").join("Links"));
        }
        if let Some(home) = dirs::home_dir() {
            win_candidates.push(home.join("scoop").join("shims"));
            win_candidates.push(home.join(".local").join("bin"));
            win_candidates.push(home.join(".cargo").join("bin"));
        }
        for p in win_candidates {
            if p.is_dir() {
                push_unique(p);
            }
        }
    }

    if let Some(existing) = std::env::var_os("PATH") {
        for p in std::env::split_paths(&existing) {
            push_unique(p);
        }
    }

    std::env::join_paths(dirs_list)
        .unwrap_or_else(|_| std::env::var_os("PATH").unwrap_or_default())
}

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
    let node_bin = resolve_node_binary();
    let augmented_path = build_augmented_path(&node_bin);

    // Determine persistent data directory in OS user app data
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| dirs::data_dir().unwrap_or_default().join("VoxShelf"))
        .join("voxshelf-data");

    let _ = std::fs::create_dir_all(&data_dir);

    println!(
        "[voxshelf] Starting standalone server with {:?} from {:?} on 127.0.0.1:{}",
        node_bin, server_entry, port
    );

    let mut cmd = Command::new(&node_bin);
    cmd.arg(&server_entry)
        .current_dir(&work_dir)
        .env("PATH", augmented_path)
        .env("PORT", port.to_string())
        .env("HOSTNAME", "127.0.0.1")
        .env("NODE_ENV", "production")
        .env("DATA_DIR", data_dir.to_string_lossy().to_string());

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    let child = cmd
        .spawn()
        .map_err(|e| {
            eprintln!(
                "[voxshelf] Failed to spawn Node.js backend ({:?}): {}",
                node_bin, e
            );
            e
        })
        .ok()?;

    Some(child)
}

/// Terminate the spawned Node.js server child process if still running.
fn stop_backend_server(app_handle: &AppHandle) {
    let child = {
        let state = app_handle.state::<ServerProcess>();
        state.0.lock().ok().and_then(|mut lock| lock.take())
    };
    if let Some(mut child) = child {
        println!("[voxshelf] Terminating backend server child process");
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn main() {
    let app = tauri::Builder::default()
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

            let platform = match std::env::consts::OS {
                "macos" => "darwin",
                "windows" => "win32",
                "linux" => "linux",
                other => other,
            };
            let version = app.package_info().version.to_string();
            let init_script = format!(
                "window.voxshelf = {{ isDesktop: true, isTauri: true, platform: {}, version: {} }};",
                serde_json::to_string(platform).unwrap_or_else(|_| "\"unknown\"".to_string()),
                serde_json::to_string(&version).unwrap_or_else(|_| "\"1.2.0\"".to_string()),
            );

            if let Some(win_config) = app.config().app.windows.first() {
                tauri::WebviewWindowBuilder::from_config(app.handle(), win_config)?
                    .initialization_script(&init_script)
                    .build()?;
            } else {
                tauri::WebviewWindowBuilder::new(
                    app.handle(),
                    "main",
                    tauri::WebviewUrl::default(),
                )
                .title("VoxShelf")
                .inner_size(1280.0, 840.0)
                .min_inner_size(800.0, 600.0)
                .initialization_script(&init_script)
                .build()?;
            }

            // In packaged mode, wait for backend health then navigate to the local server.
            if !is_dev {
                let handle_clone = handle.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = wait_for_health(port, Duration::from_secs(15)).await;
                    if let Some(window) = handle_clone.get_webview_window("main") {
                        let url = format!("http://127.0.0.1:{}", port);
                        if let Ok(parsed_url) = url.parse() {
                            let _ = window.navigate(parsed_url);
                        }
                    }
                });
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                stop_backend_server(window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(
            event,
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit
        ) {
            stop_backend_server(app_handle);
        }
    });
}
