use rusqlite::types::Type;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

const SETTINGS_KEY: &str = "app_settings";
const DATABASE_FILE_NAME: &str = "app.db";
const PROJECT_DATABASE_FILE_NAME: &str = "project.db";
const STORAGE_CONFIG_FILE_NAME: &str = "storage-config.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    id: String,
    title: String,
    project_directory: Option<String>,
    original_prompt: String,
    style: String,
    grid_size: i64,
    aspect_ratio: String,
    quality: String,
    #[serde(default = "default_output_size")]
    output_size: String,
    schema_version: i64,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    id: String,
    project_id: String,
    title: String,
    original_prompt: String,
    style: String,
    grid_size: i64,
    aspect_ratio: String,
    quality: String,
    #[serde(default = "default_output_size")]
    output_size: String,
    schema_version: i64,
    created_at: String,
    updated_at: String,
    workflow_mode: Option<String>,
    main_detail: Option<serde_json::Value>,
    #[serde(default)]
    configuration_locked: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "default_provider_configs")]
    providers: ProviderConfigs,
    #[serde(default = "default_active_model_selection")]
    active_model_selection: ActiveModelSelection,
    #[serde(default = "default_workflow_configs")]
    workflow_configs: serde_json::Value,
    #[serde(default = "default_show_workflow_config_editor")]
    show_workflow_config_editor: bool,
    #[serde(default)]
    debug_logging_enabled: bool,
    #[serde(default = "default_debug_log_retention_days")]
    debug_log_retention_days: i64,
    max_concurrency: i64,
    default_grid_size: i64,
    default_aspect_ratio: String,
    output_directory: Option<String>,
    #[serde(default, skip_serializing)]
    api_provider: Option<String>,
    #[serde(default, skip_serializing)]
    text_model: Option<String>,
    #[serde(default, skip_serializing)]
    image_model: Option<String>,
    #[serde(default, skip_serializing)]
    open_ai_base_url: Option<String>,
    #[serde(default, skip_serializing)]
    open_ai_api_key_saved: Option<bool>,
    #[serde(default, skip_serializing)]
    open_ai_api_key: Option<String>,
    #[serde(default, skip_serializing)]
    custom_provider_name: Option<String>,
    #[serde(default, skip_serializing)]
    custom_base_url: Option<String>,
    #[serde(default, skip_serializing)]
    custom_api_key_saved: Option<bool>,
    #[serde(default, skip_serializing)]
    custom_api_key: Option<String>,
    #[serde(default, skip_serializing)]
    custom_text_model: Option<String>,
    #[serde(default, skip_serializing)]
    custom_image_model: Option<String>,
    #[serde(default, skip_serializing)]
    custom_headers: Option<String>,
    #[serde(default, skip_serializing)]
    reasoning_enabled: Option<bool>,
    #[serde(default, skip_serializing)]
    reasoning_effort: Option<String>,
    #[serde(default, skip_serializing)]
    response_verbosity: Option<String>,
    #[serde(default, skip_serializing)]
    stream_responses: Option<bool>,
    #[serde(default, skip_serializing)]
    model_routing: Option<ModelRoutingSettings>,
    #[serde(default, skip_serializing)]
    text_runtime: Option<TextModelSettings>,
    #[serde(default, skip_serializing)]
    image_runtime: Option<TextModelSettings>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfigs {
    #[serde(default = "default_openai_provider_config")]
    openai: ProviderConfig,
    #[serde(default = "default_deepseek_provider_config")]
    deepseek: ProviderConfig,
    #[serde(rename = "openai-compatible")]
    #[serde(default = "default_openai_compatible_provider_config")]
    openai_compatible: ProviderConfig,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    enabled: bool,
    base_url: String,
    #[serde(default)]
    api_key_saved: bool,
    custom_headers: Option<String>,
    #[serde(default = "default_text_model_settings")]
    text_model: TextModelSettings,
    #[serde(default = "default_image_model_settings")]
    image_model: ImageModelSettings,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveModelSelection {
    text: ModelRoute,
    image: ModelRoute,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRoute {
    provider_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRoutingSettings {
    text: LegacyModelRoute,
    image: LegacyModelRoute,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyModelRoute {
    provider_id: String,
    model: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextModelSettings {
    #[serde(default)]
    model: String,
    #[serde(default)]
    reasoning_enabled: bool,
    #[serde(default = "default_reasoning_effort")]
    reasoning_effort: String,
    #[serde(default = "default_response_verbosity")]
    response_verbosity: String,
    #[serde(default)]
    stream_responses: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageModelSettings {
    #[serde(default)]
    model: String,
    #[serde(default)]
    reasoning_enabled: bool,
    #[serde(default = "default_reasoning_effort")]
    reasoning_effort: String,
    #[serde(default = "default_response_verbosity")]
    response_verbosity: String,
    #[serde(default)]
    stream_responses: bool,
    #[serde(default = "default_image_quality")]
    quality: String,
    #[serde(default = "default_image_background")]
    background: String,
    #[serde(default = "default_image_output_format")]
    output_format: String,
    #[serde(default = "default_image_output_compression")]
    output_compression: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MockVisual {
    title: String,
    palette: [String; 3],
    texture: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GridCell {
    id: String,
    project_id: String,
    #[serde(default)]
    conversation_id: Option<String>,
    #[serde(default)]
    grid_size: Option<i64>,
    parent_task_id: Option<String>,
    exploration_round: i64,
    index: i64,
    prompt: String,
    direction_title: Option<String>,
    status: String,
    image_path: Option<String>,
    error_message: Option<String>,
    provider: String,
    model: String,
    created_at: String,
    updated_at: String,
    attempt: i64,
    visual: MockVisual,
    role: Option<String>,
    #[serde(default)]
    reference_images: Vec<ImageReference>,
    depends_on_task_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageReference {
    id: String,
    role: String,
    image_path: String,
    name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSnapshot {
    project: Project,
    #[serde(default)]
    conversation: Option<Conversation>,
    #[serde(default)]
    active_conversation_id: Option<String>,
    #[serde(default)]
    projects: Vec<Project>,
    #[serde(default)]
    conversations: Vec<Conversation>,
    tasks: Vec<GridCell>,
    #[serde(default)]
    conversation_tasks: HashMap<String, Vec<GridCell>>,
    settings: AppSettings,
    selected_task_id: Option<String>,
    current_round: i64,
    #[serde(default)]
    workflow_mode: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    default_data_dir: String,
    current_data_dir: String,
    database_path: String,
    uses_custom_data_dir: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveGeneratedImageRequest {
    image_data_url: String,
    project_id: String,
    project_title: String,
    project_directory: Option<String>,
    conversation_id: String,
    grid_size: i64,
    exploration_round: i64,
    cell_index: i64,
    attempt: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveReferenceImageRequest {
    image_data_url: String,
    project_id: String,
    project_title: String,
    project_directory: Option<String>,
    conversation_id: String,
    name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedImage {
    image_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationMutationResult {
    conversation: Option<Conversation>,
    project: Option<Project>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StorageConfig {
    data_directory: Option<String>,
}

#[derive(Clone)]
pub struct LocalStore {
    connection: Arc<Mutex<Connection>>,
    config_path: PathBuf,
    default_data_dir: PathBuf,
    data_dir: Arc<Mutex<PathBuf>>,
}

impl LocalStore {
    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let default_data_dir = app.path().app_data_dir()?;
        fs::create_dir_all(&default_data_dir)?;

        let config_path = default_data_dir.join(STORAGE_CONFIG_FILE_NAME);
        let data_dir = read_storage_config(&config_path)?
            .and_then(|config| config.data_directory)
            .map(PathBuf::from)
            .unwrap_or_else(|| default_data_dir.clone());
        fs::create_dir_all(&data_dir)?;

        let database_path = data_dir.join(DATABASE_FILE_NAME);
        if data_dir != default_data_dir && !database_path.exists() {
            let default_database_path = default_data_dir.join(DATABASE_FILE_NAME);
            if default_database_path.exists() {
                let default_connection = Connection::open(default_database_path)?;
                let target_database = path_to_sqlite_string(&database_path);
                default_connection.execute("VACUUM INTO ?1", params![target_database])?;
            }
        }

        let connection = Connection::open(&database_path)?;
        migrate(&connection)?;

        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
            config_path,
            default_data_dir,
            data_dir: Arc::new(Mutex::new(data_dir)),
        })
    }
}

pub fn storage_info(store: &LocalStore) -> Result<StorageInfo, String> {
    let data_dir = store
        .data_dir
        .lock()
        .map_err(|_| "Storage path lock is poisoned".to_string())?
        .clone();

    if data_dir != store.default_data_dir {
        cleanup_inactive_database_files(&store.default_data_dir, &data_dir)?;
    }

    Ok(build_storage_info(store, &data_dir))
}

pub fn set_data_directory(
    store: &LocalStore,
    directory: Option<String>,
) -> Result<StorageInfo, String> {
    let target_data_dir = normalize_data_directory(directory, &store.default_data_dir)?;
    fs::create_dir_all(&target_data_dir)
        .map_err(|error| format!("Could not create data directory: {error}"))?;

    if !target_data_dir.is_dir() {
        return Err("Data storage path must be a folder".to_string());
    }

    let target_database_path = target_data_dir.join(DATABASE_FILE_NAME);
    let current_data_dir = store
        .data_dir
        .lock()
        .map_err(|_| "Storage path lock is poisoned".to_string())?
        .clone();
    let current_database_path = current_data_dir.join(DATABASE_FILE_NAME);
    let should_copy_current_database =
        current_database_path != target_database_path && !target_database_path.exists();

    {
        let mut connection = store
            .connection
            .lock()
            .map_err(|_| "Database lock is poisoned".to_string())?;

        if should_copy_current_database {
            let target_database = path_to_sqlite_string(&target_database_path);
            connection
                .execute("VACUUM INTO ?1", params![target_database])
                .map_err(|error| format!("Could not copy database to new data folder: {error}"))?;
        }

        let next_connection = Connection::open(&target_database_path)
            .map_err(|error| format!("Could not open database in data folder: {error}"))?;
        migrate(&next_connection).map_err(|error| error.to_string())?;
        *connection = next_connection;
    }

    {
        let mut data_dir = store
            .data_dir
            .lock()
            .map_err(|_| "Storage path lock is poisoned".to_string())?;
        *data_dir = target_data_dir.clone();
    }

    write_storage_config(store, &target_data_dir)?;
    if should_copy_current_database {
        cleanup_inactive_database_files(&current_data_dir, &target_data_dir)?;
    }

    Ok(build_storage_info(store, &target_data_dir))
}

#[cfg(target_os = "windows")]
pub fn pick_data_directory() -> Result<Option<String>, String> {
    use windows::core::{HRESULT, PCWSTR};
    use windows::Win32::Foundation::{ERROR_CANCELLED, RPC_E_CHANGED_MODE};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{
        FileOpenDialog, IFileOpenDialog, FOS_FORCEFILESYSTEM, FOS_PATHMUSTEXIST, FOS_PICKFOLDERS,
        SIGDN_FILESYSPATH,
    };

    unsafe {
        let init_result = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        if init_result == RPC_E_CHANGED_MODE {
            return Err(
                "Could not open folder picker: COM is already initialized in a different mode"
                    .to_string(),
            );
        }
        init_result
            .ok()
            .map_err(|error| format!("Could not initialize folder picker: {error}"))?;
        let _com_guard = ComApartmentGuard;

        let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)
            .map_err(|error| format!("Could not create folder picker: {error}"))?;
        let options = dialog
            .GetOptions()
            .map_err(|error| format!("Could not read folder picker options: {error}"))?
            | FOS_PICKFOLDERS
            | FOS_FORCEFILESYSTEM
            | FOS_PATHMUSTEXIST;
        dialog
            .SetOptions(options)
            .map_err(|error| format!("Could not configure folder picker: {error}"))?;

        let title = null_terminated_wide("选择文件夹");
        dialog
            .SetTitle(PCWSTR::from_raw(title.as_ptr()))
            .map_err(|error| format!("Could not set folder picker title: {error}"))?;
        let ok_label = null_terminated_wide("选择文件夹");
        dialog
            .SetOkButtonLabel(PCWSTR::from_raw(ok_label.as_ptr()))
            .map_err(|error| format!("Could not set folder picker label: {error}"))?;

        if let Err(error) = dialog.Show(None) {
            if error.code() == HRESULT::from_win32(ERROR_CANCELLED.0) {
                return Ok(None);
            }
            return Err(format!("Could not show folder picker: {error}"));
        }

        let result = dialog
            .GetResult()
            .map_err(|error| format!("Could not read selected folder: {error}"))?;
        let path_pointer = result
            .GetDisplayName(SIGDN_FILESYSPATH)
            .map_err(|error| format!("Could not read selected folder path: {error}"))?;
        let path_result = path_pointer
            .to_string()
            .map_err(|error| format!("Could not decode selected folder path: {error}"));
        CoTaskMemFree(Some(path_pointer.as_ptr().cast()));
        let path = path_result?;

        Ok(Some(path))
    }
}

#[cfg(not(target_os = "windows"))]
pub fn pick_data_directory() -> Result<Option<String>, String> {
    Err("Folder picker is only available on Windows in this build".to_string())
}

pub fn load_workspace(store: &LocalStore) -> Result<Option<AppSnapshot>, String> {
    let mut connection = store
        .connection
        .lock()
        .map_err(|_| "Database lock is poisoned".to_string())?;

    recover_project_files(store, &connection)?;

    let projects = read_projects(&connection)?;
    let projects = prune_missing_project_folders(store, &mut connection, projects)?;

    if projects.is_empty() {
        return Ok(None);
    }

    let app_state = connection
        .query_row(
            "
            SELECT selected_project_id, selected_conversation_id, selected_task_id, current_round
            FROM app_state
            WHERE id = 1
            ",
            [],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;

    let (selected_project_id, selected_conversation_id, selected_task_id, current_round) =
        app_state.unwrap_or((None, None, None, 1));

    let data_dir = store
        .data_dir
        .lock()
        .map_err(|_| "Storage path lock is poisoned".to_string())?
        .clone();
    let conversations = read_project_conversations(&data_dir, &projects)?;

    let project = selected_project_id
        .as_deref()
        .and_then(|project_id| projects.iter().find(|candidate| candidate.id == project_id))
        .unwrap_or(&projects[0])
        .clone();
    let conversation = selected_conversation_id
        .as_deref()
        .and_then(|conversation_id| {
            conversations.iter().find(|candidate| {
                candidate.id == conversation_id && candidate.project_id == project.id
            })
        })
        .or_else(|| {
            conversations
                .iter()
                .filter(|candidate| candidate.project_id == project.id)
                .max_by(|left, right| left.updated_at.cmp(&right.updated_at))
        })
        .cloned();
    let active_project = conversation
        .as_ref()
        .map(|conversation| merge_project_with_conversation(project.clone(), conversation))
        .unwrap_or_else(|| project.clone());

    let conversation_tasks = read_project_conversation_tasks(&data_dir, &projects, &conversations)?;

    let tasks = conversation
        .as_ref()
        .and_then(|conversation| {
            conversation_tasks.get(&grid_run_key(&conversation.id, conversation.grid_size))
        })
        .cloned()
        .unwrap_or_default();

    let settings_json = connection
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![SETTINGS_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    let mut settings = settings_json
        .map(|json| serde_json::from_str::<AppSettings>(&json))
        .transpose()
        .map_err(|error| error.to_string())?
        .unwrap_or_else(default_settings);
    migrate_legacy_api_keys(&mut settings)?;
    refresh_api_key_status(&mut settings);
    let settings_json = serde_json::to_string(&settings).map_err(|error| error.to_string())?;
    connection
        .execute(
            "
            INSERT INTO settings (key, value, updated_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
            ",
            params![SETTINGS_KEY, settings_json, project.updated_at.as_str()],
        )
        .map_err(|error| error.to_string())?;

    Ok(Some(AppSnapshot {
        project: active_project,
        conversation: conversation.clone(),
        active_conversation_id: conversation
            .as_ref()
            .map(|conversation| conversation.id.clone()),
        projects,
        conversations,
        tasks,
        conversation_tasks,
        settings,
        selected_task_id,
        current_round,
        workflow_mode: conversation
            .as_ref()
            .and_then(|conversation| conversation.workflow_mode.clone()),
    }))
}

pub fn save_workspace(store: &LocalStore, snapshot: AppSnapshot) -> Result<(), String> {
    let AppSnapshot {
        project,
        conversation,
        active_conversation_id,
        mut projects,
        mut conversations,
        tasks,
        mut conversation_tasks,
        mut settings,
        selected_task_id,
        current_round,
        workflow_mode: _workflow_mode,
    } = snapshot;
    migrate_legacy_api_keys(&mut settings)?;
    refresh_api_key_status(&mut settings);
    let has_persisted_projects = !projects.is_empty() || conversation.is_some();
    if has_persisted_projects {
        upsert_project(&mut projects, project.clone());
    }
    if let Some(conversation) = conversation.as_ref() {
        upsert_conversation(&mut conversations, conversation.clone());
    }
    let active_conversation_id = active_conversation_id.filter(|conversation_id| {
        conversations
            .iter()
            .any(|conversation| conversation.id == *conversation_id)
    });
    if has_persisted_projects {
        if let Some(active_conversation_id) = active_conversation_id.as_ref() {
            let active_grid_size = conversation
                .as_ref()
                .map(|conversation| conversation.grid_size)
                .unwrap_or(project.grid_size);
            conversation_tasks.insert(
                grid_run_key(active_conversation_id, active_grid_size),
                tasks,
            );
        }
    }
    let project_files_projects = projects.clone();
    let project_files_conversations = conversations.clone();
    let project_files_tasks = conversation_tasks.clone();

    let mut connection = store
        .connection
        .lock()
        .map_err(|_| "Database lock is poisoned".to_string())?;
    let previous_projects = read_projects(&connection)?;
    let current_project_ids = projects
        .iter()
        .map(|project| project.id.as_str())
        .collect::<HashSet<_>>();
    let removed_projects = previous_projects
        .iter()
        .filter(|project| !current_project_ids.contains(project.id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let now = project.updated_at.clone();

    for project in &projects {
        write_project_record(&transaction, project)?;
    }

    for removed_project in &removed_projects {
        write_removed_project_record(&transaction, removed_project, &now)?;
        transaction
            .execute(
                "DELETE FROM image_tasks WHERE project_id = ?1",
                params![&removed_project.id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM conversations WHERE project_id = ?1",
                params![&removed_project.id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute("DELETE FROM projects WHERE id = ?1", params![&removed_project.id])
            .map_err(|error| error.to_string())?;
    }

    let settings_json = serde_json::to_string(&settings).map_err(|error| error.to_string())?;
    transaction
        .execute(
            "
            INSERT INTO settings (key, value, updated_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
            ",
            params![SETTINGS_KEY, settings_json, now],
        )
        .map_err(|error| error.to_string())?;

    transaction
        .execute(
            "
            INSERT INTO app_state (
                id, selected_project_id, selected_conversation_id,
                selected_task_id, current_round, updated_at
            )
            VALUES (1, ?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(id) DO UPDATE SET
                selected_project_id = excluded.selected_project_id,
                selected_conversation_id = excluded.selected_conversation_id,
                selected_task_id = excluded.selected_task_id,
                current_round = excluded.current_round,
                updated_at = excluded.updated_at
            ",
            params![
                if has_persisted_projects {
                    Some(project.id.as_str())
                } else {
                    None
                },
                active_conversation_id,
                selected_task_id,
                current_round,
                now
            ],
        )
        .map_err(|error| error.to_string())?;

    transaction.commit().map_err(|error| error.to_string())?;
    rename_default_project_folders(store, &previous_projects, &project_files_projects)?;
    sync_project_databases(
        store,
        &project_files_projects,
        &project_files_conversations,
        &project_files_tasks,
    )?;
    sync_project_files(
        store,
        &project_files_projects,
        &project_files_conversations,
        &project_files_tasks,
    )
}

pub fn open_project_directory(
    store: &LocalStore,
    directory: &str,
    opened_at: &str,
) -> Result<AppSnapshot, String> {
    let opened_at = opened_at.trim();
    if opened_at.is_empty() {
        return Err("Project open time cannot be empty".to_string());
    }

    let project_directory = validate_project_directory(directory)?;
    let project = match read_json_file::<Project>(&project_directory.join("project.json"))? {
        Some(mut project) => {
            project.project_directory = Some(path_to_display_string(&project_directory));
            project
        }
        None => create_project_for_directory(&project_directory, opened_at)?,
    };

    ensure_project_layout_at_path(&project_directory, &project)?;
    let project_connection = Connection::open(project_directory.join(PROJECT_DATABASE_FILE_NAME))
        .map_err(|error| format!("Could not open project database: {error}"))?;
    migrate_project_database(&project_connection).map_err(|error| error.to_string())?;
    write_project_state(&project_connection, &project)?;

    {
        let mut connection = store
            .connection
            .lock()
            .map_err(|_| "Database lock is poisoned".to_string())?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        write_project_record(&transaction, &project)?;
        transaction
            .execute(
                "
                INSERT INTO app_state (
                    id, selected_project_id, selected_conversation_id,
                    selected_task_id, current_round, updated_at
                )
                VALUES (1, ?1, NULL, NULL, 1, ?2)
                ON CONFLICT(id) DO UPDATE SET
                    selected_project_id = excluded.selected_project_id,
                    selected_conversation_id = NULL,
                    selected_task_id = NULL,
                    current_round = 1,
                    updated_at = excluded.updated_at
                ",
                params![&project.id, opened_at],
            )
            .map_err(|error| error.to_string())?;
        transaction.commit().map_err(|error| error.to_string())?;
    }

    load_workspace(store)?.ok_or_else(|| "Could not load opened project".to_string())
}

pub fn save_generated_image(
    store: &LocalStore,
    request: SaveGeneratedImageRequest,
) -> Result<SavedImage, String> {
    let data_dir = store
        .data_dir
        .lock()
        .map_err(|_| "Storage path lock is poisoned".to_string())?
        .clone();
    let project_directory = resolve_project_directory(
        &data_dir,
        &request.project_id,
        &request.project_title,
        request.project_directory.as_deref(),
    )?;
    let image_directory = project_directory
        .join("conversations")
        .join(sanitize_path_component(&request.conversation_id))
        .join("images")
        .join(format!("grid-{}", request.grid_size.max(1)));
    fs::create_dir_all(&image_directory)
        .map_err(|error| format!("Could not create image folder: {error}"))?;

    let (extension, bytes) = decode_image_data_url(&request.image_data_url)?;
    let image_path = image_directory.join(format!(
        "round-{round:03}-cell-{cell:03}-attempt-{attempt:03}.{extension}",
        round = request.exploration_round.max(1),
        cell = request.cell_index + 1,
        attempt = request.attempt.max(1),
    ));
    fs::write(&image_path, bytes)
        .map_err(|error| format!("Could not save generated image: {error}"))?;

    Ok(SavedImage {
        image_path: path_to_display_string(&image_path),
    })
}

pub fn save_reference_image(
    store: &LocalStore,
    request: SaveReferenceImageRequest,
) -> Result<SavedImage, String> {
    let data_dir = store
        .data_dir
        .lock()
        .map_err(|_| "Storage path lock is poisoned".to_string())?
        .clone();
    let project_directory = resolve_project_directory(
        &data_dir,
        &request.project_id,
        &request.project_title,
        request.project_directory.as_deref(),
    )?;
    let reference_directory = project_directory
        .join("conversations")
        .join(sanitize_path_component(&request.conversation_id))
        .join("references");
    fs::create_dir_all(&reference_directory)
        .map_err(|error| format!("Could not create reference image folder: {error}"))?;

    let (extension, bytes) = decode_image_data_url(&request.image_data_url)?;
    let base_name = request
        .name
        .as_deref()
        .map(sanitize_path_component)
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "source".to_string());
    let image_path = reference_directory.join(format!(
        "{base_name}-{timestamp}.{extension}",
        timestamp = chrono_like_timestamp()
    ));
    fs::write(&image_path, bytes)
        .map_err(|error| format!("Could not save reference image: {error}"))?;

    Ok(SavedImage {
        image_path: path_to_display_string(&image_path),
    })
}

pub fn project_directory(
    store: &LocalStore,
    project_id: &str,
    project_title: &str,
    project_directory: Option<&str>,
    ) -> Result<PathBuf, String> {
        let data_dir = store
            .data_dir
        .lock()
        .map_err(|_| "Storage path lock is poisoned".to_string())?
        .clone();
    let project_directory =
        resolve_project_directory(&data_dir, project_id, project_title, project_directory)?;
    fs::create_dir_all(&project_directory)
        .map_err(|error| format!("Could not create project folder: {error}"))?;
    fs::create_dir_all(project_directory.join("conversations"))
        .map_err(|error| format!("Could not create conversations folder: {error}"))?;
    fs::create_dir_all(project_directory.join("assets"))
        .map_err(|error| format!("Could not create project assets folder: {error}"))?;
    let connection = Connection::open(project_directory.join(PROJECT_DATABASE_FILE_NAME))
        .map_err(|error| format!("Could not open project database: {error}"))?;
    migrate_project_database(&connection).map_err(|error| error.to_string())?;

    Ok(project_directory)
}

pub fn rename_conversation(
    store: &LocalStore,
    conversation_id: &str,
    title: &str,
    updated_at: &str,
) -> Result<ConversationMutationResult, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("Conversation title cannot be empty".to_string());
    }
    let updated_at = updated_at.trim();
    if updated_at.is_empty() {
        return Err("Conversation updated time cannot be empty".to_string());
    }

    let mut global_connection = store
        .connection
        .lock()
        .map_err(|_| "Database lock is poisoned".to_string())?;
    let project = find_project_for_conversation(store, &global_connection, conversation_id)?
        .ok_or_else(|| "Conversation was not found".to_string())?;
    let data_dir = store
        .data_dir
        .lock()
        .map_err(|_| "Storage path lock is poisoned".to_string())?
        .clone();
    let mut project_connection = open_project_database(&data_dir, &project)?;
    let conversation = read_conversation_by_id(&project_connection, conversation_id)?
        .ok_or_else(|| "Conversation was not found".to_string())?;
    let duplicate_title = project_connection
        .query_row(
            "
            SELECT 1
            FROM conversations
            WHERE project_id = ?1
              AND id <> ?2
              AND lower(trim(title)) = lower(trim(?3))
            LIMIT 1
            ",
            params![&conversation.project_id, conversation_id, title],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .is_some();
    if duplicate_title {
        return Err("Conversation title already exists in this project".to_string());
    }

    let transaction = project_connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "
            UPDATE conversations
            SET title = ?1, updated_at = ?2
            WHERE id = ?3
            ",
            params![title, updated_at, conversation_id],
        )
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;

    let renamed_conversation = read_conversation_by_id(&project_connection, conversation_id)?;
    let project = update_project_updated_at(&mut global_connection, &project.id, updated_at)?;
    if let (Some(project), Some(conversation)) = (project.as_ref(), renamed_conversation.as_ref()) {
        write_conversation_manifest(store, project, conversation)?;
    }

    Ok(ConversationMutationResult {
        conversation: renamed_conversation,
        project,
    })
}

pub fn delete_conversation(
    store: &LocalStore,
    conversation_id: &str,
    updated_at: &str,
) -> Result<ConversationMutationResult, String> {
    let updated_at = updated_at.trim();
    if updated_at.is_empty() {
        return Err("Conversation updated time cannot be empty".to_string());
    }

    let mut global_connection = store
        .connection
        .lock()
        .map_err(|_| "Database lock is poisoned".to_string())?;
    let project = find_project_for_conversation(store, &global_connection, conversation_id)?
        .ok_or_else(|| "Conversation was not found".to_string())?;
    let data_dir = store
        .data_dir
        .lock()
        .map_err(|_| "Storage path lock is poisoned".to_string())?
        .clone();
    let mut project_connection = open_project_database(&data_dir, &project)?;
    let conversation = read_conversation_by_id(&project_connection, conversation_id)?
        .ok_or_else(|| "Conversation was not found".to_string())?;
    let conversation_directory = conversation_directory(store, &project, &conversation)?;

    let transaction = project_connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM image_tasks WHERE conversation_id = ?1",
            params![conversation_id],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM conversations WHERE id = ?1",
            params![conversation_id],
        )
        .map_err(|error| error.to_string())?;
    let next_conversation_id = transaction
        .query_row(
            "
            SELECT id
            FROM conversations
            WHERE project_id = ?1
            ORDER BY updated_at DESC
            LIMIT 1
            ",
            params![&conversation.project_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let deleted_directory = if conversation_directory.exists() {
        fs::remove_dir_all(&conversation_directory).map_err(|error| {
            format!(
                "Could not delete conversation folder {}: {error}",
                path_to_display_string(&conversation_directory)
            )
        })?;
        true
    } else {
        false
    };

    if let Err(error) = transaction.commit() {
        if deleted_directory {
            let _ = fs::create_dir_all(&conversation_directory);
        }
        return Err(error.to_string());
    }

    let next_conversation = next_conversation_id
        .as_deref()
        .map(|id| read_conversation_by_id(&project_connection, id))
        .transpose()?
        .flatten();
    let project = update_project_updated_at(&mut global_connection, &conversation.project_id, updated_at)?;
    global_connection
        .execute(
            "
            UPDATE app_state
            SET selected_conversation_id = ?1,
                selected_task_id = NULL,
                current_round = 1,
                updated_at = ?2
            WHERE selected_conversation_id = ?3
            ",
            params![&next_conversation_id, updated_at, conversation_id],
        )
        .map_err(|error| error.to_string())?;

    Ok(ConversationMutationResult {
        conversation: next_conversation,
        project,
    })
}

fn rename_default_project_folders(
    store: &LocalStore,
    previous_projects: &[Project],
    projects: &[Project],
) -> Result<(), String> {
    let data_dir = store
        .data_dir
        .lock()
        .map_err(|_| "Storage path lock is poisoned".to_string())?
        .clone();

    for project in projects {
        if project.project_directory.is_some() {
            continue;
        }

        let Some(previous_project) = previous_projects
            .iter()
            .find(|candidate| candidate.id == project.id)
        else {
            continue;
        };

        if previous_project.project_directory.is_some()
            || previous_project.title == project.title
        {
            continue;
        }

        let old_directory =
            resolve_project_directory(&data_dir, &project.id, &previous_project.title, None)?;
        let new_directory =
            resolve_project_directory(&data_dir, &project.id, &project.title, None)?;

        if old_directory == new_directory || !old_directory.exists() {
            continue;
        }

        if new_directory.exists() {
            return Err(format!(
                "Project folder already exists: {}",
                path_to_display_string(&new_directory)
            ));
        }

        fs::rename(&old_directory, &new_directory).map_err(|error| {
            format!(
                "Could not rename project folder from {} to {}: {error}",
                path_to_display_string(&old_directory),
                path_to_display_string(&new_directory)
            )
        })?;
    }

    Ok(())
}

fn sync_project_files(
    store: &LocalStore,
    projects: &[Project],
    conversations: &[Conversation],
    conversation_tasks: &HashMap<String, Vec<GridCell>>,
) -> Result<(), String> {
    let data_dir = store
        .data_dir
        .lock()
        .map_err(|_| "Storage path lock is poisoned".to_string())?
        .clone();

    for project in projects {
        let project_directory = resolve_project_directory(
            &data_dir,
            &project.id,
            &project.title,
            project.project_directory.as_deref(),
        )?;
        fs::create_dir_all(&project_directory)
            .map_err(|error| format!("Could not create project folder: {error}"))?;
        write_json_file(&project_directory.join("project.json"), project)?;

        for conversation in conversations
            .iter()
            .filter(|conversation| conversation.project_id == project.id)
        {
            let conversation_directory = project_directory
                .join("conversations")
                .join(sanitize_path_component(&conversation.id));
            fs::create_dir_all(&conversation_directory)
                .map_err(|error| format!("Could not create conversation folder: {error}"))?;
            write_json_file(
                &conversation_directory.join("conversation.json"),
                conversation,
            )?;
            for (task_key, tasks) in conversation_tasks
                .iter()
                .filter(|(task_key, _)| {
                    conversation_id_from_task_key(task_key) == conversation.id
                })
            {
                let grid_size = grid_size_from_task_key(task_key)
                    .unwrap_or(conversation.grid_size);
                let grid_run_directory = conversation_directory
                    .join("grid-runs")
                    .join(format!("grid-{grid_size}"));
                fs::create_dir_all(&grid_run_directory)
                    .map_err(|error| format!("Could not create grid run folder: {error}"))?;
                write_json_file(&grid_run_directory.join("tasks.json"), tasks)?;
            }
        }
    }

    Ok(())
}

fn sync_project_databases(
    store: &LocalStore,
    projects: &[Project],
    conversations: &[Conversation],
    conversation_tasks: &HashMap<String, Vec<GridCell>>,
) -> Result<(), String> {
    let data_dir = store
        .data_dir
        .lock()
        .map_err(|_| "Storage path lock is poisoned".to_string())?
        .clone();

    for project in projects {
        ensure_project_layout(&data_dir, project)?;
        let mut connection = open_project_database(&data_dir, project)?;
        let transaction = connection
            .transaction()
            .map_err(|error| error.to_string())?;
        write_project_state(&transaction, project)?;
        transaction
            .execute("DELETE FROM image_tasks", [])
            .map_err(|error| error.to_string())?;
        transaction
            .execute("DELETE FROM conversations", [])
            .map_err(|error| error.to_string())?;

        for conversation in conversations
            .iter()
            .filter(|conversation| conversation.project_id == project.id)
        {
            write_conversation_record(&transaction, conversation)?;
            transaction
                .execute(
                    "
                    INSERT INTO grid_runs (
                        id, conversation_id, grid_size, created_at, updated_at
                    )
                    VALUES (?1, ?2, ?3, ?4, ?5)
                    ON CONFLICT(id) DO UPDATE SET
                        conversation_id = excluded.conversation_id,
                        grid_size = excluded.grid_size,
                        updated_at = excluded.updated_at
                    ",
                    params![
                        grid_run_key(&conversation.id, conversation.grid_size),
                        &conversation.id,
                        conversation.grid_size,
                        &conversation.created_at,
                        &conversation.updated_at,
                    ],
                )
                .map_err(|error| error.to_string())?;
        }

        let project_conversation_ids = conversations
            .iter()
            .filter(|conversation| conversation.project_id == project.id)
            .map(|conversation| conversation.id.as_str())
            .collect::<HashSet<_>>();
        let mut seen_task_ids = HashSet::new();
        for (task_key, tasks) in conversation_tasks {
            let conversation_id = conversation_id_from_task_key(task_key);
            if !project_conversation_ids.contains(conversation_id.as_str()) {
                continue;
            }

            for task in tasks {
                if !seen_task_ids.insert(task.id.clone()) {
                    continue;
                }
                let mut task = task.clone();
                if task.project_id.is_empty() {
                    task.project_id = project.id.clone();
                }
                if task.conversation_id.is_none() {
                    task.conversation_id = Some(conversation_id.clone());
                }
                write_task_record(&transaction, task)?;
            }
        }

        transaction.commit().map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn read_project_conversations(
    data_dir: &Path,
    projects: &[Project],
) -> Result<Vec<Conversation>, String> {
    let mut conversations = Vec::new();
    for project in projects {
        let connection = open_project_database(data_dir, project)?;
        let mut project_conversations = read_conversations(&connection)?;
        for conversation in &mut project_conversations {
            conversation.project_id = project.id.clone();
        }
        conversations.extend(project_conversations);
    }

    Ok(conversations)
}

fn read_project_conversation_tasks(
    data_dir: &Path,
    projects: &[Project],
    conversations: &[Conversation],
) -> Result<HashMap<String, Vec<GridCell>>, String> {
    let mut conversation_tasks: HashMap<String, Vec<GridCell>> = HashMap::new();
    let conversation_grid_sizes = conversations
        .iter()
        .map(|conversation| (conversation.id.clone(), conversation.grid_size))
        .collect::<HashMap<_, _>>();

    for project in projects {
        let connection = open_project_database(data_dir, project)?;
        let mut task_statement = connection
            .prepare(
                "
                SELECT id, project_id, conversation_id, parent_task_id, exploration_round, cell_index,
                       prompt, direction_title, status, image_path, error_message, provider, model,
                       created_at, updated_at, attempt, visual_title, visual_palette,
                       visual_texture, role, reference_images, depends_on_task_id, grid_size
                FROM image_tasks
                ORDER BY conversation_id, exploration_round, cell_index
                ",
            )
            .map_err(|error| error.to_string())?;

        let task_rows = task_statement
            .query_map([], read_task)
            .map_err(|error| error.to_string())?;
        let all_tasks = task_rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| error.to_string())?;

        for mut task in all_tasks {
            let Some(conversation_id) = task.conversation_id.clone() else {
                continue;
            };
            task.project_id = project.id.clone();
            let grid_size = task
                .grid_size
                .or_else(|| conversation_grid_sizes.get(&conversation_id).copied())
                .unwrap_or(project.grid_size);
            task.grid_size = Some(grid_size);
            conversation_tasks
                .entry(grid_run_key(&conversation_id, grid_size))
                .or_default()
                .push(task);
        }
    }

    Ok(conversation_tasks)
}

fn validate_project_directory(directory: &str) -> Result<PathBuf, String> {
    let trimmed = directory.trim();
    if trimmed.is_empty() {
        return Err("Project folder path cannot be empty".to_string());
    }

    let path = PathBuf::from(trimmed);
    if !path.is_absolute() {
        return Err("Project folder must be an absolute path".to_string());
    }
    if !path.exists() {
        return Err("Project folder was not found".to_string());
    }
    if !path.is_dir() {
        return Err("Project path must be a folder".to_string());
    }

    Ok(path)
}

fn create_project_for_directory(project_directory: &Path, created_at: &str) -> Result<Project, String> {
    let project_id_suffix = chrono_like_timestamp();
    let title = project_directory
        .file_name()
        .and_then(|value| value.to_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Untitled Project")
        .to_string();

    Ok(Project {
        id: format!("project-{project_id_suffix}"),
        title,
        project_directory: Some(path_to_display_string(project_directory)),
        original_prompt: String::new(),
        style: "editorial product concept, refined composition, cinematic light".to_string(),
        grid_size: 9,
        aspect_ratio: "1:1".to_string(),
        quality: "draft".to_string(),
        output_size: default_output_size(),
        schema_version: 1,
        created_at: created_at.to_string(),
        updated_at: created_at.to_string(),
    })
}

fn ensure_project_layout_at_path(
    project_directory: &Path,
    project: &Project,
) -> Result<(), String> {
    fs::create_dir_all(project_directory)
        .map_err(|error| format!("Could not create project folder: {error}"))?;
    fs::create_dir_all(project_directory.join("conversations"))
        .map_err(|error| format!("Could not create conversations folder: {error}"))?;
    fs::create_dir_all(project_directory.join("assets"))
        .map_err(|error| format!("Could not create project assets folder: {error}"))?;
    write_json_file(&project_directory.join("project.json"), project)
}

fn write_project_state(connection: &Connection, project: &Project) -> Result<(), String> {
    connection
        .execute(
            "
            INSERT INTO project_state (key, value, updated_at)
            VALUES ('project', ?1, ?2)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
            ",
            params![
                serde_json::to_string(project).map_err(|error| error.to_string())?,
                &project.updated_at,
            ],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn read_removed_project_ids(connection: &Connection) -> Result<HashSet<String>, String> {
    let mut statement = connection
        .prepare("SELECT id FROM removed_projects")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<HashSet<_>, _>>()
        .map_err(|error| error.to_string())
}

fn find_project_for_conversation(
    store: &LocalStore,
    global_connection: &Connection,
    conversation_id: &str,
) -> Result<Option<Project>, String> {
    let data_dir = store
        .data_dir
        .lock()
        .map_err(|_| "Storage path lock is poisoned".to_string())?
        .clone();
    let projects = read_projects(global_connection)?;
    for project in projects {
        let connection = open_project_database(&data_dir, &project)?;
        if read_conversation_by_id(&connection, conversation_id)?.is_some() {
            return Ok(Some(project));
        }
    }

    Ok(None)
}

fn update_project_updated_at(
    connection: &mut Connection,
    project_id: &str,
    updated_at: &str,
) -> Result<Option<Project>, String> {
    connection
        .execute(
            "
            UPDATE projects
            SET updated_at = ?1
            WHERE id = ?2
            ",
            params![updated_at, project_id],
        )
        .map_err(|error| error.to_string())?;
    read_project_by_id(connection, project_id)
}

fn write_conversation_manifest(
    store: &LocalStore,
    project: &Project,
    conversation: &Conversation,
) -> Result<(), String> {
    let conversation_directory = conversation_directory(store, project, conversation)?;
    fs::create_dir_all(&conversation_directory)
        .map_err(|error| format!("Could not create conversation folder: {error}"))?;
    write_json_file(
        &conversation_directory.join("conversation.json"),
        conversation,
    )
}

fn open_project_database(data_dir: &Path, project: &Project) -> Result<Connection, String> {
    let project_directory = ensure_project_layout(data_dir, project)?;
    let connection = Connection::open(project_directory.join(PROJECT_DATABASE_FILE_NAME))
        .map_err(|error| format!("Could not open project database: {error}"))?;
    migrate_project_database(&connection).map_err(|error| error.to_string())?;

    Ok(connection)
}

fn ensure_project_layout(data_dir: &Path, project: &Project) -> Result<PathBuf, String> {
    let project_directory = resolve_project_directory(
        data_dir,
        &project.id,
        &project.title,
        project.project_directory.as_deref(),
    )?;
    fs::create_dir_all(project_directory.join("conversations"))
        .map_err(|error| format!("Could not create conversations folder: {error}"))?;
    fs::create_dir_all(project_directory.join("assets"))
        .map_err(|error| format!("Could not create project assets folder: {error}"))?;
    write_json_file(&project_directory.join("project.json"), project)?;

    Ok(project_directory)
}

fn migrate_project_database(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS project_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            title TEXT NOT NULL,
            original_prompt TEXT NOT NULL,
            style TEXT NOT NULL,
            grid_size INTEGER NOT NULL,
            aspect_ratio TEXT NOT NULL,
            quality TEXT NOT NULL,
            output_size TEXT NOT NULL DEFAULT 'standard',
            schema_version INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            workflow_mode TEXT,
            main_detail TEXT,
            configuration_locked INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS grid_runs (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            grid_size INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS image_tasks (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            conversation_id TEXT,
            grid_size INTEGER,
            parent_task_id TEXT,
            exploration_round INTEGER NOT NULL,
            cell_index INTEGER NOT NULL,
            prompt TEXT NOT NULL,
            direction_title TEXT,
            status TEXT NOT NULL,
            image_path TEXT,
            error_message TEXT,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            attempt INTEGER NOT NULL,
            visual_title TEXT NOT NULL,
            visual_palette TEXT NOT NULL,
            visual_texture TEXT NOT NULL,
            role TEXT,
            reference_images TEXT,
            depends_on_task_id TEXT,
            FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS image_outputs (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            task_id TEXT NOT NULL,
            attempt INTEGER NOT NULL,
            image_path TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
            FOREIGN KEY(task_id) REFERENCES image_tasks(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS reference_images (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            image_path TEXT NOT NULL,
            role TEXT,
            name TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS conversation_messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS generation_logs (
            id TEXT PRIMARY KEY,
            conversation_id TEXT NOT NULL,
            task_id TEXT,
            event_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_project_conversations_updated
            ON conversations(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_project_tasks_conversation_round
            ON image_tasks(conversation_id, exploration_round, cell_index);

        PRAGMA user_version = 1;
        ",
    )?;
    ensure_column(
        connection,
        "conversations",
        "output_size",
        "TEXT NOT NULL DEFAULT 'standard'",
    )?;
    ensure_column(connection, "conversations", "workflow_mode", "TEXT")?;
    ensure_column(connection, "conversations", "main_detail", "TEXT")?;
    ensure_column(
        connection,
        "conversations",
        "configuration_locked",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(connection, "image_tasks", "direction_title", "TEXT")?;
    ensure_column(connection, "image_tasks", "conversation_id", "TEXT")?;
    ensure_column(connection, "image_tasks", "grid_size", "INTEGER")?;
    ensure_column(connection, "image_tasks", "role", "TEXT")?;
    ensure_column(connection, "image_tasks", "reference_images", "TEXT")?;
    ensure_column(connection, "image_tasks", "depends_on_task_id", "TEXT")?;
    connection.pragma_update(None, "user_version", 1)
}

fn conversation_directory(
    store: &LocalStore,
    project: &Project,
    conversation: &Conversation,
) -> Result<PathBuf, String> {
    let data_dir = store
        .data_dir
        .lock()
        .map_err(|_| "Storage path lock is poisoned".to_string())?
        .clone();
    let project_directory = resolve_project_directory(
        &data_dir,
        &project.id,
        &project.title,
        project.project_directory.as_deref(),
    )?;

    Ok(project_directory
        .join("conversations")
        .join(sanitize_path_component(&conversation.id)))
}

fn grid_run_key(conversation_id: &str, grid_size: i64) -> String {
    format!("{conversation_id}::grid-{}", grid_size.max(1))
}

fn conversation_id_from_task_key(task_key: &str) -> String {
    task_key
        .split_once("::grid-")
        .map(|(conversation_id, _)| conversation_id)
        .unwrap_or(task_key)
        .to_string()
}

fn grid_size_from_task_key(task_key: &str) -> Option<i64> {
    task_key
        .split_once("::grid-")
        .and_then(|(_, grid_size)| grid_size.parse::<i64>().ok())
}

fn write_json_file<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let json = serde_json::to_string_pretty(value)
        .map_err(|error| format!("Could not serialize project file: {error}"))?;
    fs::write(path, json).map_err(|error| {
        format!(
            "Could not write project file {}: {error}",
            path_to_display_string(path)
        )
    })
}

fn read_json_file<T>(path: &Path) -> Result<Option<T>, String>
where
    T: for<'de> Deserialize<'de>,
{
    match fs::read_to_string(path) {
        Ok(json) => serde_json::from_str::<T>(&json)
            .map(Some)
            .map_err(|error| format!("Could not parse project file {}: {error}", path_to_display_string(path))),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!(
            "Could not read project file {}: {error}",
            path_to_display_string(path)
        )),
    }
}

fn resolve_project_directory(
    data_dir: &Path,
    project_id: &str,
    project_title: &str,
    project_directory: Option<&str>,
) -> Result<PathBuf, String> {
    let folder_name = sanitize_path_component(project_title);

    if let Some(project_directory) = project_directory
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(project_directory);
        if !path.is_absolute() {
            return Err("Project folder must be an absolute path".to_string());
        }
        if is_existing_project_directory(&path, project_id) {
            return Ok(path);
        }
        return Ok(path.join(folder_name));
    }

    Ok(data_dir.join("projects").join(folder_name))
}

fn resolve_existing_project_directory(
    data_dir: &Path,
    project_id: &str,
    project_title: &str,
    project_directory: Option<&str>,
) -> Result<PathBuf, String> {
    let project_directory_path =
        resolve_project_directory(data_dir, project_id, project_title, project_directory)?;
    if project_directory_path.exists() {
        return Ok(project_directory_path);
    }

    if project_directory.map(str::trim).unwrap_or("").is_empty() {
        let legacy_directory = data_dir
            .join("projects")
            .join(legacy_project_folder_name(project_id, project_title));
        if is_existing_project_directory(&legacy_directory, project_id) {
            return Ok(legacy_directory);
        }
        return Ok(project_directory_path);
    }

    let Some(custom_directory) = project_directory
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(project_directory_path);
    };
    let legacy_directory = PathBuf::from(custom_directory);
    if !legacy_directory.is_absolute() {
        return Err("Project folder must be an absolute path".to_string());
    }

    if is_existing_project_directory(&legacy_directory, project_id) {
        return Ok(legacy_directory);
    }

    Ok(project_directory_path)
}

fn is_existing_project_directory(path: &Path, project_id: &str) -> bool {
    let project_file = path.join("project.json");
    if !project_file.is_file() {
        return false;
    }

    if project_id.trim().is_empty() {
        return true;
    }

    fs::read_to_string(project_file)
        .ok()
        .and_then(|json| serde_json::from_str::<Project>(&json).ok())
        .map(|project| project.id == project_id)
        .unwrap_or(false)
}

fn legacy_project_folder_name(project_id: &str, project_title: &str) -> String {
    format!(
        "{}-{}",
        legacy_sanitize_path_component(project_title),
        legacy_sanitize_path_component(project_id)
    )
}

fn legacy_sanitize_path_component(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();

    if sanitized.is_empty() {
        "untitled".to_string()
    } else {
        sanitized
    }
}

fn decode_image_data_url(data_url: &str) -> Result<(&'static str, Vec<u8>), String> {
    let Some((metadata, encoded)) = data_url.split_once(',') else {
        return Err("Generated image was not a data URL".to_string());
    };
    if !metadata.contains(";base64") {
        return Err("Generated image data URL is not base64 encoded".to_string());
    }

    let extension = if metadata.contains("image/jpeg") || metadata.contains("image/jpg") {
        "jpg"
    } else if metadata.contains("image/webp") {
        "webp"
    } else {
        "png"
    };

    Ok((extension, decode_base64(encoded)?))
}

fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    let mut output = Vec::with_capacity(input.len() * 3 / 4);
    let mut buffer = 0u32;
    let mut bits = 0u8;

    for byte in input.bytes().filter(|byte| !byte.is_ascii_whitespace()) {
        if byte == b'=' {
            break;
        }

        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return Err("Generated image contains invalid base64 data".to_string()),
        } as u32;

        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push(((buffer >> bits) & 0xff) as u8);
        }
    }

    Ok(output)
}

fn migrate(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            project_directory TEXT,
            original_prompt TEXT NOT NULL,
            style TEXT NOT NULL,
            grid_size INTEGER NOT NULL,
            aspect_ratio TEXT NOT NULL,
            quality TEXT NOT NULL,
            output_size TEXT NOT NULL DEFAULT 'standard',
            schema_version INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            title TEXT NOT NULL,
            original_prompt TEXT NOT NULL,
            style TEXT NOT NULL,
            grid_size INTEGER NOT NULL,
            aspect_ratio TEXT NOT NULL,
            quality TEXT NOT NULL,
            output_size TEXT NOT NULL DEFAULT 'standard',
            schema_version INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            workflow_mode TEXT,
            main_detail TEXT,
            configuration_locked INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS image_tasks (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            conversation_id TEXT,
            grid_size INTEGER,
            parent_task_id TEXT,
            exploration_round INTEGER NOT NULL,
            cell_index INTEGER NOT NULL,
            prompt TEXT NOT NULL,
            direction_title TEXT,
            status TEXT NOT NULL,
            image_path TEXT,
            error_message TEXT,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            attempt INTEGER NOT NULL,
            visual_title TEXT NOT NULL,
            visual_palette TEXT NOT NULL,
            visual_texture TEXT NOT NULL,
            role TEXT,
            reference_images TEXT,
            depends_on_task_id TEXT,
            FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_image_tasks_project_round
            ON image_tasks(project_id, exploration_round, cell_index);

        CREATE INDEX IF NOT EXISTS idx_conversations_project_updated
            ON conversations(project_id, updated_at DESC);

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS removed_projects (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            project_directory TEXT,
            removed_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            selected_project_id TEXT,
            selected_conversation_id TEXT,
            selected_task_id TEXT,
            current_round INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL
        );

        PRAGMA user_version = 5;
        ",
    )?;

    ensure_column(
        connection,
        "projects",
        "output_size",
        "TEXT NOT NULL DEFAULT 'standard'",
    )?;
    ensure_column(connection, "projects", "project_directory", "TEXT")?;
    ensure_column(connection, "conversations", "workflow_mode", "TEXT")?;
    ensure_column(connection, "conversations", "main_detail", "TEXT")?;
    ensure_column(
        connection,
        "conversations",
        "configuration_locked",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    ensure_column(connection, "image_tasks", "direction_title", "TEXT")?;
    ensure_column(connection, "image_tasks", "conversation_id", "TEXT")?;
    ensure_column(connection, "image_tasks", "grid_size", "INTEGER")?;
    ensure_column(connection, "image_tasks", "role", "TEXT")?;
    ensure_column(connection, "image_tasks", "reference_images", "TEXT")?;
    drop_column_if_exists(connection, "image_tasks", "reference_image_path")?;
    ensure_column(connection, "image_tasks", "depends_on_task_id", "TEXT")?;
    ensure_column(connection, "app_state", "selected_conversation_id", "TEXT")?;
    connection.execute(
        "
        CREATE INDEX IF NOT EXISTS idx_image_tasks_conversation_round
            ON image_tasks(conversation_id, exploration_round, cell_index)
        ",
        [],
    )?;
    migrate_legacy_conversations(connection)?;
    connection.pragma_update(None, "user_version", 5)
}

fn read_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        title: row.get(1)?,
        project_directory: row.get(2)?,
        original_prompt: row.get(3)?,
        style: row.get(4)?,
        grid_size: row.get(5)?,
        aspect_ratio: row.get(6)?,
        quality: row.get(7)?,
        output_size: row.get(8)?,
        schema_version: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn read_project_by_id(connection: &Connection, project_id: &str) -> Result<Option<Project>, String> {
    connection
        .query_row(
            "
            SELECT id, title, project_directory, original_prompt, style, grid_size,
                   aspect_ratio, quality, output_size, schema_version, created_at, updated_at
            FROM projects
            WHERE id = ?1
            ",
            params![project_id],
            read_project,
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn read_projects(connection: &Connection) -> Result<Vec<Project>, String> {
    let mut project_statement = connection
        .prepare(
            "
            SELECT id, title, project_directory, original_prompt, style, grid_size, aspect_ratio,
                   quality, output_size, schema_version, created_at, updated_at
            FROM projects
            ORDER BY updated_at DESC
            ",
        )
        .map_err(|error| error.to_string())?;

    let projects = project_statement
        .query_map([], read_project)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    Ok(projects)
}

fn read_conversations(connection: &Connection) -> Result<Vec<Conversation>, String> {
    let mut conversation_statement = connection
        .prepare(
            "
            SELECT id, project_id, title, original_prompt, style, grid_size,
                   aspect_ratio, quality, output_size, schema_version,
                   created_at, updated_at, workflow_mode, main_detail, configuration_locked
            FROM conversations
            ORDER BY updated_at DESC
            ",
        )
        .map_err(|error| error.to_string())?;
    let conversations = conversation_statement
        .query_map([], read_conversation)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    Ok(conversations)
}

fn recover_project_files(store: &LocalStore, connection: &Connection) -> Result<(), String> {
    let data_dir = store
        .data_dir
        .lock()
        .map_err(|_| "Storage path lock is poisoned".to_string())?
        .clone();
    let projects_dir = data_dir.join("projects");
    if !projects_dir.is_dir() {
        return Ok(());
    }

    let mut projects = read_projects(connection)?;
    let mut conversations = read_conversations(connection)?;
    let removed_project_ids = read_removed_project_ids(connection)?;
    let mut recovered_projects = Vec::new();
    let mut recovered_conversations = Vec::new();
    let mut recovered_tasks: HashMap<String, Vec<GridCell>> = HashMap::new();

    let entries = fs::read_dir(&projects_dir).map_err(|error| {
        format!(
            "Could not read projects folder {}: {error}",
            path_to_display_string(&projects_dir)
        )
    })?;

    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let project_directory = entry.path();
        if !project_directory.is_dir() {
            continue;
        }

        let Some(mut project) = read_json_file::<Project>(&project_directory.join("project.json"))?
        else {
            continue;
        };
        if removed_project_ids.contains(project.id.as_str()) {
            continue;
        }
        project.project_directory = normalize_recovered_project_directory(
            project.project_directory,
            &project_directory,
            &data_dir,
            &project.title,
        );

        let project_was_missing = !projects.iter().any(|candidate| candidate.id == project.id);
        if project_was_missing {
            upsert_project(&mut projects, project.clone());
            recovered_projects.push(project.clone());
        }

        let recovered_project_conversations = recover_project_conversations(
            &project,
            &project_directory,
            project_was_missing,
            &mut conversations,
            &mut recovered_tasks,
        )?;
        recovered_conversations.extend(recovered_project_conversations);
    }

    if recovered_projects.is_empty()
        && recovered_conversations.is_empty()
        && recovered_tasks.is_empty()
    {
        return Ok(());
    }

    let recovered_project_ids = recovered_projects
        .iter()
        .map(|project| project.id.as_str())
        .chain(
            recovered_conversations
                .iter()
                .map(|conversation| conversation.project_id.as_str()),
        )
        .chain(
            recovered_tasks
                .keys()
                .map(|task_key| conversation_id_from_task_key(task_key))
                .filter_map(|conversation_id| {
                    recovered_conversations
                        .iter()
                        .find(|conversation| conversation.id == conversation_id)
                        .map(|conversation| conversation.project_id.as_str())
                }),
        )
        .collect::<HashSet<_>>();
    let recovered_project_records = projects
        .iter()
        .filter(|project| recovered_project_ids.contains(project.id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if !recovered_project_records.is_empty() {
        sync_project_databases(
            store,
            &recovered_project_records,
            &recovered_conversations,
            &recovered_tasks,
        )?;
    }

    write_recovered_workspace(
        connection,
        &recovered_projects,
        &recovered_conversations,
        &recovered_tasks,
    )
}

fn recover_project_conversations(
    project: &Project,
    project_directory: &Path,
    project_was_missing: bool,
    conversations: &mut Vec<Conversation>,
    recovered_tasks: &mut HashMap<String, Vec<GridCell>>,
) -> Result<Vec<Conversation>, String> {
    let conversations_dir = project_directory.join("conversations");
    if !conversations_dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut recovered_conversations = Vec::new();
    let entries = fs::read_dir(&conversations_dir).map_err(|error| {
        format!(
            "Could not read conversations folder {}: {error}",
            path_to_display_string(&conversations_dir)
        )
    })?;

    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let conversation_directory = entry.path();
        if !conversation_directory.is_dir() {
            continue;
        }

        let Some(mut conversation) =
            read_json_file::<Conversation>(&conversation_directory.join("conversation.json"))?
        else {
            continue;
        };
        conversation.project_id = project.id.clone();

        let conversation_was_missing = !conversations
            .iter()
            .any(|candidate| candidate.id == conversation.id);
        if conversation_was_missing {
            upsert_conversation(conversations, conversation.clone());
            recovered_conversations.push(conversation.clone());
        }

        if project_was_missing || conversation_was_missing {
            for (task_key, tasks) in recover_conversation_tasks(
                project,
                &conversation,
                &conversation_directory,
            )? {
                recovered_tasks.entry(task_key).or_default().extend(tasks);
            }
        }
    }

    Ok(recovered_conversations)
}

fn recover_conversation_tasks(
    project: &Project,
    conversation: &Conversation,
    conversation_directory: &Path,
) -> Result<HashMap<String, Vec<GridCell>>, String> {
    let mut recovered_tasks = HashMap::new();
    let task_files = collect_task_files(conversation_directory)?;

    for task_file in task_files {
        let Some(tasks) = read_json_file::<Vec<GridCell>>(&task_file)? else {
            continue;
        };
        let normalized_tasks = tasks
            .into_iter()
            .map(|mut task| {
                task.project_id = project.id.clone();
                task.conversation_id = Some(conversation.id.clone());
                task.grid_size = Some(task.grid_size.unwrap_or(conversation.grid_size));
                task
            })
            .collect::<Vec<_>>();
        let grid_size = normalized_tasks
            .iter()
            .find_map(|task| task.grid_size)
            .unwrap_or(conversation.grid_size);
        recovered_tasks
            .entry(grid_run_key(&conversation.id, grid_size))
            .or_insert(normalized_tasks);
    }

    Ok(recovered_tasks)
}

fn collect_task_files(conversation_directory: &Path) -> Result<Vec<PathBuf>, String> {
    let mut task_files = Vec::new();
    let root_task_file = conversation_directory.join("tasks.json");
    if root_task_file.is_file() {
        task_files.push(root_task_file);
    }

    let grid_runs_directory = conversation_directory.join("grid-runs");
    if !grid_runs_directory.is_dir() {
        return Ok(task_files);
    }

    let entries = fs::read_dir(&grid_runs_directory).map_err(|error| {
        format!(
            "Could not read grid runs folder {}: {error}",
            path_to_display_string(&grid_runs_directory)
        )
    })?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let task_file = entry.path().join("tasks.json");
        if task_file.is_file() {
            task_files.push(task_file);
        }
    }

    Ok(task_files)
}

fn normalize_recovered_project_directory(
    project_directory: Option<String>,
    project_file_directory: &Path,
    data_dir: &Path,
    project_title: &str,
) -> Option<String> {
    match project_directory {
        Some(project_directory) => Some(project_directory),
        None if project_file_directory
            == data_dir
                .join("projects")
                .join(sanitize_path_component(project_title)) =>
        {
            None
        }
        None => project_file_directory
            .parent()
            .map(path_to_display_string)
            .or_else(|| Some(path_to_display_string(project_file_directory))),
    }
}

fn write_recovered_workspace(
    connection: &Connection,
    projects: &[Project],
    conversations: &[Conversation],
    _conversation_tasks: &HashMap<String, Vec<GridCell>>,
) -> Result<(), String> {
    let now = projects
        .iter()
        .map(|project| project.updated_at.as_str())
        .chain(conversations.iter().map(|conversation| conversation.updated_at.as_str()))
        .max()
        .unwrap_or("");

    for project in projects {
        write_project_record(connection, project)?;
    }

    if let Some(project) = projects
        .iter()
        .max_by(|left, right| left.updated_at.cmp(&right.updated_at))
    {
        connection
            .execute(
                "
                INSERT INTO app_state (
                    id, selected_project_id, selected_conversation_id,
                    selected_task_id, current_round, updated_at
                )
                VALUES (1, ?1, ?2, NULL, 1, ?3)
                ON CONFLICT(id) DO NOTHING
                ",
                params![
                    &project.id,
                    conversations
                        .iter()
                        .filter(|conversation| conversation.project_id == project.id)
                        .max_by(|left, right| left.updated_at.cmp(&right.updated_at))
                        .map(|conversation| conversation.id.as_str()),
                    now,
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn write_project_record(connection: &Connection, project: &Project) -> Result<(), String> {
    connection
        .execute(
            "
            INSERT INTO projects (
                id, title, project_directory, original_prompt, style, grid_size, aspect_ratio,
                quality, output_size, schema_version, created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                project_directory = excluded.project_directory,
                original_prompt = excluded.original_prompt,
                style = excluded.style,
                grid_size = excluded.grid_size,
                aspect_ratio = excluded.aspect_ratio,
                quality = excluded.quality,
                output_size = excluded.output_size,
                schema_version = excluded.schema_version,
                updated_at = excluded.updated_at
            ",
            params![
                &project.id,
                &project.title,
                &project.project_directory,
                &project.original_prompt,
                &project.style,
                project.grid_size,
                &project.aspect_ratio,
                &project.quality,
                &project.output_size,
                project.schema_version,
                &project.created_at,
                &project.updated_at,
            ],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())?;
    connection
        .execute("DELETE FROM removed_projects WHERE id = ?1", params![&project.id])
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn write_removed_project_record(
    connection: &Connection,
    project: &Project,
    removed_at: &str,
) -> Result<(), String> {
    connection
        .execute(
            "
            INSERT INTO removed_projects (id, title, project_directory, removed_at)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                project_directory = excluded.project_directory,
                removed_at = excluded.removed_at
            ",
            params![
                &project.id,
                &project.title,
                &project.project_directory,
                removed_at,
            ],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn write_conversation_record(
    connection: &Connection,
    conversation: &Conversation,
) -> Result<(), String> {
    connection
        .execute(
            "
            INSERT INTO conversations (
                id, project_id, title, original_prompt, style, grid_size,
                aspect_ratio, quality, output_size, schema_version,
                created_at, updated_at, workflow_mode, main_detail, configuration_locked
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
            ON CONFLICT(id) DO UPDATE SET
                project_id = excluded.project_id,
                title = excluded.title,
                original_prompt = excluded.original_prompt,
                style = excluded.style,
                grid_size = excluded.grid_size,
                aspect_ratio = excluded.aspect_ratio,
                quality = excluded.quality,
                output_size = excluded.output_size,
                schema_version = excluded.schema_version,
                workflow_mode = excluded.workflow_mode,
                main_detail = excluded.main_detail,
                configuration_locked = excluded.configuration_locked,
                updated_at = excluded.updated_at
            ",
            params![
                &conversation.id,
                &conversation.project_id,
                &conversation.title,
                &conversation.original_prompt,
                &conversation.style,
                conversation.grid_size,
                &conversation.aspect_ratio,
                &conversation.quality,
                &conversation.output_size,
                conversation.schema_version,
                &conversation.created_at,
                &conversation.updated_at,
                &conversation.workflow_mode,
                conversation
                    .main_detail
                    .as_ref()
                    .map(|value| value.to_string()),
                conversation.configuration_locked,
            ],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn write_task_record(connection: &Connection, mut task: GridCell) -> Result<(), String> {
    let palette = serde_json::to_string(&task.visual.palette)
        .map_err(|error| error.to_string())?;
    let reference_images =
        serde_json::to_string(&task.reference_images).map_err(|error| error.to_string())?;
    let task_conversation_id = task.conversation_id.take();

    connection
        .execute(
            "
            INSERT INTO image_tasks (
                id, project_id, conversation_id, grid_size, parent_task_id, exploration_round, cell_index,
                prompt, direction_title, status, image_path, error_message, provider, model,
                created_at, updated_at, attempt, visual_title, visual_palette,
                visual_texture, role, reference_images, depends_on_task_id
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)
            ON CONFLICT(id) DO UPDATE SET
                project_id = excluded.project_id,
                conversation_id = excluded.conversation_id,
                grid_size = excluded.grid_size,
                parent_task_id = excluded.parent_task_id,
                exploration_round = excluded.exploration_round,
                cell_index = excluded.cell_index,
                prompt = excluded.prompt,
                direction_title = excluded.direction_title,
                status = excluded.status,
                image_path = excluded.image_path,
                error_message = excluded.error_message,
                provider = excluded.provider,
                model = excluded.model,
                updated_at = excluded.updated_at,
                attempt = excluded.attempt,
                visual_title = excluded.visual_title,
                visual_palette = excluded.visual_palette,
                visual_texture = excluded.visual_texture,
                role = excluded.role,
                reference_images = excluded.reference_images,
                depends_on_task_id = excluded.depends_on_task_id
            ",
            params![
                task.id,
                task.project_id,
                task_conversation_id,
                task.grid_size,
                task.parent_task_id,
                task.exploration_round,
                task.index,
                task.prompt,
                task.direction_title,
                task.status,
                task.image_path,
                task.error_message,
                task.provider,
                task.model,
                task.created_at,
                task.updated_at,
                task.attempt,
                task.visual.title,
                palette,
                task.visual.texture,
                task.role,
                reference_images,
                task.depends_on_task_id,
            ],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn prune_missing_project_folders(
    store: &LocalStore,
    connection: &mut Connection,
    projects: Vec<Project>,
) -> Result<Vec<Project>, String> {
    let data_dir = store
        .data_dir
        .lock()
        .map_err(|_| "Storage path lock is poisoned".to_string())?
        .clone();
    let default_projects_dir = data_dir.join("projects");
    let mut existing_projects = Vec::new();
    let mut missing_project_ids = Vec::new();

    for project in projects {
        if project.project_directory.is_none() && !default_projects_dir.exists() {
            existing_projects.push(project);
            continue;
        }

        let project_directory = resolve_existing_project_directory(
            &data_dir,
            &project.id,
            &project.title,
            project.project_directory.as_deref(),
        )?;

        if project_directory.is_dir() {
            existing_projects.push(project);
        } else {
            missing_project_ids.push(project.id);
        }
    }

    if missing_project_ids.is_empty() {
        return Ok(existing_projects);
    }

    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;

    for project_id in &missing_project_ids {
        transaction
            .execute(
                "DELETE FROM image_tasks WHERE project_id = ?1",
                params![project_id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute(
                "DELETE FROM conversations WHERE project_id = ?1",
                params![project_id],
            )
            .map_err(|error| error.to_string())?;
        transaction
            .execute("DELETE FROM projects WHERE id = ?1", params![project_id])
            .map_err(|error| error.to_string())?;
    }

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(existing_projects)
}

fn read_conversation(row: &rusqlite::Row<'_>) -> rusqlite::Result<Conversation> {
    Ok(Conversation {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        original_prompt: row.get(3)?,
        style: row.get(4)?,
        grid_size: row.get(5)?,
        aspect_ratio: row.get(6)?,
        quality: row.get(7)?,
        output_size: row.get(8)?,
        schema_version: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        workflow_mode: row.get(12)?,
        main_detail: row
            .get::<_, Option<String>>(13)?
            .map(|value| serde_json::from_str(&value))
            .transpose()
            .map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(13, Type::Text, Box::new(error))
            })?,
        configuration_locked: row.get(14)?,
    })
}

fn read_conversation_by_id(
    connection: &Connection,
    conversation_id: &str,
) -> Result<Option<Conversation>, String> {
    connection
        .query_row(
            "
            SELECT id, project_id, title, original_prompt, style, grid_size,
                   aspect_ratio, quality, output_size, schema_version,
                   created_at, updated_at, workflow_mode, main_detail, configuration_locked
            FROM conversations
            WHERE id = ?1
            ",
            params![conversation_id],
            read_conversation,
        )
        .optional()
        .map_err(|error| error.to_string())
}

fn read_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<GridCell> {
    let palette_json: String = row.get(17)?;
    let palette = serde_json::from_str::<[String; 3]>(&palette_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(17, Type::Text, Box::new(error))
    })?;

    Ok(GridCell {
        id: row.get(0)?,
        project_id: row.get(1)?,
        conversation_id: row.get(2)?,
        parent_task_id: row.get(3)?,
        exploration_round: row.get(4)?,
        index: row.get(5)?,
        prompt: row.get(6)?,
        direction_title: row.get(7)?,
        status: row.get(8)?,
        image_path: row.get(9)?,
        error_message: row.get(10)?,
        provider: row.get(11)?,
        model: row.get(12)?,
        created_at: row.get(13)?,
        updated_at: row.get(14)?,
        attempt: row.get(15)?,
        visual: MockVisual {
            title: row.get(16)?,
            palette,
            texture: row.get(18)?,
        },
        role: row.get(19)?,
        reference_images: read_reference_images(row.get(20)?),
        depends_on_task_id: row.get(21)?,
        grid_size: row.get(22)?,
    })
}

fn read_reference_images(value: Option<String>) -> Vec<ImageReference> {
    value
        .as_deref()
        .filter(|raw| !raw.trim().is_empty())
        .and_then(|raw| serde_json::from_str::<Vec<ImageReference>>(raw).ok())
        .unwrap_or_default()
}

fn chrono_like_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn ensure_column(
    connection: &Connection,
    table: &str,
    column: &str,
    column_type: &str,
) -> rusqlite::Result<()> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
    for existing_column in columns {
        if existing_column? == column {
            return Ok(());
        }
    }

    connection.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {column_type}"),
        [],
    )?;
    Ok(())
}

fn drop_column_if_exists(
    connection: &Connection,
    table: &str,
    column: &str,
) -> rusqlite::Result<()> {
    let mut statement = connection.prepare(&format!("PRAGMA table_info({table})"))?;
    let columns = statement.query_map([], |row| row.get::<_, String>(1))?;
    for existing_column in columns {
        if existing_column? == column {
            connection.execute(&format!("ALTER TABLE {table} DROP COLUMN {column}"), [])?;
            return Ok(());
        }
    }

    Ok(())
}

fn migrate_legacy_conversations(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute(
        "
        INSERT INTO conversations (
            id, project_id, title, original_prompt, style, grid_size,
            aspect_ratio, quality, output_size, schema_version,
            created_at, updated_at, workflow_mode, main_detail, configuration_locked
        )
        SELECT
            'conversation-' || projects.id,
            projects.id,
            projects.title,
            projects.original_prompt,
            projects.style,
            projects.grid_size,
            projects.aspect_ratio,
            projects.quality,
            projects.output_size,
            projects.schema_version,
            projects.created_at,
            projects.updated_at,
            'text-grid',
            NULL,
            0
        FROM projects
        WHERE EXISTS (
            SELECT 1 FROM image_tasks
            WHERE image_tasks.project_id = projects.id
        )
        AND NOT EXISTS (
            SELECT 1 FROM conversations
            WHERE conversations.project_id = projects.id
        )
        ",
        [],
    )?;
    connection.execute(
        "
        UPDATE image_tasks
        SET conversation_id = (
            SELECT conversations.id
            FROM conversations
            WHERE conversations.project_id = image_tasks.project_id
            ORDER BY conversations.updated_at DESC
            LIMIT 1
        )
        WHERE conversation_id IS NULL OR conversation_id = ''
        ",
        [],
    )?;
    connection.execute(
        "
        UPDATE app_state
        SET selected_conversation_id = (
            SELECT conversations.id
            FROM conversations
            WHERE conversations.project_id = app_state.selected_project_id
            ORDER BY conversations.updated_at DESC
            LIMIT 1
        )
        WHERE selected_conversation_id IS NULL
        ",
        [],
    )?;

    Ok(())
}

fn merge_project_with_conversation(mut project: Project, conversation: &Conversation) -> Project {
    project.original_prompt = conversation.original_prompt.clone();
    project.style = conversation.style.clone();
    project.grid_size = conversation.grid_size;
    project.aspect_ratio = conversation.aspect_ratio.clone();
    project.quality = conversation.quality.clone();
    project.output_size = conversation.output_size.clone();
    project.schema_version = conversation.schema_version;
    if conversation.updated_at > project.updated_at {
        project.updated_at = conversation.updated_at.clone();
    }
    project
}

fn upsert_project(projects: &mut Vec<Project>, project: Project) {
    projects.retain(|candidate| candidate.id != project.id);
    projects.insert(0, project);
}

fn upsert_conversation(conversations: &mut Vec<Conversation>, conversation: Conversation) {
    conversations.retain(|candidate| candidate.id != conversation.id);
    conversations.insert(0, conversation);
}

fn read_storage_config(
    config_path: &Path,
) -> Result<Option<StorageConfig>, Box<dyn std::error::Error>> {
    if !config_path.exists() {
        return Ok(None);
    }

    let config_json = fs::read_to_string(config_path)?;
    let config = serde_json::from_str::<StorageConfig>(&config_json)?;
    Ok(Some(config))
}

fn write_storage_config(store: &LocalStore, data_dir: &Path) -> Result<(), String> {
    if data_dir == store.default_data_dir {
        match fs::remove_file(&store.config_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Could not clear storage config: {error}")),
        }
        return Ok(());
    }

    let config = StorageConfig {
        data_directory: Some(path_to_display_string(data_dir)),
    };
    let config_json = serde_json::to_string_pretty(&config)
        .map_err(|error| format!("Could not write storage config: {error}"))?;
    fs::write(&store.config_path, config_json)
        .map_err(|error| format!("Could not save storage config: {error}"))
}

fn normalize_data_directory(
    directory: Option<String>,
    default_data_dir: &Path,
) -> Result<PathBuf, String> {
    let Some(directory) = directory.map(|value| value.trim().to_string()) else {
        return Ok(default_data_dir.to_path_buf());
    };

    if directory.is_empty() {
        return Ok(default_data_dir.to_path_buf());
    }

    let path = PathBuf::from(directory);
    if !path.is_absolute() {
        return Err("Data storage path must be an absolute folder path".to_string());
    }

    Ok(path)
}

fn build_storage_info(store: &LocalStore, data_dir: &Path) -> StorageInfo {
    StorageInfo {
        default_data_dir: path_to_display_string(&store.default_data_dir),
        current_data_dir: path_to_display_string(data_dir),
        database_path: path_to_display_string(&data_dir.join(DATABASE_FILE_NAME)),
        uses_custom_data_dir: data_dir != store.default_data_dir,
    }
}

fn cleanup_inactive_database_files(
    inactive_data_dir: &Path,
    active_data_dir: &Path,
) -> Result<(), String> {
    if inactive_data_dir == active_data_dir {
        return Ok(());
    }

    for database_file in sqlite_database_files(inactive_data_dir) {
        match fs::remove_file(&database_file) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "Could not remove old database file {}: {error}",
                    path_to_display_string(&database_file)
                ));
            }
        }
    }

    Ok(())
}

fn sqlite_database_files(data_dir: &Path) -> Vec<PathBuf> {
    vec![
        data_dir.join(DATABASE_FILE_NAME),
        data_dir.join(format!("{DATABASE_FILE_NAME}-wal")),
        data_dir.join(format!("{DATABASE_FILE_NAME}-shm")),
        data_dir.join(format!("{DATABASE_FILE_NAME}-journal")),
    ]
}

fn path_to_sqlite_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn path_to_display_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn sanitize_path_component(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|character| {
            match character {
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
                character if character.is_control() => '-',
                character => character,
            }
        })
        .collect::<String>()
        .trim()
        .trim_end_matches('.')
        .trim_matches('-')
        .to_string();

    if sanitized.is_empty() {
        "untitled".to_string()
    } else {
        sanitized
    }
}

#[cfg(target_os = "windows")]
struct ComApartmentGuard;

#[cfg(target_os = "windows")]
impl Drop for ComApartmentGuard {
    fn drop(&mut self) {
        unsafe {
            windows::Win32::System::Com::CoUninitialize();
        }
    }
}

#[cfg(target_os = "windows")]
fn null_terminated_wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain(std::iter::once(0)).collect()
}

fn default_settings() -> AppSettings {
    AppSettings {
        providers: default_provider_configs(),
        active_model_selection: default_active_model_selection(),
        workflow_configs: default_workflow_configs(),
        show_workflow_config_editor: default_show_workflow_config_editor(),
        debug_logging_enabled: false,
        debug_log_retention_days: default_debug_log_retention_days(),
        max_concurrency: 3,
        default_grid_size: 9,
        default_aspect_ratio: "1:1".to_string(),
        output_directory: None,
        api_provider: None,
        text_model: None,
        image_model: None,
        open_ai_base_url: None,
        open_ai_api_key_saved: None,
        open_ai_api_key: None,
        custom_provider_name: None,
        custom_base_url: None,
        custom_api_key_saved: None,
        custom_api_key: None,
        custom_text_model: None,
        custom_image_model: None,
        custom_headers: None,
        reasoning_enabled: None,
        reasoning_effort: None,
        response_verbosity: None,
        stream_responses: None,
        model_routing: None,
        text_runtime: None,
        image_runtime: None,
    }
}

fn default_workflow_configs() -> serde_json::Value {
    serde_json::json!({})
}

fn default_show_workflow_config_editor() -> bool {
    true
}

fn default_provider_configs() -> ProviderConfigs {
    ProviderConfigs {
        openai: default_openai_provider_config(),
        deepseek: default_deepseek_provider_config(),
        openai_compatible: default_openai_compatible_provider_config(),
    }
}

fn default_openai_provider_config() -> ProviderConfig {
    ProviderConfig {
        enabled: true,
        base_url: default_open_ai_base_url(),
        api_key_saved: false,
        custom_headers: None,
        text_model: TextModelSettings {
            model: "gpt-4o-mini".to_string(),
            ..default_text_model_settings()
        },
        image_model: ImageModelSettings {
            model: "gpt-image-1".to_string(),
            stream_responses: true,
            ..default_image_model_settings()
        },
    }
}

fn default_deepseek_provider_config() -> ProviderConfig {
    ProviderConfig {
        enabled: false,
        base_url: "https://api.deepseek.com".to_string(),
        api_key_saved: false,
        custom_headers: None,
        text_model: TextModelSettings {
            model: "deepseek-chat".to_string(),
            ..default_text_model_settings()
        },
        image_model: default_image_model_settings(),
    }
}

fn default_openai_compatible_provider_config() -> ProviderConfig {
    ProviderConfig {
        enabled: false,
        base_url: String::new(),
        api_key_saved: false,
        custom_headers: Some(String::new()),
        text_model: default_text_model_settings(),
        image_model: default_image_model_settings(),
    }
}

fn default_active_model_selection() -> ActiveModelSelection {
    ActiveModelSelection {
        text: ModelRoute {
            provider_id: "openai".to_string(),
        },
        image: ModelRoute {
            provider_id: "openai".to_string(),
        },
    }
}

fn default_text_model_settings() -> TextModelSettings {
    TextModelSettings {
        model: String::new(),
        reasoning_enabled: false,
        reasoning_effort: default_reasoning_effort(),
        response_verbosity: default_response_verbosity(),
        stream_responses: false,
    }
}

fn default_image_model_settings() -> ImageModelSettings {
    ImageModelSettings {
        model: String::new(),
        reasoning_enabled: false,
        reasoning_effort: default_reasoning_effort(),
        response_verbosity: default_response_verbosity(),
        stream_responses: true,
        quality: default_image_quality(),
        background: default_image_background(),
        output_format: default_image_output_format(),
        output_compression: default_image_output_compression(),
    }
}

fn default_open_ai_base_url() -> String {
    "https://api.openai.com/v1".to_string()
}

fn default_output_size() -> String {
    "standard".to_string()
}

fn default_reasoning_effort() -> String {
    "medium".to_string()
}

fn default_response_verbosity() -> String {
    "medium".to_string()
}

fn default_image_quality() -> String {
    "auto".to_string()
}

fn default_image_background() -> String {
    "auto".to_string()
}

fn default_image_output_format() -> String {
    "png".to_string()
}

fn default_image_output_compression() -> i64 {
    100
}

fn default_debug_log_retention_days() -> i64 {
    7
}

fn migrate_legacy_api_keys(settings: &mut AppSettings) -> Result<(), String> {
    migrate_legacy_settings(settings);

    if let Some(api_key) = settings
        .open_ai_api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        crate::model_config::save_provider_api_key("openai", api_key)?;
        settings.open_ai_api_key = None;
    }

    if let Some(api_key) = settings
        .custom_api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        crate::model_config::save_provider_api_key("openai-compatible", api_key)?;
        settings.custom_api_key = None;
    }

    Ok(())
}

fn refresh_api_key_status(settings: &mut AppSettings) {
    settings.providers.openai.api_key_saved = crate::model_config::has_provider_api_key("openai");
    settings.providers.deepseek.api_key_saved =
        crate::model_config::has_provider_api_key("deepseek");
    settings.providers.openai_compatible.api_key_saved =
        crate::model_config::has_provider_api_key("openai-compatible");
}

fn migrate_legacy_settings(settings: &mut AppSettings) {
    let legacy_provider = settings.api_provider.as_deref();
    let legacy_provider_id = if legacy_provider == Some("custom") {
        "openai-compatible"
    } else {
        "openai"
    };

    if let Some(model_routing) = settings.model_routing.clone() {
        settings.active_model_selection.text.provider_id =
            normalize_provider_id(&model_routing.text.provider_id);
        settings.active_model_selection.image.provider_id =
            normalize_provider_id(&model_routing.image.provider_id);
        set_provider_text_model(
            settings,
            model_routing.text.provider_id.as_str(),
            model_routing.text.model.as_str(),
        );
        set_provider_image_model(
            settings,
            model_routing.image.provider_id.as_str(),
            model_routing.image.model.as_str(),
        );
    }

    if settings.api_provider.is_some() {
        settings.active_model_selection.text.provider_id = legacy_provider_id.to_string();
        settings.active_model_selection.image.provider_id = legacy_provider_id.to_string();
    }

    if let Some(text_model) = settings.text_model.clone() {
        if legacy_provider_id == "openai" {
            settings.providers.openai.text_model.model = text_model;
        }
    }

    if let Some(image_model) = settings.image_model.clone() {
        if legacy_provider_id == "openai" {
            settings.providers.openai.image_model.model = image_model;
        }
    }

    if let Some(text_model) = settings.custom_text_model.clone() {
        if legacy_provider_id == "openai-compatible" {
            settings.providers.openai_compatible.text_model.model = text_model;
        }
    }

    if let Some(image_model) = settings.custom_image_model.clone() {
        if legacy_provider_id == "openai-compatible" {
            settings.providers.openai_compatible.image_model.model = image_model;
        }
    }

    if let Some(base_url) = settings.open_ai_base_url.as_ref().filter(|value| !value.is_empty()) {
        settings.providers.openai.base_url = base_url.clone();
    }

    if let Some(base_url) = settings.custom_base_url.as_ref().filter(|value| !value.is_empty()) {
        settings.providers.openai_compatible.base_url = base_url.clone();
        settings.providers.openai_compatible.enabled = true;
    }

    if let Some(headers) = settings.custom_headers.clone() {
        settings.providers.openai_compatible.custom_headers = Some(headers);
    }

    if let Some(saved) = settings.open_ai_api_key_saved {
        settings.providers.openai.api_key_saved = saved;
        settings.providers.openai.enabled |= saved;
    }

    if let Some(saved) = settings.custom_api_key_saved {
        settings.providers.openai_compatible.api_key_saved = saved;
        settings.providers.openai_compatible.enabled |= saved;
    }

    let text_runtime = settings.text_runtime.as_ref();
    let image_runtime = settings.image_runtime.as_ref();

    if let Some(reasoning_enabled) = settings
        .reasoning_enabled
        .or_else(|| text_runtime.map(|runtime| runtime.reasoning_enabled))
    {
        settings.providers.openai.text_model.reasoning_enabled = reasoning_enabled;
        settings.providers.openai_compatible.text_model.reasoning_enabled = reasoning_enabled;
    }

    if let Some(reasoning_effort) = settings
        .reasoning_effort
        .clone()
        .or_else(|| text_runtime.map(|runtime| runtime.reasoning_effort.clone()))
    {
        settings.providers.openai.text_model.reasoning_effort = reasoning_effort.clone();
        settings.providers.openai_compatible.text_model.reasoning_effort = reasoning_effort;
    }

    if let Some(response_verbosity) = settings.response_verbosity.clone() {
        settings.providers.openai.text_model.response_verbosity = response_verbosity.clone();
        settings.providers.openai_compatible.text_model.response_verbosity =
            response_verbosity.clone();
        settings.providers.openai.image_model.response_verbosity = response_verbosity.clone();
        settings.providers.openai_compatible.image_model.response_verbosity = response_verbosity;
    } else {
        if let Some(runtime) = text_runtime {
            settings.providers.openai.text_model.response_verbosity =
                runtime.response_verbosity.clone();
            settings.providers.openai_compatible.text_model.response_verbosity =
                runtime.response_verbosity.clone();
        }
        if let Some(runtime) = image_runtime {
            settings.providers.openai.image_model.response_verbosity =
                runtime.response_verbosity.clone();
            settings.providers.openai_compatible.image_model.response_verbosity =
                runtime.response_verbosity.clone();
        }
    }

    if let Some(stream_responses) = settings
        .stream_responses
        .or_else(|| text_runtime.map(|runtime| runtime.stream_responses))
    {
        settings.providers.openai.text_model.stream_responses = stream_responses;
        settings.providers.openai_compatible.text_model.stream_responses = stream_responses;
    }

    settings.api_provider = None;
    settings.text_model = None;
    settings.image_model = None;
    settings.open_ai_base_url = None;
    settings.open_ai_api_key_saved = None;
    settings.custom_provider_name = None;
    settings.custom_base_url = None;
    settings.custom_api_key_saved = None;
    settings.custom_text_model = None;
    settings.custom_image_model = None;
    settings.custom_headers = None;
    settings.reasoning_enabled = None;
    settings.reasoning_effort = None;
    settings.response_verbosity = None;
    settings.stream_responses = None;
    settings.model_routing = None;
    settings.text_runtime = None;
    settings.image_runtime = None;
}

fn set_provider_text_model(settings: &mut AppSettings, provider_id: &str, model: &str) {
    let model = model.trim();
    if model.is_empty() {
        return;
    }

    match normalize_provider_id(provider_id).as_str() {
        "openai-compatible" => settings.providers.openai_compatible.text_model.model = model.to_string(),
        "deepseek" => settings.providers.deepseek.text_model.model = model.to_string(),
        _ => settings.providers.openai.text_model.model = model.to_string(),
    }
}

fn set_provider_image_model(settings: &mut AppSettings, provider_id: &str, model: &str) {
    let model = model.trim();
    if model.is_empty() {
        return;
    }

    match normalize_provider_id(provider_id).as_str() {
        "openai-compatible" => settings.providers.openai_compatible.image_model.model = model.to_string(),
        "deepseek" => settings.providers.deepseek.image_model.model = model.to_string(),
        _ => settings.providers.openai.image_model.model = model.to_string(),
    }
}

fn normalize_provider_id(provider_id: &str) -> String {
    if provider_id == "custom" {
        "openai-compatible".to_string()
    } else {
        provider_id.to_string()
    }
}
