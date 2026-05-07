#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;
use std::process::{Command, Stdio};

fn copy_to_clipboard(text: &str) -> Result<(), String> {
    let mut child = Command::new("pbcopy")
        .stdin(Stdio::piped())
        .spawn()
        .map_err(|err| format!("pbcopy falhou: {err}"))?;

    let stdin = child
        .stdin
        .as_mut()
        .ok_or_else(|| "Nao foi possivel abrir stdin do pbcopy.".to_string())?;
    stdin
        .write_all(text.as_bytes())
        .map_err(|err| format!("Nao foi possivel copiar o texto: {err}"))?;

    let status = child
        .wait()
        .map_err(|err| format!("pbcopy nao finalizou: {err}"))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("pbcopy saiu com status {status}"))
    }
}

#[tauri::command]
fn paste_text(text: String) -> Result<(), String> {
    copy_to_clipboard(&text)?;

    let script = r#"tell application "System Events"
  set frontApp to name of first application process whose frontmost is true
  if frontApp is "Scribeflowai" or frontApp is "scribeflowai_desktop" then
    key code 48 using command down
    delay 0.2
  end if
  key code 9 using command down
end tell"#;

    let output = Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|err| format!("osascript falhou: {err}"))?;

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
