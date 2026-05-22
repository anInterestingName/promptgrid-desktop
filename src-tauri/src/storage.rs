use rusqlite::types::Type;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

const SETTINGS_KEY: &str = "app_settings";
const DATABASE_FILE_NAME: &str = "app.db";
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
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    api_provider: String,
    text_model: String,
    image_model: String,
    #[serde(default = "default_open_ai_base_url")]
    open_ai_base_url: String,
    #[serde(default)]
    open_ai_api_key_saved: bool,
    #[serde(default, skip_serializing)]
    open_ai_api_key: Option<String>,
    custom_provider_name: Option<String>,
    custom_base_url: Option<String>,
    #[serde(default)]
    custom_api_key_saved: bool,
    #[serde(default, skip_serializing)]
    custom_api_key: Option<String>,
    custom_text_model: Option<String>,
    custom_image_model: Option<String>,
    custom_headers: Option<String>,
    #[serde(default)]
    reasoning_enabled: bool,
    #[serde(default = "default_reasoning_effort")]
    reasoning_effort: String,
    #[serde(default = "default_response_verbosity")]
    response_verbosity: String,
    #[serde(default)]
    stream_responses: bool,
    max_concurrency: i64,
    default_grid_size: i64,
    default_aspect_ratio: String,
    output_directory: Option<String>,
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
    exploration_round: i64,
    cell_index: i64,
    attempt: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedImage {
    image_path: String,
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
    let connection = store
        .connection
        .lock()
        .map_err(|_| "Database lock is poisoned".to_string())?;

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

    let mut conversation_statement = connection
        .prepare(
            "
            SELECT id, project_id, title, original_prompt, style, grid_size,
                   aspect_ratio, quality, output_size, schema_version,
                   created_at, updated_at
            FROM conversations
            ORDER BY updated_at DESC
            ",
        )
        .map_err(|error| error.to_string())?;
    let conversations = conversation_statement
        .query_map([], read_conversation)
        .map_err(|error| error.to_string())?;
    let conversations = conversations
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

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

    let mut task_statement = connection
        .prepare(
            "
            SELECT id, project_id, conversation_id, parent_task_id, exploration_round, cell_index,
                   prompt, direction_title, status, image_path, error_message, provider, model,
                   created_at, updated_at, attempt, visual_title, visual_palette,
                   visual_texture
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
    let mut conversation_tasks: HashMap<String, Vec<GridCell>> = HashMap::new();

    for mut task in all_tasks {
        let Some(conversation_id) = task.conversation_id.clone().or_else(|| {
            conversation
                .as_ref()
                .map(|conversation| conversation.id.clone())
        }) else {
            continue;
        };
        task.conversation_id = Some(conversation_id.clone());
        conversation_tasks
            .entry(conversation_id)
            .or_default()
            .push(task);
    }

    let tasks = conversation
        .as_ref()
        .and_then(|conversation| conversation_tasks.get(&conversation.id))
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
    } = snapshot;
    migrate_legacy_api_keys(&mut settings)?;
    refresh_api_key_status(&mut settings);
    upsert_project(&mut projects, project.clone());
    if let Some(conversation) = conversation {
        upsert_conversation(&mut conversations, conversation.clone());
    }
    let active_conversation_id = active_conversation_id.filter(|conversation_id| {
        conversations
            .iter()
            .any(|conversation| conversation.id == *conversation_id)
    });
    if let Some(active_conversation_id) = active_conversation_id.as_ref() {
        conversation_tasks.insert(active_conversation_id.clone(), tasks);
    }
    let project_files_projects = projects.clone();
    let project_files_conversations = conversations.clone();
    let project_files_tasks = conversation_tasks.clone();

    let mut connection = store
        .connection
        .lock()
        .map_err(|_| "Database lock is poisoned".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let now = project.updated_at.clone();

    for project in &projects {
        transaction
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
            .map_err(|error| error.to_string())?;
    }

    for conversation in &conversations {
        transaction
            .execute(
                "
                INSERT INTO conversations (
                    id, project_id, title, original_prompt, style, grid_size,
                    aspect_ratio, quality, output_size, schema_version,
                    created_at, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
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
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    transaction
        .execute("DELETE FROM image_tasks", [])
        .map_err(|error| error.to_string())?;

    let conversation_project_lookup = conversations
        .iter()
        .map(|conversation| (conversation.id.clone(), conversation.project_id.clone()))
        .collect::<HashMap<_, _>>();

    {
        let mut task_insert = transaction
            .prepare(
                "
                INSERT INTO image_tasks (
                    id, project_id, conversation_id, parent_task_id, exploration_round, cell_index,
                    prompt, direction_title, status, image_path, error_message, provider, model,
                    created_at, updated_at, attempt, visual_title, visual_palette,
                    visual_texture
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
                ",
            )
            .map_err(|error| error.to_string())?;

        for (conversation_id, tasks) in conversation_tasks {
            let Some(task_project_id) = conversation_project_lookup.get(&conversation_id).cloned()
            else {
                continue;
            };

            for mut task in tasks {
                let palette = serde_json::to_string(&task.visual.palette)
                    .map_err(|error| error.to_string())?;
                let task_conversation_id = task
                    .conversation_id
                    .take()
                    .unwrap_or_else(|| conversation_id.clone());
                let task_project_id = if task.project_id.is_empty() {
                    task_project_id.clone()
                } else {
                    task.project_id
                };

                task_insert
                    .execute(params![
                        task.id,
                        task_project_id,
                        task_conversation_id,
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
                    ])
                    .map_err(|error| error.to_string())?;
            }
        }
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
                &project.id,
                active_conversation_id,
                selected_task_id,
                current_round,
                now
            ],
        )
        .map_err(|error| error.to_string())?;

    transaction.commit().map_err(|error| error.to_string())?;
    sync_project_files(
        store,
        &project_files_projects,
        &project_files_conversations,
        &project_files_tasks,
    )
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
        .join("images");
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
            if let Some(tasks) = conversation_tasks.get(&conversation.id) {
                write_json_file(&conversation_directory.join("tasks.json"), tasks)?;
            }
        }
    }

    Ok(())
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

fn resolve_project_directory(
    data_dir: &Path,
    project_id: &str,
    project_title: &str,
    project_directory: Option<&str>,
) -> Result<PathBuf, String> {
    if let Some(project_directory) = project_directory
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        let path = PathBuf::from(project_directory);
        if !path.is_absolute() {
            return Err("Project folder must be an absolute path".to_string());
        }
        return Ok(path);
    }

    Ok(data_dir.join("projects").join(format!(
        "{}-{}",
        sanitize_path_component(project_title),
        sanitize_path_component(project_id)
    )))
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
            FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS image_tasks (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            conversation_id TEXT,
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
    ensure_column(connection, "image_tasks", "direction_title", "TEXT")?;
    ensure_column(connection, "image_tasks", "conversation_id", "TEXT")?;
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
    })
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
    })
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

fn migrate_legacy_conversations(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute(
        "
        INSERT INTO conversations (
            id, project_id, title, original_prompt, style, grid_size,
            aspect_ratio, quality, output_size, schema_version,
            created_at, updated_at
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
            projects.updated_at
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
        api_provider: "openai".to_string(),
        text_model: "gpt-4o-mini".to_string(),
        image_model: "gpt-image-1".to_string(),
        open_ai_base_url: "https://api.openai.com/v1".to_string(),
        open_ai_api_key_saved: false,
        open_ai_api_key: None,
        custom_provider_name: None,
        custom_base_url: None,
        custom_api_key_saved: false,
        custom_api_key: None,
        custom_text_model: None,
        custom_image_model: None,
        custom_headers: None,
        reasoning_enabled: false,
        reasoning_effort: default_reasoning_effort(),
        response_verbosity: default_response_verbosity(),
        stream_responses: false,
        max_concurrency: 3,
        default_grid_size: 9,
        default_aspect_ratio: "1:1".to_string(),
        output_directory: None,
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

fn migrate_legacy_api_keys(settings: &mut AppSettings) -> Result<(), String> {
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
        crate::model_config::save_provider_api_key("custom", api_key)?;
        settings.custom_api_key = None;
    }

    Ok(())
}

fn refresh_api_key_status(settings: &mut AppSettings) {
    settings.open_ai_api_key_saved = crate::model_config::has_provider_api_key("openai");
    settings.custom_api_key_saved = crate::model_config::has_provider_api_key("custom");
}
