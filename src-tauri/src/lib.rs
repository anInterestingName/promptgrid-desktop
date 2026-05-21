mod model_config;
mod storage;

use model_config::{
    GeneratedImage, ImageGenerateRequest, ModelFetchRequest, ModelOption, ModelTestRequest,
    ModelTestResult, PromptAnalyzeRequest, PromptDirection,
};
use storage::{AppSnapshot, LocalStore, StorageInfo};
use tauri::{Manager, State};

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
) -> Result<Vec<PromptDirection>, String> {
    run_blocking(move || model_config::analyze_prompt_directions(request)).await
}

#[tauri::command]
async fn generate_prompt_image(request: ImageGenerateRequest) -> Result<GeneratedImage, String> {
    run_blocking(move || model_config::generate_prompt_image(request)).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
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
            save_provider_api_key,
            clear_provider_api_key,
            fetch_provider_models,
            test_provider_connection,
            analyze_prompt_directions,
            generate_prompt_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
