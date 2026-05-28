mod debug_log;
mod model_config;
mod storage;

use model_config::{
    GeneratedImage, ImageGenerateRequest, ModelFetchRequest, ModelOption, ModelTestRequest,
    ModelTestResult, PromptAnalysisResult, PromptAnalyzeRequest,
};
use std::path::{Path, PathBuf};
use storage::{
    AppSnapshot, ConversationMutationResult, LocalStore, SaveGeneratedImageRequest,
    SaveReferenceImageRequest, SavedImage, StorageInfo,
};
use tauri::{Manager, State};
use tauri_plugin_opener::OpenerExt;

async fn run_blocking<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("Background task failed: {error}"))?
}

#[tauri::command]
fn app_status() -> &'static str {
    "FangCun local runtime ready"
}

#[tauri::command]
async fn load_workspace(store: State<'_, LocalStore>) -> Result<Option<AppSnapshot>, String> {
    let store = store.inner().clone();
    run_blocking(move || storage::load_workspace(&store)).await
}

#[tauri::command]
async fn save_workspace(store: State<'_, LocalStore>, snapshot: AppSnapshot) -> Result<(), String> {
    let store = store.inner().clone();
    run_blocking(move || storage::save_workspace(&store, snapshot)).await
}

#[tauri::command]
async fn get_storage_info(store: State<'_, LocalStore>) -> Result<StorageInfo, String> {
    let store = store.inner().clone();
    run_blocking(move || storage::storage_info(&store)).await
}

#[tauri::command]
async fn set_data_directory(
    store: State<'_, LocalStore>,
    directory: Option<String>,
) -> Result<StorageInfo, String> {
    let store = store.inner().clone();
    run_blocking(move || storage::set_data_directory(&store, directory)).await
}

#[tauri::command]
async fn pick_data_directory() -> Result<Option<String>, String> {
    run_blocking(storage::pick_data_directory).await
}

#[tauri::command]
async fn configure_debug_logging(enabled: bool, retention_days: u64) -> Result<(), String> {
    run_blocking(move || debug_log::configure_debug_logging(enabled, retention_days)).await
}

#[tauri::command]
async fn open_debug_log_folder(app: tauri::AppHandle) -> Result<(), String> {
    let log_dir = run_blocking(debug_log::debug_log_dir).await?;
    app.opener()
        .open_path(log_dir.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| format!("Could not open debug log folder: {error}"))
}

#[tauri::command]
async fn open_project_folder(
    _app: tauri::AppHandle,
    store: State<'_, LocalStore>,
    project_id: String,
    project_title: String,
    project_directory: Option<String>,
) -> Result<(), String> {
    let store = store.inner().clone();
    let project_directory = run_blocking(move || {
        storage::project_directory(
            &store,
            &project_id,
            &project_title,
            project_directory.as_deref(),
        )
    })
    .await?;

    #[cfg(target_os = "windows")]
    {
        let explorer_path = std::env::var_os("WINDIR")
            .map(std::path::PathBuf::from)
            .map(|path| path.join("explorer.exe"))
            .unwrap_or_else(|| std::path::PathBuf::from(r"C:\Windows\explorer.exe"));
        let explorer_result = std::process::Command::new(&explorer_path)
            .arg(project_directory.as_os_str())
            .spawn();

        match explorer_result {
            Ok(_) => Ok(()),
            Err(explorer_error) => _app
                .opener()
                .open_path(project_directory.to_string_lossy().into_owned(), None::<&str>)
                .map_err(|opener_error| {
                    format!(
                        "Could not open project folder with {}: {explorer_error}; opener fallback failed: {opener_error}",
                        explorer_path.to_string_lossy()
                    )
                }),
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        _app.opener()
            .open_path(project_directory.to_string_lossy().into_owned(), None::<&str>)
            .map_err(|error| format!("Could not open project folder: {error}"))
    }
}

#[tauri::command]
async fn rename_conversation(
    store: State<'_, LocalStore>,
    conversation_id: String,
    title: String,
    updated_at: String,
) -> Result<ConversationMutationResult, String> {
    let store = store.inner().clone();
    run_blocking(move || {
        storage::rename_conversation(&store, &conversation_id, &title, &updated_at)
    })
    .await
}

#[tauri::command]
async fn delete_conversation(
    store: State<'_, LocalStore>,
    conversation_id: String,
    updated_at: String,
) -> Result<ConversationMutationResult, String> {
    let store = store.inner().clone();
    run_blocking(move || storage::delete_conversation(&store, &conversation_id, &updated_at)).await
}

#[tauri::command]
async fn open_image_in_file_manager(
    app: tauri::AppHandle,
    image_path: String,
) -> Result<(), String> {
    run_blocking(move || open_image_path_in_file_manager(&app, &image_path)).await
}

#[tauri::command]
async fn copy_image_file_to_clipboard(image_path: String) -> Result<(), String> {
    run_blocking(move || copy_image_path_to_clipboard(&image_path)).await
}

#[tauri::command]
async fn save_provider_api_key(provider: String, api_key: String) -> Result<bool, String> {
    run_blocking(move || model_config::save_provider_api_key(&provider, &api_key)).await
}

#[tauri::command]
async fn clear_provider_api_key(provider: String) -> Result<bool, String> {
    run_blocking(move || model_config::clear_provider_api_key(&provider)).await
}

#[tauri::command]
async fn fetch_provider_models(request: ModelFetchRequest) -> Result<Vec<ModelOption>, String> {
    run_blocking(move || model_config::fetch_provider_models(request)).await
}

#[tauri::command]
async fn test_provider_connection(request: ModelTestRequest) -> Result<ModelTestResult, String> {
    run_blocking(move || model_config::test_provider_connection(request)).await
}

#[tauri::command]
async fn analyze_prompt_directions(
    request: PromptAnalyzeRequest,
) -> Result<PromptAnalysisResult, String> {
    run_blocking(move || model_config::analyze_prompt_directions(request)).await
}

#[tauri::command]
async fn generate_prompt_image(request: ImageGenerateRequest) -> Result<GeneratedImage, String> {
    run_blocking(move || model_config::generate_prompt_image(request)).await
}

#[tauri::command]
async fn save_generated_image(
    store: State<'_, LocalStore>,
    request: SaveGeneratedImageRequest,
) -> Result<SavedImage, String> {
    let store = store.inner().clone();
    run_blocking(move || storage::save_generated_image(&store, request)).await
}

#[tauri::command]
async fn save_reference_image(
    store: State<'_, LocalStore>,
    request: SaveReferenceImageRequest,
) -> Result<SavedImage, String> {
    let store = store.inner().clone();
    run_blocking(move || storage::save_reference_image(&store, request)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            debug_log::initialize_debug_logging(app.path().app_log_dir()?.join("debug-requests"));
            let local_store = LocalStore::new(app.handle())?;
            app.manage(local_store);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_status,
            load_workspace,
            save_workspace,
            get_storage_info,
            set_data_directory,
            pick_data_directory,
            configure_debug_logging,
            open_debug_log_folder,
            open_project_folder,
            rename_conversation,
            delete_conversation,
            open_image_in_file_manager,
            copy_image_file_to_clipboard,
            save_provider_api_key,
            clear_provider_api_key,
            fetch_provider_models,
            test_provider_connection,
            analyze_prompt_directions,
            generate_prompt_image,
            save_generated_image,
            save_reference_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn validated_image_path(image_path: &str) -> Result<PathBuf, String> {
    let trimmed_path = image_path.trim();
    if trimmed_path.is_empty() {
        return Err("Image path is empty".to_string());
    }

    if trimmed_path.starts_with("data:image/") {
        return Err("Image does not have a local source file".to_string());
    }

    let path = PathBuf::from(trimmed_path);
    if !path.exists() {
        return Err("Image file was not found".to_string());
    }

    if !path.is_file() {
        return Err("Image path is not a file".to_string());
    }

    Ok(path)
}

fn open_image_path_in_file_manager(
    app: &tauri::AppHandle,
    image_path: &str,
) -> Result<(), String> {
    let path = validated_image_path(image_path)?;

    #[cfg(target_os = "windows")]
    {
        open_image_path_in_windows_explorer(app, &path)
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("-R")
            .arg(path.as_os_str())
            .spawn()
            .map(|_| ())
            .or_else(|open_error| {
                open_parent_directory(app, &path).map_err(|opener_error| {
                    format!(
                        "Could not reveal image with open -R: {open_error}; opener fallback failed: {opener_error}"
                    )
                })
            })
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        open_parent_directory(app, &path)
    }
}

#[cfg(target_os = "windows")]
fn open_image_path_in_windows_explorer(
    app: &tauri::AppHandle,
    path: &Path,
) -> Result<(), String> {
    let explorer_path = std::env::var_os("WINDIR")
        .map(PathBuf::from)
        .map(|path| path.join("explorer.exe"))
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows\explorer.exe"));
    let explorer_result = std::process::Command::new(&explorer_path)
        .arg(format!("/select,{}", path.to_string_lossy()))
        .spawn();

    match explorer_result {
        Ok(_) => Ok(()),
        Err(explorer_error) => open_parent_directory(app, path).map_err(|opener_error| {
            format!(
                "Could not open image with {}: {explorer_error}; opener fallback failed: {opener_error}",
                explorer_path.to_string_lossy()
            )
        }),
    }
}

fn open_parent_directory(app: &tauri::AppHandle, path: &Path) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Image file has no parent folder".to_string())?;
    app.opener()
        .open_path(parent.to_string_lossy().into_owned(), None::<&str>)
        .map_err(|error| format!("Could not open image folder: {error}"))
}

fn copy_image_path_to_clipboard(image_path: &str) -> Result<(), String> {
    let path = validated_image_path(image_path)?;

    #[cfg(target_os = "windows")]
    {
        copy_image_path_to_windows_clipboard(&path)
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("Copying image files is only available on Windows in this build".to_string())
    }
}

#[cfg(target_os = "windows")]
fn copy_image_path_to_windows_clipboard(path: &Path) -> Result<(), String> {
    use std::mem::size_of;
    use windows::Win32::Foundation::{GlobalFree, HANDLE};
    use windows::Win32::System::DataExchange::{
        EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::System::Ole::{CF_HDROP, DROPEFFECT_COPY};
    use windows::Win32::UI::Shell::{DROPFILES, CFSTR_FILENAMEW};

    let clipboard_path = clipboard_file_path(path)?;
    let mut encoded_path = clipboard_path.encode_utf16().collect::<Vec<u16>>();
    encoded_path.push(0);
    encoded_path.push(0);

    let file_list_offset = size_of::<DROPFILES>();
    let byte_count = file_list_offset + encoded_path.len() * size_of::<u16>();

    unsafe {
        let memory = GlobalAlloc(GMEM_MOVEABLE, byte_count)
            .map_err(|error| format!("Could not allocate clipboard memory: {error}"))?;
        let memory_pointer = GlobalLock(memory);
        if memory_pointer.is_null() {
            let _ = GlobalFree(Some(memory));
            return Err("Could not lock clipboard memory".to_string());
        }

        std::ptr::write_bytes(memory_pointer, 0, byte_count);

        let drop_files = memory_pointer.cast::<DROPFILES>();
        std::ptr::addr_of_mut!((*drop_files).pFiles).write_unaligned(file_list_offset as u32);
        std::ptr::addr_of_mut!((*drop_files).fWide).write_unaligned(true.into());

        let file_list_pointer = memory_pointer
            .cast::<u8>()
            .add(file_list_offset)
            .cast::<u16>();
        std::ptr::copy_nonoverlapping(
            encoded_path.as_ptr(),
            file_list_pointer,
            encoded_path.len(),
        );

        let _ = GlobalUnlock(memory);

        if let Err(error) = OpenClipboard(None) {
            let _ = GlobalFree(Some(memory));
            return Err(format!("Could not open clipboard: {error}"));
        }
        let _clipboard_guard = ClipboardGuard;

        if let Err(error) = EmptyClipboard() {
            let _ = GlobalFree(Some(memory));
            return Err(format!("Could not empty clipboard: {error}"));
        }
        set_preferred_clipboard_drop_effect(DROPEFFECT_COPY.0)?;
        if let Err(error) = SetClipboardData(CF_HDROP.0.into(), Some(HANDLE(memory.0))) {
            let _ = GlobalFree(Some(memory));
            return Err(format!("Could not set clipboard file data: {error}"));
        }
        let file_name_format = RegisterClipboardFormatW(CFSTR_FILENAMEW);
        if file_name_format != 0 {
            set_clipboard_wide_string(file_name_format, &clipboard_path)?;
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn clipboard_file_path(path: &Path) -> Result<String, String> {
    let absolute_path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()
            .map_err(|error| format!("Could not read current folder: {error}"))?
            .join(path)
    };
    let path = absolute_path.to_string_lossy();

    if let Some(path) = path.strip_prefix(r"\\?\UNC\") {
        return Ok(format!(r"\\{path}"));
    }

    if let Some(path) = path.strip_prefix(r"\\?\") {
        return Ok(path.to_string());
    }

    Ok(path.into_owned())
}

#[cfg(target_os = "windows")]
unsafe fn set_preferred_clipboard_drop_effect(effect: u32) -> Result<(), String> {
    use std::mem::size_of;
    use windows::Win32::Foundation::{GlobalFree, HANDLE};
    use windows::Win32::System::DataExchange::{
        RegisterClipboardFormatW, SetClipboardData,
    };
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::UI::Shell::CFSTR_PREFERREDDROPEFFECT;

    let format = RegisterClipboardFormatW(CFSTR_PREFERREDDROPEFFECT);
    if format == 0 {
        return Err("Could not register preferred drop effect format".to_string());
    }

    let memory = GlobalAlloc(GMEM_MOVEABLE, size_of::<u32>())
        .map_err(|error| format!("Could not allocate clipboard effect memory: {error}"))?;
    let memory_pointer = GlobalLock(memory);
    if memory_pointer.is_null() {
        let _ = GlobalFree(Some(memory));
        return Err("Could not lock clipboard effect memory".to_string());
    }

    std::ptr::write(memory_pointer.cast::<u32>(), effect);
    let _ = GlobalUnlock(memory);

    if let Err(error) = SetClipboardData(format, Some(HANDLE(memory.0))) {
        let _ = GlobalFree(Some(memory));
        return Err(format!("Could not set preferred drop effect: {error}"));
    }

    Ok(())
}

#[cfg(target_os = "windows")]
unsafe fn set_clipboard_wide_string(format: u32, value: &str) -> Result<(), String> {
    use std::mem::size_of;
    use windows::Win32::Foundation::{GlobalFree, HANDLE};
    use windows::Win32::System::DataExchange::SetClipboardData;
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    let mut encoded = value.encode_utf16().collect::<Vec<u16>>();
    encoded.push(0);
    let byte_count = encoded.len() * size_of::<u16>();
    let memory = GlobalAlloc(GMEM_MOVEABLE, byte_count)
        .map_err(|error| format!("Could not allocate clipboard string memory: {error}"))?;
    let memory_pointer = GlobalLock(memory);
    if memory_pointer.is_null() {
        let _ = GlobalFree(Some(memory));
        return Err("Could not lock clipboard string memory".to_string());
    }

    std::ptr::copy_nonoverlapping(encoded.as_ptr(), memory_pointer.cast::<u16>(), encoded.len());
    let _ = GlobalUnlock(memory);

    if let Err(error) = SetClipboardData(format, Some(HANDLE(memory.0))) {
        let _ = GlobalFree(Some(memory));
        return Err(format!("Could not set clipboard string data: {error}"));
    }

    Ok(())
}

#[cfg(target_os = "windows")]
struct ClipboardGuard;

#[cfg(target_os = "windows")]
impl Drop for ClipboardGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::System::DataExchange::CloseClipboard();
        }
    }
}
