use rusqlite::types::Type;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

const SETTINGS_KEY: &str = "app_settings";
const DATABASE_FILE_NAME: &str = "app.db";
const STORAGE_CONFIG_FILE_NAME: &str = "storage-config.json";

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    id: String,
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MockVisual {
    title: String,
    palette: [String; 3],
    texture: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GridCell {
    id: String,
    project_id: String,
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
    tasks: Vec<GridCell>,
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

        let title = null_terminated_wide("选择数据存储文件夹");
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

    let project = connection
        .query_row(
            "
            SELECT id, title, original_prompt, style, grid_size, aspect_ratio,
                   quality, output_size, schema_version, created_at, updated_at
            FROM projects
            ORDER BY updated_at DESC
            LIMIT 1
            ",
            [],
            read_project,
        )
        .optional()
        .map_err(|error| error.to_string())?;

    let Some(project) = project else {
        return Ok(None);
    };

    let mut statement = connection
        .prepare(
            "
            SELECT id, project_id, parent_task_id, exploration_round, cell_index,
                   prompt, direction_title, status, image_path, error_message, provider, model,
                   created_at, updated_at, attempt, visual_title, visual_palette,
                   visual_texture
            FROM image_tasks
            WHERE project_id = ?1
            ORDER BY exploration_round, cell_index
            ",
        )
        .map_err(|error| error.to_string())?;

    let task_rows = statement
        .query_map(params![project.id.as_str()], read_task)
        .map_err(|error| error.to_string())?;
    let tasks = task_rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

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

    let app_state = connection
        .query_row(
            "
            SELECT selected_task_id, current_round
            FROM app_state
            WHERE id = 1
            ",
            [],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;

    let (selected_task_id, current_round) =
        app_state.unwrap_or((tasks.first().map(|task| task.id.clone()), 1));

    Ok(Some(AppSnapshot {
        project,
        tasks,
        settings,
        selected_task_id,
        current_round,
    }))
}

pub fn save_workspace(store: &LocalStore, snapshot: AppSnapshot) -> Result<(), String> {
    let AppSnapshot {
        project,
        tasks,
        mut settings,
        selected_task_id,
        current_round,
    } = snapshot;
    migrate_legacy_api_keys(&mut settings)?;
    refresh_api_key_status(&mut settings);

    let mut connection = store
        .connection
        .lock()
        .map_err(|_| "Database lock is poisoned".to_string())?;
    let transaction = connection
        .transaction()
        .map_err(|error| error.to_string())?;
    let project_id = project.id.clone();
    let now = project.updated_at.clone();

    transaction
        .execute(
            "
            INSERT INTO projects (
                id, title, original_prompt, style, grid_size, aspect_ratio,
                quality, output_size, schema_version, created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            ON CONFLICT(id) DO UPDATE SET
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
                &project.id,
                &project.title,
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

    transaction
        .execute(
            "DELETE FROM image_tasks WHERE project_id = ?1",
            params![project_id],
        )
        .map_err(|error| error.to_string())?;

    {
        let mut task_insert = transaction
            .prepare(
                "
                INSERT INTO image_tasks (
                    id, project_id, parent_task_id, exploration_round, cell_index,
                    prompt, direction_title, status, image_path, error_message, provider, model,
                    created_at, updated_at, attempt, visual_title, visual_palette,
                    visual_texture
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
                ",
            )
            .map_err(|error| error.to_string())?;

        for task in tasks {
            let palette =
                serde_json::to_string(&task.visual.palette).map_err(|error| error.to_string())?;

            task_insert
                .execute(params![
                    task.id,
                    task.project_id,
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
            INSERT INTO app_state (id, selected_project_id, selected_task_id, current_round, updated_at)
            VALUES (1, ?1, ?2, ?3, ?4)
            ON CONFLICT(id) DO UPDATE SET
                selected_project_id = excluded.selected_project_id,
                selected_task_id = excluded.selected_task_id,
                current_round = excluded.current_round,
                updated_at = excluded.updated_at
            ",
            params![&project.id, selected_task_id, current_round, now],
        )
        .map_err(|error| error.to_string())?;

    transaction.commit().map_err(|error| error.to_string())
}

fn migrate(connection: &Connection) -> rusqlite::Result<()> {
    connection.execute_batch(
        "
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
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

        CREATE TABLE IF NOT EXISTS image_tasks (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
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

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            selected_project_id TEXT,
            selected_task_id TEXT,
            current_round INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL
        );

        PRAGMA user_version = 3;
        ",
    )?;

    ensure_column(
        connection,
        "projects",
        "output_size",
        "TEXT NOT NULL DEFAULT 'standard'",
    )?;
    ensure_column(connection, "image_tasks", "direction_title", "TEXT")?;
    connection.pragma_update(None, "user_version", 3)
}

fn read_project(row: &rusqlite::Row<'_>) -> rusqlite::Result<Project> {
    Ok(Project {
        id: row.get(0)?,
        title: row.get(1)?,
        original_prompt: row.get(2)?,
        style: row.get(3)?,
        grid_size: row.get(4)?,
        aspect_ratio: row.get(5)?,
        quality: row.get(6)?,
        output_size: row.get(7)?,
        schema_version: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

fn read_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<GridCell> {
    let palette_json: String = row.get(16)?;
    let palette = serde_json::from_str::<[String; 3]>(&palette_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(16, Type::Text, Box::new(error))
    })?;

    Ok(GridCell {
        id: row.get(0)?,
        project_id: row.get(1)?,
        parent_task_id: row.get(2)?,
        exploration_round: row.get(3)?,
        index: row.get(4)?,
        prompt: row.get(5)?,
        direction_title: row.get(6)?,
        status: row.get(7)?,
        image_path: row.get(8)?,
        error_message: row.get(9)?,
        provider: row.get(10)?,
        model: row.get(11)?,
        created_at: row.get(12)?,
        updated_at: row.get(13)?,
        attempt: row.get(14)?,
        visual: MockVisual {
            title: row.get(15)?,
            palette,
            texture: row.get(17)?,
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
