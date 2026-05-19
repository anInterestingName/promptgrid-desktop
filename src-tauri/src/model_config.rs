use keyring::{Entry, Error as KeyringError};
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;

const SECRET_SERVICE: &str = "PromptGrid Desktop";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFetchRequest {
    provider: String,
    base_url: String,
    custom_headers: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    id: String,
    owned_by: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ModelsResponse {
    data: Vec<ModelResponseItem>,
}

#[derive(Debug, Deserialize)]
struct ModelResponseItem {
    id: String,
    owned_by: Option<String>,
}

pub fn save_provider_api_key(provider: &str, api_key: &str) -> Result<bool, String> {
    let entry = provider_entry(provider)?;
    let trimmed_key = api_key.trim();

    if trimmed_key.is_empty() {
        return clear_provider_api_key(provider);
    }

    entry
        .set_password(trimmed_key)
        .map_err(|error| format!("Could not save API key: {error}"))?;

    Ok(true)
}

pub fn clear_provider_api_key(provider: &str) -> Result<bool, String> {
    let entry = provider_entry(provider)?;

    match entry.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(false),
        Err(error) => Err(format!("Could not clear API key: {error}")),
    }
}

pub fn has_provider_api_key(provider: &str) -> bool {
    get_provider_api_key(provider)
        .map(|api_key| {
            api_key
                .as_deref()
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false)
        })
        .unwrap_or(false)
}

pub fn fetch_provider_models(request: ModelFetchRequest) -> Result<Vec<ModelOption>, String> {
    let api_key = get_provider_api_key(&request.provider)?
        .ok_or_else(|| "API key is not saved for this provider".to_string())?;
    let models_url = build_models_url(&request.base_url)?;
    let mut headers = HeaderMap::new();
    let auth_value = HeaderValue::from_str(&format!("Bearer {api_key}"))
        .map_err(|error| format!("Invalid API key header: {error}"))?;

    headers.insert(AUTHORIZATION, auth_value);
    apply_custom_headers(&mut headers, request.custom_headers.as_deref())?;

    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Could not create HTTP client: {error}"))?;
    let response = client
        .get(models_url)
        .headers(headers)
        .send()
        .map_err(|error| format!("Could not fetch model list: {error}"))?;
    let status = response.status();

    if !status.is_success() {
        return Err(format!("Model list request failed with HTTP {status}"));
    }

    let mut models = response
        .json::<ModelsResponse>()
        .map_err(|error| format!("Could not parse model list: {error}"))?
        .data
        .into_iter()
        .map(|model| ModelOption {
            id: model.id,
            owned_by: model.owned_by,
        })
        .collect::<Vec<_>>();

    models.sort_by(|left, right| left.id.cmp(&right.id));
    models.dedup_by(|left, right| left.id == right.id);

    Ok(models)
}

fn get_provider_api_key(provider: &str) -> Result<Option<String>, String> {
    let entry = provider_entry(provider)?;

    match entry.get_password() {
        Ok(api_key) => Ok(Some(api_key)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read API key: {error}")),
    }
}

fn provider_entry(provider: &str) -> Result<Entry, String> {
    let account = match provider {
        "openai" => "openai-api-key",
        "custom" => "custom-provider-api-key",
        _ => return Err("Unsupported provider".to_string()),
    };

    Entry::new(SECRET_SERVICE, account).map_err(|error| format!("Could not open keyring: {error}"))
}

fn build_models_url(base_url: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Base URL is required".to_string());
    }

    if trimmed.ends_with("/models") {
        return Ok(trimmed.to_string());
    }

    if trimmed.ends_with("/v1") {
        return Ok(format!("{trimmed}/models"));
    }

    Ok(format!("{trimmed}/v1/models"))
}

fn apply_custom_headers(
    headers: &mut HeaderMap,
    custom_headers: Option<&str>,
) -> Result<(), String> {
    let Some(raw_headers) = custom_headers
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };
    let value = serde_json::from_str::<Value>(raw_headers)
        .map_err(|error| format!("Extra headers must be a JSON object: {error}"))?;
    let Value::Object(header_object) = value else {
        return Err("Extra headers must be a JSON object".to_string());
    };

    for (name, value) in header_object {
        let Value::String(value) = value else {
            return Err(format!("Header `{name}` must be a string"));
        };
        let header_name = HeaderName::from_bytes(name.as_bytes())
            .map_err(|error| format!("Invalid header name `{name}`: {error}"))?;
        let header_value = HeaderValue::from_str(&value)
            .map_err(|error| format!("Invalid value for header `{name}`: {error}"))?;

        headers.insert(header_name, header_value);
    }

    Ok(())
}
