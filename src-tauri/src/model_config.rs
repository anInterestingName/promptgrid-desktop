use keyring::{Entry, Error as KeyringError};
use reqwest::blocking::Client;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;

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
) -> Result<Vec<PromptDirection>, String> {
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

    let response = client
        .post(build_responses_url(&request.base_url)?)
        .headers(headers)
        .json(&body)
        .send()
        .map_err(|error| format!("Could not analyze prompt directions: {error}"))?;
    let status = response.status();
    let response_text = response
        .text()
        .map_err(|error| format!("Could not read prompt analysis response: {error}"))?;

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

    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("Could not create HTTP client: {error}"))?;
    let mut body = json!({
        "model": model,
        "input": prompt,
        "tools": [
            {
                "type": "image_generation",
                "quality": map_image_quality(&request.quality),
                "size": map_image_size(
                    &request.aspect_ratio,
                    &request.output_size,
                    model,
                    &request.provider
                )
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
        request.stream_responses,
    );

    let response = client
        .post(build_responses_url(&request.base_url)?)
        .headers(headers)
        .json(&body)
        .send()
        .map_err(|error| format!("Could not generate image: {error}"))?;
    let status = response.status();
    let response_text = response
        .text()
        .map_err(|error| format!("Could not read image generation response: {error}"))?;

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
    let response = client
        .post(responses_url)
        .headers(headers)
        .json(&body)
        .send()
        .map_err(|error| format!("Could not test model connection: {error}"))?;
    let status = response.status();
    let response_text = response
        .text()
        .map_err(|error| format!("Could not read model test response: {error}"))?;

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
        request.stream_responses,
    );
    let response = client
        .post(responses_url)
        .headers(headers)
        .json(&body)
        .send()
        .map_err(|error| format!("Could not test image model connection: {error}"))?;
    let status = response.status();
    let response_text = response
        .text()
        .map_err(|error| format!("Could not read image model test response: {error}"))?;

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
        format!("Return exactly {grid_size} distinct directions as strict JSON with this shape:"),
        "{\"directions\":[{\"title\":\"concise direction title\",\"prompt\":\"full image generation prompt\"}]}".to_string(),
        "Do not include markdown, commentary, numbering, or extra keys.".to_string(),
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

fn parse_prompt_directions(output: &str, grid_size: usize) -> Result<Vec<PromptDirection>, String> {
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

    Ok(prompts)
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
