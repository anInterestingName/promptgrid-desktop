use rusqlite::types::Type;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const SETTINGS_KEY: &str = "app_settings";

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

pub struct LocalStore {
    connection: Mutex<Connection>,
}

impl LocalStore {
    pub fn new(app: &AppHandle) -> Result<Self, Box<dyn std::error::Error>> {
        let app_dir = app.path().app_data_dir()?;
        fs::create_dir_all(&app_dir)?;

        let connection = Connection::open(app_dir.join("app.db"))?;
        migrate(&connection)?;

        Ok(Self {
            connection: Mutex::new(connection),
        })
    }
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
                   quality, schema_version, created_at, updated_at
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
                   prompt, status, image_path, error_message, provider, model,
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
                quality, schema_version, created_at, updated_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(id) DO UPDATE SET
                title = excluded.title,
                original_prompt = excluded.original_prompt,
                style = excluded.style,
                grid_size = excluded.grid_size,
                aspect_ratio = excluded.aspect_ratio,
                quality = excluded.quality,
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
                    prompt, status, image_path, error_message, provider, model,
                    created_at, updated_at, attempt, visual_title, visual_palette,
                    visual_texture
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
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

        PRAGMA user_version = 1;
        ",
    )
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
        schema_version: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
    })
}

fn read_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<GridCell> {
    let palette_json: String = row.get(15)?;
    let palette = serde_json::from_str::<[String; 3]>(&palette_json).map_err(|error| {
        rusqlite::Error::FromSqlConversionFailure(15, Type::Text, Box::new(error))
    })?;

    Ok(GridCell {
        id: row.get(0)?,
        project_id: row.get(1)?,
        parent_task_id: row.get(2)?,
        exploration_round: row.get(3)?,
        index: row.get(4)?,
        prompt: row.get(5)?,
        status: row.get(6)?,
        image_path: row.get(7)?,
        error_message: row.get(8)?,
        provider: row.get(9)?,
        model: row.get(10)?,
        created_at: row.get(11)?,
        updated_at: row.get(12)?,
        attempt: row.get(13)?,
        visual: MockVisual {
            title: row.get(14)?,
            palette,
            texture: row.get(16)?,
        },
    })
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
        max_concurrency: 3,
        default_grid_size: 9,
        default_aspect_ratio: "1:1".to_string(),
        output_directory: None,
    }
}

fn default_open_ai_base_url() -> String {
    "https://api.openai.com/v1".to_string()
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
