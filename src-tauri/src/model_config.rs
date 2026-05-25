use keyring::{Entry, Error as KeyringError};
use reqwest::blocking::{Client, Response};
use reqwest::header::{
    HeaderMap, HeaderName, HeaderValue, ACCEPT_ENCODING, AUTHORIZATION, CONTENT_ENCODING,
    CONTENT_TYPE,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};
use std::time::{Duration, Instant};

const SECRET_SERVICE: &str = "PromptGrid Desktop";

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
    #[serde(default)]
    stream_responses: bool,
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
    prompt: String,
    aspect_ratio: String,
    quality: String,
    #[serde(default = "default_output_size")]
    output_size: String,
    response_verbosity: Option<String>,
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
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|error| format!("Could not create HTTP client: {error}"))?;
    let grid_size = request.grid_size.clamp(1, 25);
    let mut body = json!({
        "model": model,
        "input": build_prompt_analysis_input(&request, grid_size)
    });
    apply_response_runtime_parameters(
        &mut body,
        request.reasoning_enabled,
        request.reasoning_effort.as_deref(),
        request.response_verbosity.as_deref(),
        request.stream_responses,
    );
    let responses_url = build_responses_url(&request.base_url)?;
    let started_at = Instant::now();

    let response = client
        .post(&responses_url)
        .headers(headers)
        .json(&body)
        .send()
        .map_err(|error| {
            let message = format!("Could not analyze prompt directions: {error}");
            crate::debug_log::log_provider_request(
                "analyze_prompt_directions",
                Some(&request.provider),
                Some(model),
                "POST",
                &responses_url,
                Some(&body),
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
        "POST",
        &responses_url,
        Some(&body),
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

    let response_json = parse_responses_api_body(&response_text)
        .map_err(|error| format!("Could not parse prompt analysis response: {error}"))?;
    let output = extract_text_output(&response_json)
        .ok_or_else(|| "Prompt analysis returned an empty response".to_string())?;

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
    let mut body = json!({
        "model": model,
        "input": prompt,
        "tools": [
            build_image_generation_tool(
                &request.aspect_ratio,
                &request.output_size,
                model,
                &request.provider,
                Some(&request.quality)
            )
        ],
        "tool_choice": {
            "type": "image_generation"
        }
    });
    apply_response_runtime_parameters(
        &mut body,
        false,
        None,
        request.response_verbosity.as_deref(),
        true,
    );
    let responses_url = build_responses_url(&request.base_url)?;
    let started_at = Instant::now();

    let response = client
        .post(&responses_url)
        .headers(headers)
        .json(&body)
        .send()
        .map_err(|error| {
            let message = format!("Could not generate image: {error}");
            crate::debug_log::log_provider_request(
                "generate_prompt_image",
                Some(&request.provider),
                Some(model),
                "POST",
                &responses_url,
                Some(&body),
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
                "POST",
                &responses_url,
                Some(&body),
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

        let image_base64 = read_image_generation_stream(response)?;
        crate::debug_log::log_provider_request(
            "generate_prompt_image",
            Some(&request.provider),
            Some(model),
            "POST",
            &responses_url,
            Some(&body),
            Some(&json!({ "imageBase64": image_base64 }).to_string()),
            Some(status.as_u16()),
            started_at.elapsed().as_millis(),
            None,
        );
        return Ok(GeneratedImage {
            image_data_url: format!("data:image/png;base64,{image_base64}"),
        });
    }

    let response_text = read_response_text(response, "image generation response")?;
    crate::debug_log::log_provider_request(
        "generate_prompt_image",
        Some(&request.provider),
        Some(model),
        "POST",
        &responses_url,
        Some(&body),
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

    let response_json = parse_responses_api_body(&response_text)
        .map_err(|error| format!("Could not parse image generation response: {error}"))?;
    let image_base64 = extract_image_base64(&response_json)
        .ok_or_else(|| "Image model returned no image output".to_string())?;

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
    let responses_url = build_responses_url(base_url)?;
    let mut body = json!({
        "model": model,
        "input": "Reply with exactly: OK"
    });
    apply_response_runtime_parameters(
        &mut body,
        request.reasoning_enabled,
        request.reasoning_effort.as_deref(),
        request.response_verbosity.as_deref(),
        request.stream_responses,
    );
    let started_at = Instant::now();
    let response = client
        .post(&responses_url)
        .headers(headers)
        .json(&body)
        .send()
        .map_err(|error| {
            let message = format!("Could not test model connection: {error}");
            crate::debug_log::log_provider_request(
                "test_text_model",
                Some(&request.provider),
                Some(model),
                "POST",
                &responses_url,
                Some(&body),
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
        "POST",
        &responses_url,
        Some(&body),
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

    let response_json = parse_responses_api_body(&response_text)
        .map_err(|error| format!("Could not parse model test response: {error}"))?;
    let output = extract_text_output(&response_json)
        .ok_or_else(|| "Model returned an empty response".to_string())?;

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
    let responses_url = build_responses_url(base_url)?;
    let mut body = json!({
        "model": model,
        "input": "Generate a simple image of a small blue square on a white background.",
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
    let started_at = Instant::now();
    let response = client
        .post(&responses_url)
        .headers(headers)
        .json(&body)
        .send()
        .map_err(|error| {
            let message = format!("Could not test image model connection: {error}");
            crate::debug_log::log_provider_request(
                "test_image_model",
                Some(&request.provider),
                Some(model),
                "POST",
                &responses_url,
                Some(&body),
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
        "POST",
        &responses_url,
        Some(&body),
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

    let response_json = parse_responses_api_body(&response_text)
        .map_err(|error| format!("Could not parse image model test response: {error}"))?;
    if !has_image_generation_output(&response_json) {
        return Err("Image model returned no image output".to_string());
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
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read API key: {error}")),
    }
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
) -> Value {
    let mut tool = json!({
        "type": "image_generation",
        "size": map_image_size(aspect_ratio, output_size, model, provider)
    });

    if let Some(quality) = quality {
        tool["quality"] = json!(map_image_quality(quality));
    }

    if provider == "openai" {
        tool["partial_images"] = json!(1);
    }

    tool
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

fn build_responses_url(base_url: &str) -> Result<String, String> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err("Base URL is required".to_string());
    }

    if trimmed.ends_with("/responses") {
        return Ok(trimmed.to_string());
    }

    if let Some(v1_base_url) = trimmed.strip_suffix("/models") {
        if v1_base_url.ends_with("/v1") {
            return Ok(format!("{v1_base_url}/responses"));
        }
    }

    if trimmed.ends_with("/v1") {
        return Ok(format!("{trimmed}/responses"));
    }

    Ok(format!("{trimmed}/v1/responses"))
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

fn read_image_generation_stream(response: Response) -> Result<String, String> {
    let mut reader = BufReader::new(response);
    let mut line = String::new();
    let mut data_lines = Vec::new();
    let mut fallback_image_base64: Option<String> = None;

    loop {
        line.clear();
        let byte_count = reader
            .read_line(&mut line)
            .map_err(|error| format!("Could not read image generation stream: {error}"))?;

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
            ImageStreamEvent::Done | ImageStreamEvent::Continue => {}
        }
    }

    fallback_image_base64
        .ok_or_else(|| "Image generation stream ended without a final image output".to_string())
}

enum ImageStreamEvent {
    Image(String),
    FallbackImage(String),
    Done,
    Continue,
}

fn process_image_stream_event(data_lines: &[String]) -> Result<ImageStreamEvent, String> {
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
            return Err(format!("Could not parse image generation stream event: {error}"));
        }
    };

    let event_type = event.get("type").and_then(Value::as_str).unwrap_or_default();
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
            if let Some(result) = extract_image_base64(response) {
                return Ok(ImageStreamEvent::Image(result));
            }
        }
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
    if let Ok(response_json) = serde_json::from_str::<Value>(response_text) {
        return Ok(response_json);
    }

    let mut output_text = String::new();
    let mut output = Vec::new();

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
        match event.get("type").and_then(Value::as_str) {
            Some("response.output_text.delta") => {
                if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                    output_text.push_str(delta);
                }
            }
            Some("response.completed") => {
                if let Some(response) = event.get("response") {
                    return Ok(response.clone());
                }
            }
            Some(event_type) if event_type.contains("image_generation_call") => {
                if let Some(result) = event.get("result").and_then(Value::as_str) {
                    output.push(json!({
                        "type": "image_generation_call",
                        "result": result
                    }));
                } else if let Some(item) = event.get("item") {
                    output.push(item.clone());
                }
            }
            _ => {}
        }
    }

    Ok(json!({
        "output_text": output_text,
        "output": output
    }))
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

fn has_image_generation_output(response_json: &Value) -> bool {
    if response_json
        .get("output")
        .and_then(Value::as_array)
        .map(|output| {
            output.iter().any(|item| {
                item.get("type").and_then(Value::as_str) == Some("image_generation_call")
                    && item
                        .get("result")
                        .and_then(Value::as_str)
                        .map(|value| !value.trim().is_empty())
                        .unwrap_or(false)
            })
        })
        .unwrap_or(false)
    {
        return true;
    }

    response_json
        .get("data")
        .and_then(Value::as_array)
        .map(|images| {
            images.iter().any(|image| {
                image
                    .get("url")
                    .or_else(|| image.get("b64_json"))
                    .and_then(Value::as_str)
                    .map(|value| !value.trim().is_empty())
                    .unwrap_or(false)
            })
        })
        .unwrap_or(false)
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

fn map_image_quality(quality: &str) -> &'static str {
    match quality {
        "high" => "high",
        "standard" => "medium",
        _ => "low",
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
    provider == "custom" || model.to_lowercase().contains("gpt-image-2")
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
