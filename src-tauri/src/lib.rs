use serde_json::json;
use tauri::{
    webview::{DownloadEvent, WebviewBuilder},
    Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl,
};

/// Runs JavaScript inside a tab (back, forward, reload, find, print).
#[tauri::command]
fn webview_eval(app: tauri::AppHandle, label: String, script: String) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("webview '{label}' not found"))?;

    webview.eval(&script).map_err(|e| e.to_string())
}

/// Creates a tab webview and hooks downloads.
#[tauri::command]
async fn create_tab_webview(
    app: tauri::AppHandle,
    label: String,
    url: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    incognito: bool,
) -> Result<(), String> {
    let window = app.get_window("main").ok_or("main window not found")?;
    let handle = app.clone();

    let parsed = url.parse().map_err(|e| format!("bad url: {e}"))?;

    let builder = WebviewBuilder::new(&label, WebviewUrl::External(parsed))
        .incognito(incognito)
        .on_download(move |webview, event| {
            let tab_label = webview.label().to_string();

            match event {
                DownloadEvent::Requested { url, destination } => {
                    if let Ok(dir) = handle.path().download_dir() {
                        let name = destination
                            .file_name()
                            .map(|n| n.to_owned())
                            .unwrap_or_else(|| "download".into());

                        *destination = dir.join(name);
                    }

                    let _ = handle.emit(
                        "fades-download",
                        json!({
                            "label": tab_label,
                            "status": "started",
                            "url": url.to_string(),
                            "path": destination.to_string_lossy(),
                        }),
                    );
                }
                DownloadEvent::Finished { url, path, success } => {
                    let _ = handle.emit(
                        "fades-download",
                        json!({
                            "label": tab_label,
                            "status": if success { "done" } else { "failed" },
                            "url": url.to_string(),
                            "path": path.map(|p| p.to_string_lossy().to_string()),
                        }),
                    );
                }
                _ => {}
            }

            true
        });

    window
        .add_child(
            builder,
            LogicalPosition::new(x, y),
            LogicalSize::new(width, height),
        )
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![webview_eval, create_tab_webview])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}