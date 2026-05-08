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
    copy_to_clipboard(&text)
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
