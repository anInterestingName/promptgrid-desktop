use keyring::{Entry, Error as KeyringError};
use reqwest::blocking::{Client, Response};
use reqwest::header::{
    HeaderMap, HeaderName, HeaderValue, ACCEPT_ENCODING, AUTHORIZATION, CONTENT_ENCODING,
    CONTENT_TYPE,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::time::{Duration, Instant};

const SECRET_SERVICE: &str = "PromptGrid Desktop";
const PROMPT_ANALYSIS_TIMEOUT_SECS: u64 = 180;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelFetchRequest {
    provider: String,
    base_url: String,
    custom_headers: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelTestRequest {
    provider: String,
    base_url: String,
    custom_headers: Option<String>,
    kind: Option<String>,
    model: String,
    #[serde(default)]
    reasoning_enabled: bool,
    reasoning_effort: Option<String>,
    response_verbosity: Option<String>,
    #[serde(default)]
    stream_responses: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAnalyzeRequest {
    provider: String,
    base_url: String,
    custom_headers: Option<String>,
    text_model: String,
    original_prompt: String,
    style: String,
    aspect_ratio: String,
    quality: String,
    #[serde(default = "default_output_size")]
    output_size: String,
    grid_size: usize,
    #[serde(default)]
    reasoning_enabled: bool,
    reasoning_effort: Option<String>,
    response_verbosity: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptDirection {
    title: String,
    prompt: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptAnalysisResult {
    conversation_title: String,
    directions: Vec<PromptDirection>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageGenerateRequest {
    provider: String,
    base_url: String,
    custom_headers: Option<String>,
    image_model: String,
    image_quality: Option<String>,
    image_background: Option<String>,
    image_output_format: Option<String>,
    image_output_compression: Option<i64>,
    prompt: String,
    aspect_ratio: String,
    quality: String,
    #[serde(default = "default_output_size")]
    output_size: String,
    #[serde(default)]
    reasoning_enabled: bool,
    reasoning_effort: Option<String>,
    response_verbosity: Option<String>,
    #[serde(default)]
    stream_responses: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GeneratedImage {
    image_data_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    id: String,
    owned_by: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelTestResult {
    model: String,
    output: String,
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

struct UnifiedProviderRequest {
    operation: ProviderOperation,
    provider: String,
    base_url: String,
    model: Option<String>,
    prompt: Option<String>,
    reasoning_enabled: bool,
    reasoning_effort: Option<String>,
    response_verbosity: Option<String>,
    stream_responses: bool,
    image: Option<UnifiedImageRequest>,
}

struct UnifiedImageRequest {
    aspect_ratio: Option<String>,
    output_size: Option<String>,
    project_quality: Option<String>,
    image_quality: Option<String>,
    background: Option<String>,
    output_format: Option<String>,
    output_compression: Option<i64>,
}

enum ProviderOperation {
    TestTextModel,
    TestImageModel,
    AnalyzePromptDirections,
    GeneratePromptImage,
}

struct ProviderHttpRequest {
    method: &'static str,
    url: String,
    body: Option<Value>,
}

enum UnifiedProviderResponse {
    Text(String),
    Image(String),
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
    apply_default_provider_headers(&mut headers);

    let client = Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("Could not create HTTP client: {error}"))?;
    let started_at = Instant::now();
    let response = client
        .get(&models_url)
        .headers(headers)
        .send()
        .map_err(|error| {
            let message = format!("Could not fetch model list: {error}");
            crate::debug_log::log_provider_request(
                "fetch_provider_models",
                Some(&request.provider),
                None,
                "GET",
                &models_url,
                None,
                None,
                None,
                started_at.elapsed().as_millis(),
                Some(&message),
            );
            message
        })?;
    let status = response.status();
    let response_text = read_response_text(response, "model list response")?;
    crate::debug_log::log_provider_request(
        "fetch_provider_models",
        Some(&request.provider),
        None,
        "GET",
        &models_url,
        None,
        Some(&response_text),
        Some(status.as_u16()),
        started_at.elapsed().as_millis(),
        None,
    );

    if !status.is_success() {
        return Err(format!("Model list request failed with HTTP {status}"));
    }

    let mut models = serde_json::from_str::<ModelsResponse>(&response_text)
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

pub fn test_provider_connection(request: ModelTestRequest) -> Result<ModelTestResult, String> {
    let api_key = get_provider_api_key(&request.provider)?
        .ok_or_else(|| "API key is not saved for this provider".to_string())?;
    let model = request.model.trim();
    let kind = request.kind.as_deref().unwrap_or("text");

    if model.is_empty() {
        return Err(match kind {
            "image" => "Image model is required".to_string(),
            _ => "Text model is required".to_string(),
        });
    }

    let mut headers = HeaderMap::new();
    let auth_value = HeaderValue::from_str(&format!("Bearer {api_key}"))
        .map_err(|error| format!("Invalid API key header: {error}"))?;

    headers.insert(AUTHORIZATION, auth_value);
    apply_custom_headers(&mut headers, request.custom_headers.as_deref())?;
    apply_default_provider_headers(&mut headers);

    let client = Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| format!("Could not create HTTP client: {error}"))?;

    match kind {
        "image" => test_image_model(&client, headers, &request.base_url, model, &request),
        _ => test_text_model(&client, headers, &request.base_url, model, &request),
    }
}

pub fn analyze_prompt_directions(
    request: PromptAnalyzeRequest,
) -> Result<PromptAnalysisResult, String> {
    let api_key = get_provider_api_key(&request.provider)?
        .ok_or_else(|| "API key is not saved for this provider".to_string())?;
    let model = request.text_model.trim();

    if model.is_empty() {
        return Err("Text model is required".to_string());
    }

    let mut headers = HeaderMap::new();
    let auth_value = HeaderValue::from_str(&format!("Bearer {api_key}"))
        .map_err(|error| format!("Invalid API key header: {error}"))?;
    headers.insert(AUTHORIZATION, auth_value);
    apply_custom_headers(&mut headers, request.custom_headers.as_deref())?;
    apply_default_provider_headers(&mut headers);

    let client = Client::builder()
        .timeout(Duration::from_secs(PROMPT_ANALYSIS_TIMEOUT_SECS))
        .build()
        .map_err(|error| format!("Could not create HTTP client: {error}"))?;
    let grid_size = request.grid_size.clamp(1, 25);
    let unified_request = UnifiedProviderRequest {
        operation: ProviderOperation::AnalyzePromptDirections,
        provider: request.provider.clone(),
        base_url: request.base_url.clone(),
        model: Some(model.to_string()),
        prompt: Some(build_prompt_analysis_input(&request, grid_size)),
        reasoning_enabled: request.reasoning_enabled,
        reasoning_effort: request.reasoning_effort.clone(),
        response_verbosity: request.response_verbosity.clone(),
        stream_responses: false,
        image: None,
    };
    let provider_request = build_provider_http_request(&unified_request)?;
    let started_at = Instant::now();

    let response = client
        .post(&provider_request.url)
        .headers(headers)
        .json(
            provider_request
                .body
                .as_ref()
                .ok_or_else(|| "Provider request body is required".to_string())?,
        )
        .send()
        .map_err(|error| {
            let message = if error.is_timeout() {
                format!(
                    "Prompt analysis timed out after {PROMPT_ANALYSIS_TIMEOUT_SECS} seconds waiting for the provider. Try lowering the text model reasoning effort or retrying with a faster model."
                )
            } else {
                format!("Could not analyze prompt directions: {error}")
            };
            crate::debug_log::log_provider_request(
                "analyze_prompt_directions",
                Some(&request.provider),
                Some(model),
                provider_request.method,
                &provider_request.url,
                provider_request.body.as_ref(),
                None,
                None,
                started_at.elapsed().as_millis(),
                Some(&message),
            );
            message
        })?;
    let status = response.status();
    let response_text = read_response_text(response, "prompt analysis response")?;
    crate::debug_log::log_provider_request(
        "analyze_prompt_directions",
        Some(&request.provider),
        Some(model),
        provider_request.method,
        &provider_request.url,
        provider_request.body.as_ref(),
        Some(&response_text),
        Some(status.as_u16()),
        started_at.elapsed().as_millis(),
        None,
    );

    if !status.is_success() {
        return Err(format!(
            "Prompt analysis failed with HTTP {status}: {}",
            summarize_response_error(&response_text)
        ));
    }

    let output = match parse_provider_response(&unified_request, &response_text)
        .map_err(|error| format!("Could not parse prompt analysis response: {error}"))?
    {
        UnifiedProviderResponse::Text(output) => output,
        UnifiedProviderResponse::Image(_) => {
            return Err("Prompt analysis returned an incompatible response".to_string());
        }
    };

    parse_prompt_directions(&output, grid_size)
}

pub fn generate_prompt_image(request: ImageGenerateRequest) -> Result<GeneratedImage, String> {
    let api_key = get_provider_api_key(&request.provider)?
        .ok_or_else(|| "API key is not saved for this provider".to_string())?;
    let model = request.image_model.trim();

    if model.is_empty() {
        return Err("Image model is required".to_string());
    }

    let prompt = request.prompt.trim();
    if prompt.is_empty() {
        return Err("Image prompt is required".to_string());
    }

    let mut headers = HeaderMap::new();
    let auth_value = HeaderValue::from_str(&format!("Bearer {api_key}"))
        .map_err(|error| format!("Invalid API key header: {error}"))?;
    headers.insert(AUTHORIZATION, auth_value);
    apply_custom_headers(&mut headers, request.custom_headers.as_deref())?;
    apply_default_provider_headers(&mut headers);

    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("Could not create HTTP client: {error}"))?;
    let unified_request = UnifiedProviderRequest {
        operation: ProviderOperation::GeneratePromptImage,
        provider: request.provider.clone(),
        base_url: request.base_url.clone(),
        model: Some(model.to_string()),
        prompt: Some(prompt.to_string()),
        reasoning_enabled: request.reasoning_enabled,
        reasoning_effort: request.reasoning_effort.clone(),
        response_verbosity: request.response_verbosity.clone(),
        stream_responses: request.stream_responses,
        image: Some(UnifiedImageRequest {
            aspect_ratio: Some(request.aspect_ratio.clone()),
            output_size: Some(request.output_size.clone()),
            project_quality: Some(request.quality.clone()),
            image_quality: request.image_quality.clone(),
            background: request.image_background.clone(),
            output_format: request.image_output_format.clone(),
            output_compression: request.image_output_compression,
        }),
    };
    let provider_request = build_provider_http_request(&unified_request)?;
    let started_at = Instant::now();

    let response = client
        .post(&provider_request.url)
        .headers(headers)
        .json(
            provider_request
                .body
                .as_ref()
                .ok_or_else(|| "Provider request body is required".to_string())?,
        )
        .send()
        .map_err(|error| {
            let message = format!("Could not generate image: {error}");
            crate::debug_log::log_provider_request(
                "generate_prompt_image",
                Some(&request.provider),
                Some(model),
                provider_request.method,
                &provider_request.url,
                provider_request.body.as_ref(),
                None,
                None,
                started_at.elapsed().as_millis(),
                Some(&message),
            );
            message
        })?;
    let status = response.status();
    let content_type = header_value(response.headers(), CONTENT_TYPE);

    if content_type
        .as_deref()
        .map(is_event_stream_content_type)
        .unwrap_or(false)
    {
        if !status.is_success() {
            let response_text = read_response_text(response, "image generation response")?;
            crate::debug_log::log_provider_request(
                "generate_prompt_image",
                Some(&request.provider),
                Some(model),
                provider_request.method,
                &provider_request.url,
                provider_request.body.as_ref(),
                Some(&response_text),
                Some(status.as_u16()),
                started_at.elapsed().as_millis(),
                None,
            );
            return Err(format!(
                "Image generation failed with HTTP {status}: {}",
                summarize_response_error(&response_text)
            ));
        }

        let image_base64 = read_image_generation_stream(response).map_err(|failure| {
            let response_text = (!failure.response_text.trim().is_empty())
                .then_some(failure.response_text.as_str());
            crate::debug_log::log_provider_request(
                "generate_prompt_image",
                Some(&request.provider),
                Some(model),
                provider_request.method,
                &provider_request.url,
                provider_request.body.as_ref(),
                response_text,
                Some(status.as_u16()),
                started_at.elapsed().as_millis(),
                Some(&failure.message),
            );
            failure.message
        })?;
        let stream_response_text = json!({
            "output": [
                {
                    "type": "image_generation_call",
                    "result": image_base64
                }
            ]
        })
        .to_string();
        crate::debug_log::log_provider_request(
            "generate_prompt_image",
            Some(&request.provider),
            Some(model),
            provider_request.method,
            &provider_request.url,
            provider_request.body.as_ref(),
            Some(&json!({ "imageBase64": image_base64 }).to_string()),
            Some(status.as_u16()),
            started_at.elapsed().as_millis(),
            None,
        );
        let image_base64 = match parse_provider_response(&unified_request, &stream_response_text)
            .map_err(|error| format!("Could not parse image generation stream: {error}"))?
        {
            UnifiedProviderResponse::Image(image_base64) => image_base64,
            UnifiedProviderResponse::Text(_) => {
                return Err("Image generation returned an incompatible response".to_string());
            }
        };
        return Ok(GeneratedImage {
            image_data_url: format!("data:image/png;base64,{image_base64}"),
        });
    }

    let response_text = read_response_text(response, "image generation response")?;
    crate::debug_log::log_provider_request(
        "generate_prompt_image",
        Some(&request.provider),
        Some(model),
        provider_request.method,
        &provider_request.url,
        provider_request.body.as_ref(),
        Some(&response_text),
        Some(status.as_u16()),
        started_at.elapsed().as_millis(),
        None,
    );
    if !status.is_success() {
        return Err(format!(
            "Image generation failed with HTTP {status}: {}",
            summarize_response_error(&response_text)
        ));
    }

    let image_base64 = match parse_provider_response(&unified_request, &response_text)
        .map_err(|error| format!("Could not parse image generation response: {error}"))?
    {
        UnifiedProviderResponse::Image(image_base64) => image_base64,
        UnifiedProviderResponse::Text(_) => {
            return Err("Image generation returned an incompatible response".to_string());
        }
    };

    Ok(GeneratedImage {
        image_data_url: format!("data:image/png;base64,{image_base64}"),
    })
}

fn test_text_model(
    client: &Client,
    headers: HeaderMap,
    base_url: &str,
    model: &str,
    request: &ModelTestRequest,
) -> Result<ModelTestResult, String> {
    let unified_request = UnifiedProviderRequest {
        operation: ProviderOperation::TestTextModel,
        provider: request.provider.clone(),
        base_url: base_url.to_string(),
        model: Some(model.to_string()),
        prompt: None,
        reasoning_enabled: request.reasoning_enabled,
        reasoning_effort: request.reasoning_effort.clone(),
        response_verbosity: request.response_verbosity.clone(),
        stream_responses: request.stream_responses,
        image: None,
    };
    let provider_request = build_provider_http_request(&unified_request)?;
    let started_at = Instant::now();
    let response = client
        .post(&provider_request.url)
        .headers(headers)
        .json(
            provider_request
                .body
                .as_ref()
                .ok_or_else(|| "Provider request body is required".to_string())?,
        )
        .send()
        .map_err(|error| {
            let message = format!("Could not test model connection: {error}");
            crate::debug_log::log_provider_request(
                "test_text_model",
                Some(&request.provider),
                Some(model),
                provider_request.method,
                &provider_request.url,
                provider_request.body.as_ref(),
                None,
                None,
                started_at.elapsed().as_millis(),
                Some(&message),
            );
            message
        })?;
    let status = response.status();
    let response_text = read_response_text(response, "model test response")?;
    crate::debug_log::log_provider_request(
        "test_text_model",
        Some(&request.provider),
        Some(model),
        provider_request.method,
        &provider_request.url,
        provider_request.body.as_ref(),
        Some(&response_text),
        Some(status.as_u16()),
        started_at.elapsed().as_millis(),
        None,
    );

    if !status.is_success() {
        return Err(format!(
            "Model connection test failed with HTTP {status}: {}",
            summarize_response_error(&response_text)
        ));
    }

    let output = match parse_provider_response(&unified_request, &response_text)
        .map_err(|error| format!("Could not parse model test response: {error}"))?
    {
        UnifiedProviderResponse::Text(output) => output,
        UnifiedProviderResponse::Image(_) => {
            return Err("Text model test returned an incompatible response".to_string());
        }
    };

    Ok(ModelTestResult {
        model: model.to_string(),
        output,
    })
}

fn test_image_model(
    client: &Client,
    headers: HeaderMap,
    base_url: &str,
    model: &str,
    request: &ModelTestRequest,
) -> Result<ModelTestResult, String> {
    let unified_request = UnifiedProviderRequest {
        operation: ProviderOperation::TestImageModel,
        provider: request.provider.clone(),
        base_url: base_url.to_string(),
        model: Some(model.to_string()),
        prompt: None,
        reasoning_enabled: request.reasoning_enabled,
        reasoning_effort: request.reasoning_effort.clone(),
        response_verbosity: request.response_verbosity.clone(),
        stream_responses: false,
        image: Some(UnifiedImageRequest {
            aspect_ratio: None,
            output_size: None,
            project_quality: None,
            image_quality: None,
            background: None,
            output_format: None,
            output_compression: None,
        }),
    };
    let provider_request = build_provider_http_request(&unified_request)?;
    let started_at = Instant::now();
    let response = client
        .post(&provider_request.url)
        .headers(headers)
        .json(
            provider_request
                .body
                .as_ref()
                .ok_or_else(|| "Provider request body is required".to_string())?,
        )
        .send()
        .map_err(|error| {
            let message = format!("Could not test image model connection: {error}");
            crate::debug_log::log_provider_request(
                "test_image_model",
                Some(&request.provider),
                Some(model),
                provider_request.method,
                &provider_request.url,
                provider_request.body.as_ref(),
                None,
                None,
                started_at.elapsed().as_millis(),
                Some(&message),
            );
            message
        })?;
    let status = response.status();
    let response_text = read_response_text(response, "image model test response")?;
    crate::debug_log::log_provider_request(
        "test_image_model",
        Some(&request.provider),
        Some(model),
        provider_request.method,
        &provider_request.url,
        provider_request.body.as_ref(),
        Some(&response_text),
        Some(status.as_u16()),
        started_at.elapsed().as_millis(),
        None,
    );

    if !status.is_success() {
        return Err(format!(
            "Image model connection test failed with HTTP {status}: {}",
            summarize_response_error(&response_text)
        ));
    }

    match parse_provider_response(&unified_request, &response_text)
        .map_err(|error| format!("Could not parse image model test response: {error}"))?
    {
        UnifiedProviderResponse::Image(_) => {}
        UnifiedProviderResponse::Text(_) => {
            return Err("Image model test returned an incompatible response".to_string());
        }
    }

    Ok(ModelTestResult {
        model: model.to_string(),
        output: "Image output returned from Responses API".to_string(),
    })
}

fn get_provider_api_key(provider: &str) -> Result<Option<String>, String> {
    let entry = provider_entry(provider)?;

    match entry.get_password() {
        Ok(api_key) => Ok(Some(api_key)),
        Err(KeyringError::NoEntry) => get_legacy_provider_api_key(provider),
        Err(error) => Err(format!("Could not read API key: {error}")),
    }
}

fn get_legacy_provider_api_key(provider: &str) -> Result<Option<String>, String> {
    if provider != "openai-compatible" {
        return Ok(None);
    }

    let legacy_entry = Entry::new(SECRET_SERVICE, "custom-provider-api-key")
        .map_err(|error| format!("Could not open legacy keyring: {error}"))?;
    match legacy_entry.get_password() {
        Ok(api_key) => {
            save_provider_api_key(provider, &api_key)?;
            Ok(Some(api_key))
        }
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read legacy API key: {error}")),
    }
}

fn build_provider_http_request(
    request: &UnifiedProviderRequest,
) -> Result<ProviderHttpRequest, String> {
    match request.operation {
        ProviderOperation::TestTextModel | ProviderOperation::AnalyzePromptDirections => {
            let model = require_model(request, "Text model")?;
            let prompt = match request.operation {
                ProviderOperation::TestTextModel => "Reply with exactly: OK".to_string(),
                _ => require_prompt(request, "Text prompt")?.to_string(),
            };
            let mut body = json!({
                "model": model,
                "input": build_responses_user_input(&prompt),
            });
            apply_response_runtime_parameters(
                &mut body,
                request.reasoning_enabled,
                request.reasoning_effort.as_deref(),
                request.response_verbosity.as_deref(),
                request.stream_responses,
            );

            Ok(ProviderHttpRequest {
                method: "POST",
                url: build_responses_url(&request.base_url)?,
                body: Some(body),
            })
        }
        ProviderOperation::TestImageModel => {
            let model = require_model(request, "Image model")?;
            let mut body = json!({
                "model": model,
                "input": build_responses_user_input(
                    "Generate a simple image of a small blue square on a white background."
                ),
                "tools": [
                    {
                        "type": "image_generation"
                    }
                ],
                "tool_choice": {
                    "type": "image_generation"
                }
            });
            apply_response_runtime_parameters(
                &mut body,
                request.reasoning_enabled,
                request.reasoning_effort.as_deref(),
                request.response_verbosity.as_deref(),
                false,
            );

            Ok(ProviderHttpRequest {
                method: "POST",
                url: build_responses_url(&request.base_url)?,
                body: Some(body),
            })
        }
        ProviderOperation::GeneratePromptImage => {
            let model = require_model(request, "Image model")?;
            let image = request
                .image
                .as_ref()
                .ok_or_else(|| "Image request options are required".to_string())?;
            let mut body = json!({
                "model": model,
                "input": build_responses_user_input(require_prompt(request, "Image prompt")?),
                "tools": [
                    build_image_generation_tool(
                        image.aspect_ratio.as_deref().unwrap_or("1:1"),
                        image.output_size.as_deref().unwrap_or("standard"),
                        model,
                        &request.provider,
                        image.project_quality.as_deref(),
                        image.image_quality.as_deref(),
                        image.background.as_deref(),
                        image.output_format.as_deref(),
                        image.output_compression,
                        request.stream_responses,
                    )
                ],
                "tool_choice": {
                    "type": "image_generation"
                }
            });
            apply_response_runtime_parameters(
                &mut body,
                request.reasoning_enabled,
                request.reasoning_effort.as_deref(),
                request.response_verbosity.as_deref(),
                request.stream_responses,
            );

            Ok(ProviderHttpRequest {
                method: "POST",
                url: build_responses_url(&request.base_url)?,
                body: Some(body),
            })
        }
    }
}

fn build_responses_user_input(prompt: &str) -> Value {
    json!([
        {
            "type": "message",
            "role": "user",
            "content": [
                {
                    "type": "input_text",
                    "text": prompt
                }
            ]
        }
    ])
}

fn parse_provider_response(
    request: &UnifiedProviderRequest,
    response_text: &str,
) -> Result<UnifiedProviderResponse, String> {
    let response_json = parse_responses_api_body(response_text)
        .map_err(|error| format!("Could not parse provider response: {error}"))?;

    if let Some(error) = extract_response_error(&response_json) {
        return Err(error);
    }

    match request.operation {
        ProviderOperation::TestTextModel | ProviderOperation::AnalyzePromptDirections => {
            let output = extract_text_output(&response_json)
                .ok_or_else(|| "Model returned an empty response".to_string())?;
            Ok(UnifiedProviderResponse::Text(output))
        }
        ProviderOperation::TestImageModel | ProviderOperation::GeneratePromptImage => {
            let image_base64 = extract_image_base64(&response_json)
                .ok_or_else(|| "Image model returned no image output".to_string())?;
            Ok(UnifiedProviderResponse::Image(image_base64))
        }
    }
}

fn require_model<'a>(request: &'a UnifiedProviderRequest, label: &str) -> Result<&'a str, String> {
    request
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{label} is required"))
}

fn require_prompt<'a>(request: &'a UnifiedProviderRequest, label: &str) -> Result<&'a str, String> {
    request
        .prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{label} is required"))
}

fn apply_response_runtime_parameters(
    body: &mut Value,
    reasoning_enabled: bool,
    reasoning_effort: Option<&str>,
    response_verbosity: Option<&str>,
    stream_responses: bool,
) {
    let Some(body_object) = body.as_object_mut() else {
        return;
    };

    if reasoning_enabled {
        let effort = reasoning_effort
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("medium");
        body_object.insert(
            "reasoning".to_string(),
            json!({
                "effort": effort
            }),
        );
    }

    if let Some(verbosity) = response_verbosity
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "medium")
    {
        body_object.insert(
            "text".to_string(),
            json!({
                "verbosity": verbosity
            }),
        );
    }

    if stream_responses {
        body_object.insert("stream".to_string(), Value::Bool(true));
    }
}

fn build_image_generation_tool(
    aspect_ratio: &str,
    output_size: &str,
    model: &str,
    provider: &str,
    quality: Option<&str>,
    image_quality: Option<&str>,
    background: Option<&str>,
    output_format: Option<&str>,
    output_compression: Option<i64>,
    stream_responses: bool,
) -> Value {
    let mut tool = json!({
        "type": "image_generation",
        "size": map_image_size(aspect_ratio, output_size, model, provider)
    });

    tool["quality"] = json!(map_image_quality(image_quality, quality));

    if let Some(background) = background
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "auto")
    {
        tool["background"] = json!(background);
    }

    if let Some(output_format) = output_format
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "png")
    {
        tool["output_format"] = json!(output_format);
    }

    if let Some(output_compression) = output_compression {
        if output_compression < 100 {
            tool["output_compression"] = json!(output_compression.clamp(0, 100));
        }
    }

    if supports_partial_image_streaming(model) && stream_responses {
        tool["partial_images"] = json!(1);
    }

    tool
}

fn provider_entry(provider: &str) -> Result<Entry, String> {
    let account = match provider {
        "openai" => "openai-api-key",
        "deepseek" => "deepseek-api-key",
        "openai-compatible" => "openai-compatible-provider-api-key",
        _ => return Err("Unsupported provider".to_string()),
    };

    Entry::new(SECRET_SERVICE, account).map_err(|error| format!("Could not open keyring: {error}"))
}

fn build_models_url(base_url: &str) -> Result<String, String> {
    build_endpoint_url(base_url, "models")
}

fn build_responses_url(base_url: &str) -> Result<String, String> {
    build_endpoint_url(base_url, "responses")
}

fn build_endpoint_url(base_url: &str, endpoint: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Base URL is required".to_string());
    }

    if trimmed.ends_with(&format!("/{endpoint}")) {
        return Ok(trimmed.to_string());
    }

    let alternate_endpoint = match endpoint {
        "models" => "responses",
        _ => "models",
    };
    if let Some(base) = trimmed.strip_suffix(alternate_endpoint) {
        if base.ends_with('/') {
            return Ok(format!("{base}{endpoint}"));
        }
    }

    Ok(format!("{trimmed}/{endpoint}"))
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

fn apply_default_provider_headers(headers: &mut HeaderMap) {
    headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("identity"));
}

fn read_response_text(response: Response, label: &str) -> Result<String, String> {
    let content_type = header_value(response.headers(), CONTENT_TYPE);
    let content_encoding = header_value(response.headers(), CONTENT_ENCODING);
    let response_context = match (content_type.as_deref(), content_encoding.as_deref()) {
        (Some(content_type), Some(content_encoding)) => {
            format!(" (content-type: {content_type}, content-encoding: {content_encoding})")
        }
        (Some(content_type), None) => format!(" (content-type: {content_type})"),
        (None, Some(content_encoding)) => {
            format!(" (content-encoding: {content_encoding})")
        }
        (None, None) => String::new(),
    };

    if content_type
        .as_deref()
        .map(is_event_stream_content_type)
        .unwrap_or(false)
    {
        return read_event_stream_text(response, label, &response_context);
    }

    response
        .bytes()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .map_err(|error| format!("Could not read {label}: {error}{response_context}"))
}

fn is_event_stream_content_type(value: &str) -> bool {
    value.to_ascii_lowercase().contains("text/event-stream")
}

struct ImageStreamFailure {
    message: String,
    response_text: String,
}

fn read_image_generation_stream(response: Response) -> Result<String, ImageStreamFailure> {
    let mut reader = BufReader::new(response);
    let mut line = String::new();
    let mut data_lines = Vec::new();
    let mut fallback_image_base64: Option<String> = None;

    loop {
        line.clear();
        let byte_count = reader
            .read_line(&mut line)
            .map_err(|error| ImageStreamFailure {
                message: format!("Could not read image generation stream: {error}"),
                response_text: String::new(),
            })?;

        if byte_count == 0 {
            break;
        }

        let trimmed_line = line.trim_end_matches(['\r', '\n']);
        if trimmed_line.is_empty() {
            match process_image_stream_event(&data_lines)? {
                ImageStreamEvent::Image(result) => return Ok(result),
                ImageStreamEvent::FallbackImage(result) => {
                    fallback_image_base64 = Some(result);
                }
                ImageStreamEvent::Failure(failure) => {
                    return Err(failure);
                }
                ImageStreamEvent::Done => break,
                ImageStreamEvent::Continue => {}
            }
            data_lines.clear();
            continue;
        }

        if let Some(data) = trimmed_line.trim().strip_prefix("data:") {
            data_lines.push(data.trim_start().to_string());
        }
    }

    if !data_lines.is_empty() {
        match process_image_stream_event(&data_lines)? {
            ImageStreamEvent::Image(result) => return Ok(result),
            ImageStreamEvent::FallbackImage(result) => {
                fallback_image_base64 = Some(result);
            }
            ImageStreamEvent::Failure(failure) => {
                return Err(failure);
            }
            ImageStreamEvent::Done | ImageStreamEvent::Continue => {}
        }
    }

    fallback_image_base64.ok_or_else(|| ImageStreamFailure {
        message: "Image generation stream ended without a final image output".to_string(),
        response_text: String::new(),
    })
}

enum ImageStreamEvent {
    Image(String),
    FallbackImage(String),
    Failure(ImageStreamFailure),
    Done,
    Continue,
}

fn process_image_stream_event(
    data_lines: &[String],
) -> Result<ImageStreamEvent, ImageStreamFailure> {
    if data_lines.is_empty() {
        return Ok(ImageStreamEvent::Continue);
    }

    let data = data_lines.join("\n");
    if data.trim() == "[DONE]" {
        return Ok(ImageStreamEvent::Done);
    }

    let event = match serde_json::from_str::<Value>(&data) {
        Ok(event) => event,
        Err(_) if data.contains("\"partial_image\"") => {
            return Ok(ImageStreamEvent::Continue);
        }
        Err(error) => {
            return Err(ImageStreamFailure {
                message: format!("Could not parse image generation stream event: {error}"),
                response_text: data,
            });
        }
    };

    let event_type = event
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if event_type == "response.image_generation_call.partial_image" {
        return Ok(ImageStreamEvent::Continue);
    }

    if event_type == "response.image_generation_call.completed" {
        if let Some(result) = extract_image_result_from_event(&event) {
            return Ok(ImageStreamEvent::Image(result));
        }
    }

    if event_type == "response.output_item.done" {
        if let Some(result) = extract_image_result_from_event(&event) {
            return Ok(ImageStreamEvent::Image(result));
        }
    }

    if event_type == "response.completed" {
        if let Some(response) = event.get("response") {
            if let Some(error) = extract_response_error(response)
                .filter(|_| extract_image_base64(response).is_none())
            {
                return Err(ImageStreamFailure {
                    message: error,
                    response_text: data,
                });
            }

            if let Some(result) = extract_image_base64(response) {
                return Ok(ImageStreamEvent::Image(result));
            }
        }
    }

    if event_type == "response.failed" {
        let response = event.get("response").unwrap_or(&event);
        return Ok(ImageStreamEvent::Failure(ImageStreamFailure {
            message: extract_response_error(response)
                .unwrap_or_else(|| "Image generation stream failed".to_string()),
            response_text: data,
        }));
    }

    if let Some(result) = extract_image_result_from_event(&event) {
        if event_type.contains("image_generation_call") {
            return Ok(ImageStreamEvent::FallbackImage(result));
        }
    }

    Ok(ImageStreamEvent::Continue)
}

fn extract_image_result_from_event(event: &Value) -> Option<String> {
    event
        .get("result")
        .and_then(Value::as_str)
        .or_else(|| {
            event
                .get("item")
                .and_then(|item| item.get("result"))
                .and_then(Value::as_str)
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn read_event_stream_text(
    response: Response,
    label: &str,
    response_context: &str,
) -> Result<String, String> {
    let mut reader = BufReader::new(response);
    let mut response_text = String::new();
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                let trimmed_line = line.trim_end_matches(['\r', '\n']);
                response_text.push_str(trimmed_line);
                response_text.push('\n');

                if event_stream_is_complete(trimmed_line) {
                    break;
                }
            }
            Err(error) => {
                if response_text.lines().any(event_stream_is_complete) {
                    return Ok(response_text);
                }

                return Err(format!("Could not read {label}: {error}{response_context}"));
            }
        }
    }

    Ok(response_text)
}

fn event_stream_is_complete(line: &str) -> bool {
    let Some(data) = line.trim().strip_prefix("data:") else {
        return false;
    };
    let data = data.trim();

    data == "[DONE]"
        || data.contains("\"type\":\"response.completed\"")
        || data.contains("\"type\": \"response.completed\"")
        || data.contains("\"type\":\"response.failed\"")
        || data.contains("\"type\": \"response.failed\"")
}

fn header_value(headers: &HeaderMap, name: HeaderName) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string)
}

fn extract_text_output(response_json: &Value) -> Option<String> {
    if let Some(output_text) = response_json
        .get("output_text")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(output_text.to_string());
    }

    if let Some(output) = response_json.get("output").and_then(Value::as_array) {
        for item in output {
            if item.get("type").and_then(Value::as_str) != Some("message") {
                continue;
            }

            let Some(content) = item.get("content").and_then(Value::as_array) else {
                continue;
            };

            let text = content
                .iter()
                .filter_map(|content_item| {
                    content_item
                        .get("text")
                        .or_else(|| content_item.get("output_text"))
                        .or_else(|| content_item.get("content"))
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                })
                .collect::<Vec<_>>()
                .join("\n");

            if !text.is_empty() {
                return Some(text);
            }
        }
    }

    extract_chat_completion_output(response_json)
}

fn parse_responses_api_body(response_text: &str) -> Result<Value, serde_json::Error> {
    if let Ok(mut response_json) = serde_json::from_str::<Value>(response_text) {
        normalize_responses_output_items(&mut response_json);
        return Ok(response_json);
    }

    let mut state = ResponsesStreamState::default();

    for line in response_text.lines() {
        let line = line.trim();
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }

        let event = serde_json::from_str::<Value>(data)?;
        if let Some(response) = apply_responses_stream_event(&event, &mut state) {
            return Ok(response);
        }
    }

    Ok(json!({
        "output_text": state.preferred_text(),
        "output": state.output_items()
    }))
}

#[derive(Default)]
struct ResponsesStreamState {
    delta_text: String,
    done_text: String,
    output: Vec<ResponsesOutputItemState>,
    output_indexes: HashMap<String, usize>,
    current_output_item_id: Option<String>,
}

impl ResponsesStreamState {
    fn preferred_text(&self) -> &str {
        if self.done_text.trim().is_empty() {
            self.delta_text.as_str()
        } else {
            self.done_text.as_str()
        }
    }

    fn output_items(&self) -> Vec<Value> {
        self.output
            .iter()
            .map(ResponsesOutputItemState::to_value)
            .collect()
    }

    fn capture_output_item(&mut self, item: &Value) {
        let item_state = ResponsesOutputItemState::from_value(item.clone());
        if let Some(item_id) = item_state.id().map(str::to_string) {
            if let Some(index) = self.output_indexes.get(&item_id).copied() {
                self.output[index].merge(item_state);
                self.current_output_item_id = Some(item_id);
                return;
            }

            let index = self.output.len();
            self.output_indexes.insert(item_id.clone(), index);
            self.current_output_item_id = Some(item_id);
        }

        self.output.push(item_state);
    }

    fn ensure_output_item(
        &mut self,
        event: &Value,
        fallback_type: &str,
    ) -> &mut ResponsesOutputItemState {
        let item_id = event
            .get("item_id")
            .or_else(|| event.get("output_item_id"))
            .or_else(|| event.get("id"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| self.current_output_item_id.clone());

        if let Some(item_id) = item_id {
            if let Some(index) = self.output_indexes.get(&item_id).copied() {
                self.current_output_item_id = Some(item_id);
                return &mut self.output[index];
            }

            let index = self.output.len();
            self.output
                .push(ResponsesOutputItemState::from_value(json!({
                    "id": item_id,
                    "type": fallback_type
                })));
            self.output_indexes.insert(item_id.clone(), index);
            self.current_output_item_id = Some(item_id);
            return &mut self.output[index];
        }

        let index = self.output.len();
        self.output.push(ResponsesOutputItemState::from_value(
            json!({ "type": fallback_type }),
        ));
        &mut self.output[index]
    }
}

struct ResponsesOutputItemState {
    item: Value,
    function_call_arguments: String,
    reasoning_text: String,
    reasoning_summary_text: String,
}

impl ResponsesOutputItemState {
    fn from_value(item: Value) -> Self {
        let function_call_arguments = item
            .get("arguments")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let reasoning_summary_text = extract_reasoning_summary_text(&item).unwrap_or_default();

        Self {
            item,
            function_call_arguments,
            reasoning_text: String::new(),
            reasoning_summary_text,
        }
    }

    fn id(&self) -> Option<&str> {
        self.item.get("id").and_then(Value::as_str)
    }

    fn merge(&mut self, next: ResponsesOutputItemState) {
        if self.function_call_arguments.trim().is_empty() {
            self.function_call_arguments = next.function_call_arguments;
        }

        if self.reasoning_text.trim().is_empty() {
            self.reasoning_text = next.reasoning_text;
        }

        if self.reasoning_summary_text.trim().is_empty() {
            self.reasoning_summary_text = next.reasoning_summary_text;
        }

        merge_json_object(&mut self.item, next.item);
    }

    fn append_function_call_arguments(&mut self, delta: &str) {
        self.function_call_arguments.push_str(delta);
        set_string_field(&mut self.item, "arguments", &self.function_call_arguments);
    }

    fn set_function_call_arguments(&mut self, arguments: &str) {
        self.function_call_arguments = arguments.to_string();
        set_string_field(&mut self.item, "arguments", arguments);
    }

    fn append_reasoning_text(&mut self, delta: &str) {
        self.reasoning_text.push_str(delta);
        append_reasoning_content(&mut self.item, delta);
    }

    fn append_reasoning_summary_text(&mut self, delta: &str) {
        self.reasoning_summary_text.push_str(delta);
        set_reasoning_summary_text(&mut self.item, &self.reasoning_summary_text);
    }

    fn set_reasoning_summary_text(&mut self, text: &str) {
        self.reasoning_summary_text = text.to_string();
        set_reasoning_summary_text(&mut self.item, text);
    }

    fn to_value(&self) -> Value {
        let mut item = self.item.clone();
        if !self.function_call_arguments.trim().is_empty() {
            set_string_field(&mut item, "arguments", &self.function_call_arguments);
        }

        if !self.reasoning_summary_text.trim().is_empty() {
            set_reasoning_summary_text(&mut item, &self.reasoning_summary_text);
        }

        item
    }
}

fn apply_responses_stream_event(event: &Value, state: &mut ResponsesStreamState) -> Option<Value> {
    match event.get("type").and_then(Value::as_str) {
        Some("response.output_item.added") => {
            if let Some(item) = event.get("item") {
                state.capture_output_item(item);
            }
        }
        Some("response.output_text.delta") => {
            if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                state.delta_text.push_str(delta);
            }
        }
        Some("response.output_text.done") => {
            if let Some(text) = event.get("text").and_then(Value::as_str) {
                state.done_text = text.to_string();
            }
        }
        Some("response.content_part.done") => {
            if let Some(text) = event
                .get("part")
                .and_then(|part| part.get("text"))
                .and_then(Value::as_str)
            {
                state.done_text = text.to_string();
            }
        }
        Some("response.output_item.done") => {
            if let Some(item) = event.get("item") {
                capture_responses_output_item(item, state);
            }
        }
        Some("response.function_call_arguments.delta") => {
            if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                state
                    .ensure_output_item(event, "function_call")
                    .append_function_call_arguments(delta);
            }
        }
        Some("response.function_call_arguments.done") => {
            let arguments = event
                .get("arguments")
                .or_else(|| event.get("text"))
                .and_then(Value::as_str);
            if let Some(arguments) = arguments {
                state
                    .ensure_output_item(event, "function_call")
                    .set_function_call_arguments(arguments);
            }
        }
        Some("response.reasoning.delta") => {
            if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                state
                    .ensure_output_item(event, "reasoning")
                    .append_reasoning_text(delta);
            }
        }
        Some("response.reasoning_summary_text.delta") => {
            if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                state
                    .ensure_output_item(event, "reasoning")
                    .append_reasoning_summary_text(delta);
            }
        }
        Some("response.reasoning_summary_text.done") | Some("response.reasoning.done") => {
            let text = event
                .get("text")
                .or_else(|| event.get("summary_text"))
                .and_then(Value::as_str);
            if let Some(text) = text {
                state
                    .ensure_output_item(event, "reasoning")
                    .set_reasoning_summary_text(text);
            }
        }
        Some("response.completed") => {
            if let Some(response) = event.get("response") {
                return Some(merge_stream_text_into_response(
                    response.clone(),
                    state.preferred_text(),
                    &state.output_items(),
                ));
            }
        }
        Some("response.failed") => {
            let response = event
                .get("response")
                .cloned()
                .unwrap_or_else(|| event.clone());
            return Some(merge_stream_text_into_response(
                response,
                state.preferred_text(),
                &state.output_items(),
            ));
        }
        Some(event_type) if event_type.contains("image_generation_call") => {
            capture_responses_image_event(event, state);
        }
        _ => {}
    }

    None
}

fn capture_responses_output_item(item: &Value, state: &mut ResponsesStreamState) {
    if let Some(text) = extract_text_output(item) {
        state.done_text = text;
        state.capture_output_item(item);
    } else if let Some(result) = item.get("result").and_then(Value::as_str) {
        state.capture_output_item(&json!({
            "type": "image_generation_call",
            "result": result
        }));
    } else {
        state.capture_output_item(item);
    }
}

fn capture_responses_image_event(event: &Value, state: &mut ResponsesStreamState) {
    if let Some(result) = event.get("result").and_then(Value::as_str) {
        state.capture_output_item(&json!({
            "type": "image_generation_call",
            "result": result
        }));
    } else if let Some(result) = event
        .get("item")
        .and_then(|item| item.get("result"))
        .and_then(Value::as_str)
    {
        state.capture_output_item(&json!({
            "type": "image_generation_call",
            "result": result
        }));
    } else if event.get("type").and_then(Value::as_str)
        != Some("response.image_generation_call.partial_image")
    {
        if let Some(item) = event.get("item") {
            state.capture_output_item(item);
        }
    }
}

fn merge_stream_text_into_response(
    mut response: Value,
    output_text: &str,
    output: &[Value],
) -> Value {
    normalize_responses_output_items(&mut response);

    let has_extractable_text = extract_text_output(&response).is_some();
    let trimmed_output_text = output_text.trim();
    if has_extractable_text && output.is_empty() {
        return response;
    }

    if !has_extractable_text && trimmed_output_text.is_empty() && output.is_empty() {
        return response;
    }

    let should_insert_output = !output.is_empty()
        && response
            .get("output")
            .and_then(Value::as_array)
            .map(Vec::is_empty)
            .unwrap_or(true);

    if let Some(response_object) = response.as_object_mut() {
        if !has_extractable_text && !trimmed_output_text.is_empty() {
            response_object.insert(
                "output_text".to_string(),
                Value::String(trimmed_output_text.to_string()),
            );
        }

        if should_insert_output {
            response_object.insert("output".to_string(), Value::Array(output.to_vec()));
        }
    }

    response
}

fn normalize_responses_output_items(response: &mut Value) {
    let Some(output) = response.get_mut("output").and_then(Value::as_array_mut) else {
        return;
    };

    for item in output {
        let mut item_state = ResponsesOutputItemState::from_value(item.clone());
        if let Some(arguments) = item.get("arguments").and_then(Value::as_str) {
            item_state.set_function_call_arguments(arguments);
        }
        *item = item_state.to_value();
    }
}

fn merge_json_object(target: &mut Value, source: Value) {
    let (Some(target_object), Some(source_object)) = (target.as_object_mut(), source.as_object())
    else {
        if target.is_null() {
            *target = source;
        }
        return;
    };

    for (key, value) in source_object {
        if value.is_null() {
            continue;
        }

        match target_object.get_mut(key) {
            Some(existing) if existing.is_object() && value.is_object() => {
                merge_json_object(existing, value.clone());
            }
            Some(existing) if value_is_empty(existing) && !value_is_empty(value) => {
                *existing = value.clone();
            }
            None => {
                target_object.insert(key.clone(), value.clone());
            }
            _ => {}
        }
    }
}

fn value_is_empty(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::String(text) => text.trim().is_empty(),
        Value::Array(items) => items.is_empty(),
        Value::Object(object) => object.is_empty(),
        _ => false,
    }
}

fn set_string_field(item: &mut Value, field: &str, value: &str) {
    if let Some(object) = item.as_object_mut() {
        object.insert(field.to_string(), Value::String(value.to_string()));
    }
}

fn append_reasoning_content(item: &mut Value, delta: &str) {
    if let Some(object) = item.as_object_mut() {
        if object.get("type").and_then(Value::as_str).is_none() {
            object.insert("type".to_string(), Value::String("reasoning".to_string()));
        }

        let content = object
            .entry("content".to_string())
            .or_insert_with(|| Value::Array(Vec::new()));
        if let Some(content_items) = content.as_array_mut() {
            content_items.push(json!({
                "type": "reasoning_text",
                "text": delta
            }));
        }
    }
}

fn set_reasoning_summary_text(item: &mut Value, text: &str) {
    if let Some(object) = item.as_object_mut() {
        if object.get("type").and_then(Value::as_str).is_none() {
            object.insert("type".to_string(), Value::String("reasoning".to_string()));
        }

        object.insert(
            "summary".to_string(),
            Value::Array(vec![json!({
                "type": "summary_text",
                "text": text
            })]),
        );
    }
}

fn extract_reasoning_summary_text(item: &Value) -> Option<String> {
    let summary = item.get("summary")?.as_array()?;
    let text = summary
        .iter()
        .filter_map(|summary_item| {
            summary_item
                .get("text")
                .or_else(|| summary_item.get("summary_text"))
                .or_else(|| summary_item.get("content"))
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
        })
        .collect::<Vec<_>>()
        .join("\n");

    (!text.is_empty()).then_some(text)
}

fn extract_response_error(response_json: &Value) -> Option<String> {
    let status = response_json.get("status").and_then(Value::as_str);
    let error = response_json
        .get("error")
        .filter(|error| !matches!(error, Value::Null));

    if status != Some("failed") && error.is_none() {
        return None;
    }

    let message = error
        .and_then(|error| {
            error
                .get("message")
                .or_else(|| error.get("error"))
                .and_then(Value::as_str)
        })
        .or_else(|| response_json.get("message").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Provider returned a failed response");

    Some(message.to_string())
}

fn build_prompt_analysis_input(request: &PromptAnalyzeRequest, grid_size: usize) -> String {
    [
        "You create image-generation prompt directions for a visual exploration grid.".to_string(),
        format!("Return exactly {grid_size} distinct directions and one short chat title as strict JSON with this shape:"),
        "{\"conversationTitle\":\"short title for this exploration\",\"directions\":[{\"title\":\"concise direction title\",\"prompt\":\"full image generation prompt\"}]}".to_string(),
        "Do not include markdown, commentary, numbering, or extra keys.".to_string(),
        "The conversationTitle should summarize the original idea in 3 to 8 words and use the same language as the original idea.".to_string(),
        "Each title should be 2 to 6 words, concrete, and in the same language as the original idea."
            .to_string(),
        format!("Original idea: {}", request.original_prompt.trim()),
        format!("Visual style: {}", request.style.trim()),
        format!("Aspect ratio: {}", request.aspect_ratio.trim()),
        format!("Render quality target: {}", request.quality.trim()),
        format!("Output size target: {}", request.output_size.trim()),
        "Each prompt should be specific, production-ready, and visually different from the others."
            .to_string(),
    ]
    .join("\n")
}

fn parse_prompt_directions(output: &str, grid_size: usize) -> Result<PromptAnalysisResult, String> {
    let json = parse_json_from_text(output)
        .map_err(|error| format!("Prompt analysis did not return valid JSON: {error}"))?;
    let directions = json
        .get("directions")
        .and_then(Value::as_array)
        .ok_or_else(|| "Prompt analysis returned no directions".to_string())?;
    let prompts = directions
        .iter()
        .enumerate()
        .filter_map(|(index, direction)| {
            let prompt = direction
                .get("prompt")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())?;
            let title = direction
                .get("title")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| format!("Direction {}", index + 1));

            Some(PromptDirection {
                title,
                prompt: prompt.to_string(),
            })
        })
        .take(grid_size)
        .collect::<Vec<_>>();

    if prompts.is_empty() {
        return Err("Prompt analysis returned no directions".to_string());
    }

    let conversation_title = json
        .get("conversationTitle")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| prompts[0].title.clone());

    Ok(PromptAnalysisResult {
        conversation_title,
        directions: prompts,
    })
}

fn parse_json_from_text(output: &str) -> Result<Value, serde_json::Error> {
    let trimmed = output.trim();
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        return Ok(value);
    }

    if let (Some(start), Some(end)) = (trimmed.find('{'), trimmed.rfind('}')) {
        if end > start {
            return serde_json::from_str::<Value>(&trimmed[start..=end]);
        }
    }

    if let (Some(start), Some(end)) = (trimmed.find('['), trimmed.rfind(']')) {
        if end > start {
            let array = serde_json::from_str::<Value>(&trimmed[start..=end])?;
            return Ok(json!({ "directions": array }));
        }
    }

    serde_json::from_str::<Value>(trimmed)
}

fn extract_chat_completion_output(response_json: &Value) -> Option<String> {
    let choices = response_json.get("choices")?.as_array()?;

    choices.iter().find_map(|choice| {
        let message = choice.get("message");
        let content = message
            .and_then(|value| value.get("content"))
            .or_else(|| choice.get("text"))?;

        extract_text_content(content).filter(|output| !output.trim().is_empty())
    })
}

fn extract_text_content(content: &Value) -> Option<String> {
    match content {
        Value::String(value) => Some(value.trim().to_string()),
        Value::Array(items) => {
            let output = items
                .iter()
                .filter_map(|item| {
                    item.get("text")
                        .or_else(|| item.get("content"))
                        .and_then(Value::as_str)
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                })
                .collect::<Vec<_>>()
                .join("\n");

            (!output.is_empty()).then_some(output)
        }
        _ => None,
    }
}

fn extract_image_base64(response_json: &Value) -> Option<String> {
    if let Some(output) = response_json.get("output").and_then(Value::as_array) {
        for item in output {
            if item.get("type").and_then(Value::as_str) != Some("image_generation_call") {
                continue;
            }

            if let Some(result) = item
                .get("result")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                return Some(result.to_string());
            }
        }
    }

    response_json
        .get("data")
        .and_then(Value::as_array)
        .and_then(|images| {
            images.iter().find_map(|image| {
                image
                    .get("b64_json")
                    .or_else(|| image.get("url"))
                    .and_then(Value::as_str)
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            })
        })
}

fn map_image_quality(image_quality: Option<&str>, project_quality: Option<&str>) -> &'static str {
    match image_quality
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "auto")
    {
        Some("low") => "low",
        Some("medium") => "medium",
        Some("high") => "high",
        _ => match project_quality.unwrap_or("draft") {
            "high" => "high",
            "standard" => "medium",
            _ => "low",
        },
    }
}

fn map_image_size(
    aspect_ratio: &str,
    output_size: &str,
    model: &str,
    provider: &str,
) -> &'static str {
    if !supports_flexible_image_size(model, provider) {
        return map_legacy_image_size(aspect_ratio);
    }

    match output_size {
        "4k" => match aspect_ratio {
            "9:16" => "2160x3840",
            "4:3" => "3264x2448",
            "1:1" => "2880x2880",
            _ => "3840x2160",
        },
        "2k" => match aspect_ratio {
            "9:16" => "1152x2048",
            "4:3" => "2048x1536",
            "1:1" => "2048x2048",
            _ => "2048x1152",
        },
        "large" => match aspect_ratio {
            "9:16" => "1088x1920",
            "4:3" => "1440x1088",
            "1:1" => "1536x1536",
            _ => "1920x1088",
        },
        _ => map_legacy_image_size(aspect_ratio),
    }
}

fn map_legacy_image_size(aspect_ratio: &str) -> &'static str {
    match aspect_ratio {
        "16:9" | "4:3" => "1536x1024",
        "9:16" => "1024x1536",
        _ => "1024x1024",
    }
}

fn supports_flexible_image_size(model: &str, provider: &str) -> bool {
    let _ = provider;
    model.to_lowercase().contains("gpt-image-2")
}

fn supports_partial_image_streaming(model: &str) -> bool {
    model.to_lowercase().contains("gpt-image-2")
}

fn default_output_size() -> String {
    "standard".to_string()
}

fn summarize_response_error(response_text: &str) -> String {
    if let Ok(response_json) = serde_json::from_str::<Value>(response_text) {
        if let Some(message) = response_json
            .get("error")
            .and_then(|error| error.get("message"))
            .and_then(Value::as_str)
        {
            return message.to_string();
        }
    }

    let trimmed = response_text.trim();
    if trimmed.is_empty() {
        return "empty response body".to_string();
    }

    trimmed.chars().take(240).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_stream_text_when_completed_response_has_empty_output() {
        let response_text = r#"event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"OK"}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_test","output":[]}}
"#;

        let response_json = parse_responses_api_body(response_text).unwrap();
        assert_eq!(extract_text_output(&response_json).as_deref(), Some("OK"));
    }

    #[test]
    fn does_not_duplicate_stream_text_from_delta_done_and_item_done() {
        let response_text = r#"event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"{\"directions\":[]}"}

event: response.output_text.done
data: {"type":"response.output_text.done","text":"{\"directions\":[]}"}

event: response.output_item.done
data: {"type":"response.output_item.done","item":{"type":"message","content":[{"type":"output_text","text":"{\"directions\":[]}"}]}}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_test","output":[]}}
"#;

        let response_json = parse_responses_api_body(response_text).unwrap();
        assert_eq!(
            extract_text_output(&response_json).as_deref(),
            Some("{\"directions\":[]}")
        );
    }

    #[test]
    fn builds_responses_message_input_items() {
        let request = UnifiedProviderRequest {
            operation: ProviderOperation::TestTextModel,
            provider: "openai".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            model: Some("test-text".to_string()),
            prompt: None,
            reasoning_enabled: false,
            reasoning_effort: None,
            response_verbosity: None,
            stream_responses: false,
            image: None,
        };

        let provider_request = build_provider_http_request(&request).unwrap();
        let input = provider_request
            .body
            .as_ref()
            .and_then(|body| body.get("input"))
            .unwrap();

        assert_eq!(
            input,
            &json!([
                {
                    "type": "message",
                    "role": "user",
                    "content": [
                        {
                            "type": "input_text",
                            "text": "Reply with exactly: OK"
                        }
                    ]
                }
            ])
        );
    }

    #[test]
    fn parses_stream_function_call_arguments_and_reasoning_summary() {
        let response_text = r#"event: response.output_item.added
data: {"type":"response.output_item.added","item":{"id":"call_1","type":"function_call","name":"lookup","arguments":""}}

event: response.function_call_arguments.delta
data: {"type":"response.function_call_arguments.delta","item_id":"call_1","delta":"{\"q\""}

event: response.function_call_arguments.done
data: {"type":"response.function_call_arguments.done","item_id":"call_1","arguments":"{\"q\":\"codex\"}"}

event: response.reasoning_summary_text.delta
data: {"type":"response.reasoning_summary_text.delta","item_id":"rs_1","delta":"Checked"}

event: response.reasoning_summary_text.done
data: {"type":"response.reasoning_summary_text.done","item_id":"rs_1","text":"Checked docs"}

event: response.completed
data: {"type":"response.completed","response":{"id":"resp_test","output":[]}}
"#;

        let response_json = parse_responses_api_body(response_text).unwrap();
        let output = response_json
            .get("output")
            .and_then(Value::as_array)
            .unwrap();

        assert_eq!(
            output[0].get("type").and_then(Value::as_str),
            Some("function_call")
        );
        assert_eq!(
            output[0].get("arguments").and_then(Value::as_str),
            Some("{\"q\":\"codex\"}")
        );
        assert_eq!(
            output[1].get("type").and_then(Value::as_str),
            Some("reasoning")
        );
        assert_eq!(
            output[1]
                .get("summary")
                .and_then(Value::as_array)
                .and_then(|summary| summary.first())
                .and_then(|summary| summary.get("text"))
                .and_then(Value::as_str),
            Some("Checked docs")
        );
    }

    #[test]
    fn surfaces_responses_failed_event_error() {
        let request = UnifiedProviderRequest {
            operation: ProviderOperation::TestTextModel,
            provider: "openai".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            model: Some("test-text".to_string()),
            prompt: None,
            reasoning_enabled: false,
            reasoning_effort: None,
            response_verbosity: None,
            stream_responses: false,
            image: None,
        };
        let response_text = r#"event: response.failed
data: {"type":"response.failed","response":{"status":"failed","error":{"message":"bad request"}}}
"#;

        let error = match parse_provider_response(&request, response_text) {
            Ok(_) => panic!("expected failed response to return an error"),
            Err(error) => error,
        };
        assert_eq!(error, "bad request");
    }

    #[test]
    fn ignores_null_error_on_completed_responses_response() {
        let request = UnifiedProviderRequest {
            operation: ProviderOperation::TestTextModel,
            provider: "openai".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            model: Some("test-text".to_string()),
            prompt: None,
            reasoning_enabled: false,
            reasoning_effort: None,
            response_verbosity: None,
            stream_responses: false,
            image: None,
        };
        let response_text = r#"{"status":"completed","error":null,"output":[{"type":"message","content":[{"type":"output_text","text":"OK"}]}]}"#;

        let output = match parse_provider_response(&request, response_text).unwrap() {
            UnifiedProviderResponse::Text(output) => output,
            UnifiedProviderResponse::Image(_) => panic!("expected text response"),
        };

        assert_eq!(output, "OK");
    }

    #[test]
    fn prompt_analysis_runtime_parameters_do_not_enable_streaming() {
        let request = PromptAnalyzeRequest {
            provider: "openai-compatible".to_string(),
            base_url: "https://example.test/v1".to_string(),
            custom_headers: None,
            text_model: "test-text".to_string(),
            original_prompt: "A launch image".to_string(),
            style: "Editorial".to_string(),
            aspect_ratio: "1:1".to_string(),
            quality: "high".to_string(),
            output_size: "standard".to_string(),
            grid_size: 9,
            reasoning_enabled: false,
            reasoning_effort: None,
            response_verbosity: None,
        };
        let mut body = json!({
            "model": request.text_model,
            "input": build_prompt_analysis_input(&request, 9)
        });

        apply_response_runtime_parameters(
            &mut body,
            request.reasoning_enabled,
            request.reasoning_effort.as_deref(),
            request.response_verbosity.as_deref(),
            false,
        );

        assert!(body.get("stream").is_none());
    }
}
