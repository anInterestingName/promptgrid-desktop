use serde::Serialize;
use serde_json::{Map, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const LOG_FILE_PREFIX: &str = "provider-requests";
const LOG_FILE_EXTENSION: &str = "jsonl";
const MAX_LOG_STRING_CHARS: usize = 12_000;
const DEFAULT_RETENTION_DAYS: u64 = 7;
const CLEANUP_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

static DEBUG_LOG_STATE: OnceLock<Mutex<DebugLogState>> = OnceLock::new();

#[derive(Clone)]
struct DebugLogState {
    enabled: bool,
    log_dir: PathBuf,
    retention_days: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderRequestLog {
    timestamp_ms: u128,
    operation: String,
    provider: Option<String>,
    model: Option<String>,
    method: String,
    url: String,
    duration_ms: u128,
    status: Option<u16>,
    ok: bool,
    request: Value,
    response: Value,
    error: Option<String>,
}

pub fn initialize_debug_logging(log_dir: PathBuf) {
    let _ = DEBUG_LOG_STATE.set(Mutex::new(DebugLogState {
        enabled: false,
        log_dir,
        retention_days: DEFAULT_RETENTION_DAYS,
    }));

    let _ = cleanup_expired_logs();
    thread::spawn(|| loop {
        thread::sleep(CLEANUP_INTERVAL);
        let _ = cleanup_expired_logs();
    });
}

pub fn configure_debug_logging(enabled: bool, retention_days: u64) -> Result<(), String> {
    let mut state = debug_log_state()
        .lock()
        .map_err(|_| "Debug log state lock is poisoned".to_string())?;
    state.enabled = enabled;
    state.retention_days = retention_days.max(1);
    drop(state);

    cleanup_expired_logs()
}

pub fn debug_log_dir() -> Result<PathBuf, String> {
    let state = debug_log_state()
        .lock()
        .map_err(|_| "Debug log state lock is poisoned".to_string())?;
    fs::create_dir_all(&state.log_dir)
        .map_err(|error| format!("Could not create debug log folder: {error}"))?;
    Ok(state.log_dir.clone())
}

pub fn log_provider_request(
    operation: &str,
    provider: Option<&str>,
    model: Option<&str>,
    method: &str,
    url: &str,
    request: Option<&Value>,
    response_text: Option<&str>,
    status: Option<u16>,
    duration_ms: u128,
    error: Option<&str>,
) {
    let Some(state) = active_debug_log_state() else {
        return;
    };

    let entry = ProviderRequestLog {
        timestamp_ms: current_timestamp_ms(),
        operation: operation.to_string(),
        provider: provider.map(str::to_string),
        model: model.map(str::to_string),
        method: method.to_string(),
        url: url.to_string(),
        duration_ms,
        status,
        ok: status.map(|value| (200..300).contains(&value)).unwrap_or(false) && error.is_none(),
        request: request.map(sanitize_json_value).unwrap_or(Value::Null),
        response: response_text
            .map(response_text_to_log_value)
            .unwrap_or(Value::Null),
        error: error.map(|value| truncate_string(value, MAX_LOG_STRING_CHARS)),
    };

    if let Err(error) = append_log_entry(&state.log_dir, &entry) {
        eprintln!("Could not write debug request log: {error}");
    }
}

fn append_log_entry(log_dir: &Path, entry: &ProviderRequestLog) -> Result<(), String> {
    fs::create_dir_all(log_dir)
        .map_err(|error| format!("Could not create debug log folder: {error}"))?;

    let path = log_dir.join(format!(
        "{LOG_FILE_PREFIX}-{}.{}",
        current_date_string(),
        LOG_FILE_EXTENSION
    ));
    let line = serde_json::to_string(entry)
        .map_err(|error| format!("Could not serialize debug log entry: {error}"))?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| format!("Could not open debug log: {error}"))?;

    writeln!(file, "{line}").map_err(|error| format!("Could not append debug log: {error}"))
}

fn cleanup_expired_logs() -> Result<(), String> {
    let state = debug_log_state()
        .lock()
        .map_err(|_| "Debug log state lock is poisoned".to_string())?
        .clone();
    let max_age = Duration::from_secs(state.retention_days.max(1) * 24 * 60 * 60);
    let Ok(entries) = fs::read_dir(&state.log_dir) else {
        return Ok(());
    };
    let now = SystemTime::now();

    for entry in entries.flatten() {
        let path = entry.path();
        if !is_provider_log_file(&path) {
            continue;
        }

        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Ok(modified_at) = metadata.modified() else {
            continue;
        };
        if now
            .duration_since(modified_at)
            .map(|age| age > max_age)
            .unwrap_or(false)
        {
            let _ = fs::remove_file(path);
        }
    }

    Ok(())
}

fn active_debug_log_state() -> Option<DebugLogState> {
    debug_log_state()
        .lock()
        .ok()
        .and_then(|state| state.enabled.then(|| state.clone()))
}

fn debug_log_state() -> &'static Mutex<DebugLogState> {
    DEBUG_LOG_STATE.get_or_init(|| {
        Mutex::new(DebugLogState {
            enabled: false,
            log_dir: PathBuf::from("fangcun-debug-logs"),
            retention_days: DEFAULT_RETENTION_DAYS,
        })
    })
}

fn is_provider_log_file(path: &Path) -> bool {
    let Some(file_name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };

    file_name.starts_with(&format!("{LOG_FILE_PREFIX}-"))
        && file_name.ends_with(&format!(".{LOG_FILE_EXTENSION}"))
}

fn response_text_to_log_value(response_text: &str) -> Value {
    match serde_json::from_str::<Value>(response_text) {
        Ok(value) => sanitize_json_value(&value),
        Err(_) => Value::String(truncate_string(response_text, MAX_LOG_STRING_CHARS)),
    }
}

fn sanitize_json_value(value: &Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .iter()
                .map(|(key, value)| {
                    if is_sensitive_key(key) {
                        (key.clone(), Value::String("[redacted]".to_string()))
                    } else if is_inline_image_key(key, value) {
                        (key.clone(), Value::String("[redacted image data]".to_string()))
                    } else {
                        (key.clone(), sanitize_json_value(value))
                    }
                })
                .collect::<Map<_, _>>(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(sanitize_json_value).collect()),
        Value::String(value) => Value::String(truncate_string(value, MAX_LOG_STRING_CHARS)),
        _ => value.clone(),
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let normalized = key.to_ascii_lowercase();
    normalized.contains("authorization")
        || normalized.contains("apikey")
        || normalized.contains("api_key")
        || normalized.contains("token")
        || normalized.contains("secret")
        || normalized == "key"
}

fn is_inline_image_key(key: &str, value: &Value) -> bool {
    key.eq_ignore_ascii_case("image_url")
        && value
            .as_str()
            .is_some_and(|value| value.trim_start().starts_with("data:image/"))
}

fn truncate_string(value: &str, max_chars: usize) -> String {
    let char_count = value.chars().count();
    if char_count <= max_chars {
        return value.to_string();
    }

    let head = value.chars().take(max_chars).collect::<String>();
    format!(
        "{head}\n[truncated {} chars]",
        char_count.saturating_sub(max_chars)
    )
}

fn current_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn current_date_string() -> String {
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let days = seconds / 86_400;
    let (year, month, day) = civil_from_days(days as i64);
    format!("{year:04}-{month:02}-{day:02}")
}

fn civil_from_days(days_since_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    let year = year + if month <= 2 { 1 } else { 0 };

    (year as i32, month as u32, day as u32)
}
