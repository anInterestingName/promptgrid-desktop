mod model_config;
mod storage;

use model_config::{ModelFetchRequest, ModelOption};
use storage::{AppSnapshot, LocalStore};
use tauri::{Manager, State};

#[tauri::command]
fn app_status() -> &'static str {
    "PromptGrid local runtime ready"
}

#[tauri::command]
fn load_workspace(store: State<'_, LocalStore>) -> Result<Option<AppSnapshot>, String> {
    storage::load_workspace(&store)
}

#[tauri::command]
fn save_workspace(store: State<'_, LocalStore>, snapshot: AppSnapshot) -> Result<(), String> {
    storage::save_workspace(&store, snapshot)
}

#[tauri::command]
fn save_provider_api_key(provider: String, api_key: String) -> Result<bool, String> {
    model_config::save_provider_api_key(&provider, &api_key)
}

#[tauri::command]
fn clear_provider_api_key(provider: String) -> Result<bool, String> {
    model_config::clear_provider_api_key(&provider)
}

#[tauri::command]
fn fetch_provider_models(request: ModelFetchRequest) -> Result<Vec<ModelOption>, String> {
    model_config::fetch_provider_models(request)
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
            save_provider_api_key,
            clear_provider_api_key,
            fetch_provider_models
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
