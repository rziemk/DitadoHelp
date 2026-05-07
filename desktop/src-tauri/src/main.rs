#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn paste_text(text: String) -> Result<(), String> {
    let escaped = text.replace('\\', "\\\\").replace('"', "\\\"");
    let script = format!(
        r#"set the clipboard to "{}"
tell application "System Events"
  keystroke "v" using command down
end tell"#,
        escaped
    );

    let output = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|err| err.to_string())?;

    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![paste_text])
        .run(tauri::generate_context!())
        .expect("error while running Scribeflowai");
}
