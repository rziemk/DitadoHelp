#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::Write;
use std::process::{Command, Stdio};

#[cfg(target_os = "macos")]
fn is_accessibility_trusted(prompt: bool) -> bool {
    use core_foundation_sys::base::{kCFAllocatorDefault, CFRelease};
    use core_foundation_sys::dictionary::CFDictionaryCreate;
    use core_foundation_sys::number::kCFBooleanTrue;
    use core_foundation_sys::string::CFStringRef;
    use std::ffi::c_void;
    use std::ptr;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        static kAXTrustedCheckOptionPrompt: CFStringRef;
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: core_foundation_sys::dictionary::CFDictionaryRef) -> bool;
    }

    unsafe {
        if !prompt {
            return AXIsProcessTrusted();
        }

        let keys = [kAXTrustedCheckOptionPrompt as *const c_void];
        let values = [kCFBooleanTrue as *const c_void];
        let options = CFDictionaryCreate(
            kCFAllocatorDefault,
            keys.as_ptr(),
            values.as_ptr(),
            1,
            ptr::null(),
            ptr::null(),
        );
        let trusted = AXIsProcessTrustedWithOptions(options);
        if !options.is_null() {
            CFRelease(options as *const c_void);
        }
        trusted
    }
}

#[cfg(not(target_os = "macos"))]
fn is_accessibility_trusted(_prompt: bool) -> bool {
    true
}

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

    if !is_accessibility_trusted(true) {
        let _ = Command::new("open")
            .arg("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility")
            .spawn();
        return Err("Permissao de Acessibilidade pendente. O texto foi copiado, mas o macOS bloqueou a colagem automatica.".to_string());
    }

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

#[tauri::command]
fn accessibility_status() -> bool {
    is_accessibility_trusted(false)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![paste_text, accessibility_status])
        .run(tauri::generate_context!())
        .expect("error while running Scribeflowai");
}
