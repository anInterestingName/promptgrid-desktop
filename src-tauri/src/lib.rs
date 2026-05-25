mod debug_log;
mod model_config;
mod storage;

use model_config::{
    GeneratedImage, ImageGenerateRequest, ModelFetchRequest, ModelOption, ModelTestRequest,
    ModelTestResult, PromptAnalysisResult, PromptAnalyzeRequest,
};
use storage::{AppSnapshot, LocalStore, SaveGeneratedImageRequest, SavedImage, StorageInfo};
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
    "PromptGrid local runtime ready"
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
            save_provider_api_key,
            clear_provider_api_key,
            fetch_provider_models,
            test_provider_connection,
            analyze_prompt_directions,
            generate_prompt_image,
            save_generated_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
