import { appendFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST ?? "127.0.0.1";
const debugLogDir = join(process.cwd(), ".promptgrid-debug-logs");
const maxLogStringLength = 12_000;
const debugLogPrefix = "provider-requests";

export default defineConfig({
  plugins: [react(), devProviderProxy()],
  clearScreen: false,
  server: {
    host,
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});

type DevProviderProxyRequest = {
  apiKey?: string;
  aspectRatio?: string;
  baseUrl?: string;
  customHeaders?: string;
  gridSize?: number;
  imageModel?: string;
  kind?: "text" | "image";
  model?: string;
  originalPrompt?: string;
  outputSize?: string;
  provider?: string;
  prompt?: string;
  quality?: string;
  reasoningEnabled?: boolean;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  responseVerbosity?: "low" | "medium" | "high";
  style?: string;
  streamResponses?: boolean;
  textModel?: string;
  debugLoggingEnabled?: boolean;
  debugLogRetentionDays?: number;
};

type ProviderModel = {
  id?: string;
  owned_by?: string;
};

type ProviderModelsResponse = {
  data?: ProviderModel[];
};

function devProviderProxy(): Plugin {
  return {
    name: "promptgrid-dev-provider-proxy",
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (request.method !== "POST") {
          next();
          return;
        }

        try {
          if (request.url === "/__promptgrid_dev/provider-models") {
            await handleProviderModels(request, response);
            return;
          }

          if (request.url === "/__promptgrid_dev/provider-test") {
            await handleProviderTest(request, response);
            return;
          }

          if (request.url === "/__promptgrid_dev/analyze-prompts") {
            await handleAnalyzePrompts(request, response);
            return;
          }

          if (request.url === "/__promptgrid_dev/generate-image") {
            await handleGenerateImage(request, response);
            return;
          }

          next();
        } catch (error) {
          sendJson(response, 502, { error: getErrorMessage(error) });
        }
      });
    },
  };
}

async function handleAnalyzePrompts(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const body = await readJsonBody(request);
  const model = requireField(body.textModel, "Text model");
  const gridSize = Math.max(1, Math.min(25, Number(body.gridSize) || 9));
  const providerRequestBody = withRuntimeParameters(
    {
      model,
      input: buildPromptAnalysisInput(body, gridSize),
    },
    body,
  );
  const requestUrl = buildResponsesUrl(requireField(body.baseUrl, "Base URL"));
  const { providerResponse, responseText } = await fetchProviderWithDebugLog({
    debugConfig: getDebugLoggingConfig(body),
    operation: "analyze_prompt_directions",
    provider: body.provider,
    model,
    method: "POST",
    url: requestUrl,
    requestBody: providerRequestBody,
    fetchOptions: {
      method: "POST",
      headers: buildProviderHeaders(body),
      body: JSON.stringify(providerRequestBody),
    },
  });

  if (!providerResponse.ok) {
    throw new Error(
      `Prompt analysis failed with HTTP ${providerResponse.status}: ${summarizeProviderError(
        responseText,
      )}`,
    );
  }

  const output = extractTextOutput(parseResponsesBody(responseText));
  const analysis = parsePromptDirections(output, gridSize);
  sendJson(response, 200, analysis);
}

async function handleGenerateImage(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const body = await readJsonBody(request);
  const model = requireField(body.imageModel, "Image model");
  const providerRequestBody = withRuntimeParameters(
    {
      model,
      input: requireField(body.prompt, "Image prompt"),
      tools: [
        buildImageGenerationTool(body),
      ],
      tool_choice: {
        type: "image_generation",
      },
    },
    {
      ...body,
      reasoningEnabled: false,
      streamResponses: true,
    },
  );
  const requestUrl = buildResponsesUrl(requireField(body.baseUrl, "Base URL"));
  const { providerResponse, responseText } = await fetchProviderWithDebugLog({
    debugConfig: getDebugLoggingConfig(body),
    operation: "generate_prompt_image",
    provider: body.provider,
    model,
    method: "POST",
    url: requestUrl,
    requestBody: providerRequestBody,
    fetchOptions: {
      method: "POST",
      headers: buildProviderHeaders(body),
      body: JSON.stringify(providerRequestBody),
    },
  });

  if (!providerResponse.ok) {
    throw new Error(
      `Image generation failed with HTTP ${providerResponse.status}: ${summarizeProviderError(
        responseText,
      )}`,
    );
  }

  const imageBase64 = extractImageBase64(parseResponsesBody(responseText));
  if (!imageBase64) {
    throw new Error("Image model returned no image output");
  }

  sendJson(response, 200, {
    imageDataUrl: `data:image/png;base64,${imageBase64}`,
  });
}

function buildImageGenerationTool(request: DevProviderProxyRequest) {
  const tool: Record<string, unknown> = {
    type: "image_generation",
    quality: mapImageQuality(request.quality),
    size: mapImageSize(
      request.aspectRatio,
      request.outputSize,
      request.imageModel,
      request.provider,
    ),
  };

  if (request.provider === "openai") {
    tool.partial_images = 1;
  }

  return tool;
}

async function handleProviderModels(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const body = await readJsonBody(request);
  const requestUrl = buildModelsUrl(requireField(body.baseUrl, "Base URL"));
  const { providerResponse, responseText } = await fetchProviderWithDebugLog({
    debugConfig: getDebugLoggingConfig(body),
    operation: "fetch_provider_models",
    provider: body.provider,
    method: "GET",
    url: requestUrl,
    fetchOptions: {
      headers: buildProviderHeaders(body),
    },
  });

  if (!providerResponse.ok) {
    throw new Error(
      `Model list request failed with HTTP ${providerResponse.status}: ${summarizeProviderError(
        responseText,
      )}`,
    );
  }

  const modelList = JSON.parse(responseText) as ProviderModelsResponse;
  const models = (modelList.data ?? [])
    .filter((model): model is Required<Pick<ProviderModel, "id">> & ProviderModel =>
      Boolean(model.id),
    )
    .map((model) => ({
      id: model.id,
      ownedBy: model.owned_by,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
    .filter(
      (model, index, allModels) =>
        index === 0 || model.id !== allModels[index - 1]?.id,
    );

  sendJson(response, 200, models);
}

async function handleProviderTest(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const body = await readJsonBody(request);
  if (body.kind === "image") {
    await handleImageModelTest(body, response);
    return;
  }

  await handleTextModelTest(body, response);
}

async function handleTextModelTest(
  body: DevProviderProxyRequest,
  response: ServerResponse,
) {
  const model = requireField(body.model, "Text model");
  const providerRequestBody = withRuntimeParameters(
    {
      model,
      input: "Reply with exactly: OK",
    },
    body,
  );
  const requestUrl = buildResponsesUrl(requireField(body.baseUrl, "Base URL"));
  const { providerResponse, responseText } = await fetchProviderWithDebugLog({
    debugConfig: getDebugLoggingConfig(body),
    operation: "test_text_model",
    provider: body.provider,
    model,
    method: "POST",
    url: requestUrl,
    requestBody: providerRequestBody,
    fetchOptions: {
      method: "POST",
      headers: buildProviderHeaders(body),
      body: JSON.stringify(providerRequestBody),
    },
  });

  if (!providerResponse.ok) {
    throw new Error(
      `Model connection test failed with HTTP ${providerResponse.status}: ${summarizeProviderError(
        responseText,
      )}`,
    );
  }

  const responseJson = parseResponsesBody(responseText);
  const output = extractTextOutput(responseJson);
  if (!output) {
    throw new Error("Model returned an empty response");
  }

  sendJson(response, 200, {
    model,
    output,
  });
}

async function handleImageModelTest(
  body: DevProviderProxyRequest,
  response: ServerResponse,
) {
  const model = requireField(body.model, "Image model");
  const providerRequestBody = withRuntimeParameters(
    {
      model,
      input:
        "Generate a simple image of a small blue square on a white background.",
      tools: [
        {
          type: "image_generation",
        },
      ],
      tool_choice: {
        type: "image_generation",
      },
    },
    { ...body, streamResponses: false },
  );
  const requestUrl = buildResponsesUrl(requireField(body.baseUrl, "Base URL"));
  const { providerResponse, responseText } = await fetchProviderWithDebugLog({
    debugConfig: getDebugLoggingConfig(body),
    operation: "test_image_model",
    provider: body.provider,
    model,
    method: "POST",
    url: requestUrl,
    requestBody: providerRequestBody,
    fetchOptions: {
      method: "POST",
      headers: buildProviderHeaders(body),
      body: JSON.stringify(providerRequestBody),
    },
  });

  if (!providerResponse.ok) {
    throw new Error(
      `Image model connection test failed with HTTP ${providerResponse.status}: ${summarizeProviderError(
        responseText,
      )}`,
    );
  }

  const responseJson = parseResponsesBody(responseText);
  if (!hasImageGenerationOutput(responseJson)) {
    throw new Error("Image model returned no image output");
  }

  sendJson(response, 200, {
    model,
    output: "Image output returned from Responses API",
  });
}

function withRuntimeParameters(
  payload: Record<string, unknown>,
  request: DevProviderProxyRequest,
) {
  if (request.reasoningEnabled) {
    payload.reasoning = {
      effort: request.reasoningEffort || "medium",
    };
  }

  if (request.responseVerbosity && request.responseVerbosity !== "medium") {
    payload.text = {
      verbosity: request.responseVerbosity,
    };
  }

  if (request.streamResponses) {
    payload.stream = true;
  }

  return payload;
}

function buildPromptAnalysisInput(
  request: DevProviderProxyRequest,
  gridSize: number,
) {
  return [
    "You create image-generation prompt directions for a visual exploration grid.",
    `Return exactly ${gridSize} distinct directions and one short chat title as strict JSON with this shape:`,
    `{"conversationTitle":"short title for this exploration","directions":[{"title":"concise direction title","prompt":"full image generation prompt"}]}`,
    "Do not include markdown, commentary, numbering, or extra keys.",
    "The conversationTitle should summarize the original idea in 3 to 8 words and use the same language as the original idea.",
    "Each title should be 2 to 6 words, concrete, and in the same language as the original idea.",
    `Original idea: ${requireField(request.originalPrompt, "Original prompt")}`,
    `Visual style: ${request.style || "Editorial product study"}`,
    `Aspect ratio: ${request.aspectRatio || "1:1"}`,
    `Render quality target: ${request.quality || "draft"}`,
    `Output size target: ${request.outputSize || "standard"}`,
    "Each prompt should be specific, production-ready, and visually different from the others.",
  ].join("\n");
}

function parsePromptDirections(output: string, gridSize: number) {
  const parsed = parseJsonFromText(output) as {
    conversationTitle?: unknown;
    directions?: Array<{ prompt?: unknown; title?: unknown }>;
  };
  const directions = Array.isArray(parsed.directions) ? parsed.directions : [];
  const promptDirections = directions
    .map((direction, index) => {
      const prompt =
        typeof direction.prompt === "string" ? direction.prompt.trim() : "";
      const title =
        typeof direction.title === "string" ? direction.title.trim() : "";

      return {
        prompt,
        title: title || `Direction ${index + 1}`,
      };
    })
    .filter((direction) => Boolean(direction.prompt))
    .slice(0, gridSize);

  if (promptDirections.length === 0) {
    throw new Error("Prompt analysis returned no directions");
  }

  const conversationTitle =
    typeof parsed.conversationTitle === "string"
      ? parsed.conversationTitle.trim()
      : "";

  return {
    conversationTitle: conversationTitle || promptDirections[0]?.title || "Untitled Chat",
    directions: promptDirections,
  };
}

function parseJsonFromText(output: string) {
  const trimmedOutput = output.trim();
  try {
    return JSON.parse(trimmedOutput);
  } catch {
    const firstObject = trimmedOutput.indexOf("{");
    const lastObject = trimmedOutput.lastIndexOf("}");
    if (firstObject >= 0 && lastObject > firstObject) {
      return JSON.parse(trimmedOutput.slice(firstObject, lastObject + 1));
    }

    const firstArray = trimmedOutput.indexOf("[");
    const lastArray = trimmedOutput.lastIndexOf("]");
    if (firstArray >= 0 && lastArray > firstArray) {
      return { directions: JSON.parse(trimmedOutput.slice(firstArray, lastArray + 1)) };
    }
  }

  throw new Error("Prompt analysis did not return valid JSON");
}

function mapImageQuality(quality?: string) {
  if (quality === "high") {
    return "high";
  }

  if (quality === "standard") {
    return "medium";
  }

  return "low";
}

function mapImageSize(
  aspectRatio?: string,
  outputSize?: string,
  model?: string,
  provider?: string,
) {
  if (!supportsFlexibleImageSize(model, provider)) {
    return mapLegacyImageSize(aspectRatio);
  }

  if (outputSize === "4k") {
    if (aspectRatio === "9:16") {
      return "2160x3840";
    }

    if (aspectRatio === "4:3") {
      return "3264x2448";
    }

    if (aspectRatio === "1:1") {
      return "2880x2880";
    }

    return "3840x2160";
  }

  if (outputSize === "2k") {
    if (aspectRatio === "9:16") {
      return "1152x2048";
    }

    if (aspectRatio === "4:3") {
      return "2048x1536";
    }

    if (aspectRatio === "1:1") {
      return "2048x2048";
    }

    return "2048x1152";
  }

  if (outputSize === "large") {
    if (aspectRatio === "9:16") {
      return "1088x1920";
    }

    if (aspectRatio === "4:3") {
      return "1440x1088";
    }

    if (aspectRatio === "1:1") {
      return "1536x1536";
    }

    return "1920x1088";
  }

  return mapLegacyImageSize(aspectRatio);
}

function mapLegacyImageSize(aspectRatio?: string) {
  if (aspectRatio === "16:9" || aspectRatio === "4:3") {
    return "1536x1024";
  }

  if (aspectRatio === "9:16") {
    return "1024x1536";
  }

  return "1024x1024";
}

function supportsFlexibleImageSize(model?: string, provider?: string) {
  return provider === "custom" || model?.toLowerCase().includes("gpt-image-2");
}

function buildProviderHeaders(request: DevProviderProxyRequest) {
  const headers = new Headers({
    authorization: `Bearer ${requireField(request.apiKey, "API key")}`,
    "content-type": "application/json",
  });

  for (const [name, value] of Object.entries(
    parseCustomHeaders(request.customHeaders),
  )) {
    headers.set(name, value);
  }

  return headers;
}

async function fetchProviderWithDebugLog({
  fetchOptions,
  debugConfig,
  method,
  model,
  operation,
  provider,
  requestBody,
  url,
}: {
  debugConfig: DebugLoggingConfig;
  fetchOptions: RequestInit;
  method: string;
  model?: string;
  operation: string;
  provider?: string;
  requestBody?: unknown;
  url: string;
}) {
  const startedAt = Date.now();

  try {
    const providerResponse = await fetch(url, fetchOptions);
    const responseText = await providerResponse.text();
    if (debugConfig.enabled) {
      await appendDebugLogEntry(
        {
          durationMs: Date.now() - startedAt,
          method,
          model,
          ok: providerResponse.ok,
          operation,
          provider,
          request: requestBody ?? null,
          response: responseTextToLogValue(responseText),
          status: providerResponse.status,
          timestampMs: Date.now(),
          url,
        },
        debugConfig.retentionDays,
      );
    }

    return { providerResponse, responseText };
  } catch (error) {
    if (debugConfig.enabled) {
      await appendDebugLogEntry(
        {
          durationMs: Date.now() - startedAt,
          error: getErrorMessage(error),
          method,
          model,
          ok: false,
          operation,
          provider,
          request: requestBody ?? null,
          response: null,
          timestampMs: Date.now(),
          url,
        },
        debugConfig.retentionDays,
      );
    }
    throw error;
  }
}

type DebugLoggingConfig = {
  enabled: boolean;
  retentionDays: number;
};

async function appendDebugLogEntry(
  entry: Record<string, unknown>,
  retentionDays: number,
) {
  try {
    await mkdir(debugLogDir, { recursive: true });
    await cleanupDevDebugLogs(retentionDays);
    await appendFile(
      join(debugLogDir, `${debugLogPrefix}-${getDateStamp()}.jsonl`),
      `${JSON.stringify(sanitizeLogValue(entry))}\n`,
      "utf8",
    );
  } catch (error) {
    console.warn(`Could not write debug request log: ${getErrorMessage(error)}`);
  }
}

function getDebugLoggingConfig(requestBody: unknown) {
  if (!requestBody || typeof requestBody !== "object") {
    return { enabled: false, retentionDays: 7 };
  }

  const config = requestBody as {
    debugLogRetentionDays?: unknown;
    debugLoggingEnabled?: unknown;
  };
  const retentionDays =
    typeof config.debugLogRetentionDays === "number"
      ? Math.round(config.debugLogRetentionDays)
      : 7;

  return {
    enabled: config.debugLoggingEnabled === true,
    retentionDays: Math.min(365, Math.max(1, retentionDays || 7)),
  };
}

async function cleanupDevDebugLogs(retentionDays: number) {
  const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  try {
    const entries = await readdir(debugLogDir);
    await Promise.all(
      entries
        .filter(
          (entry) =>
            entry.startsWith(`${debugLogPrefix}-`) && entry.endsWith(".jsonl"),
        )
        .map(async (entry) => {
          const path = join(debugLogDir, entry);
          const metadata = await stat(path);
          if (now - metadata.mtimeMs > maxAgeMs) {
            await rm(path, { force: true });
          }
        }),
    );
  } catch {
    // Missing debug log folders are fine during normal development.
  }
}

function getDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function responseTextToLogValue(responseText: string) {
  try {
    return sanitizeLogValue(JSON.parse(responseText) as unknown);
  } catch {
    return truncateLogString(responseText);
  }
}

function sanitizeLogValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeLogValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        isSensitiveLogKey(key) ? "[redacted]" : sanitizeLogValue(nestedValue),
      ]),
    );
  }

  if (typeof value === "string") {
    return truncateLogString(value);
  }

  return value;
}

function isSensitiveLogKey(key: string) {
  const normalizedKey = key.toLowerCase();
  return (
    normalizedKey.includes("authorization") ||
    normalizedKey.includes("apikey") ||
    normalizedKey.includes("api_key") ||
    normalizedKey.includes("token") ||
    normalizedKey.includes("secret") ||
    normalizedKey === "key"
  );
}

function truncateLogString(value: string) {
  if (value.length <= maxLogStringLength) {
    return value;
  }

  return `${value.slice(0, maxLogStringLength)}\n[truncated ${
    value.length - maxLogStringLength
  } chars]`;
}

function parseCustomHeaders(rawHeaders?: string) {
  const trimmedHeaders = rawHeaders?.trim();
  if (!trimmedHeaders) {
    return {};
  }

  const parsedHeaders = JSON.parse(trimmedHeaders) as unknown;
  if (
    !parsedHeaders ||
    typeof parsedHeaders !== "object" ||
    Array.isArray(parsedHeaders)
  ) {
    throw new Error("Extra headers must be a JSON object");
  }

  return Object.fromEntries(
    Object.entries(parsedHeaders).map(([name, value]) => {
      if (typeof value !== "string") {
        throw new Error(`Header \`${name}\` must be a string`);
      }

      return [name, value];
    }),
  );
}

function buildModelsUrl(baseUrl: string) {
  const trimmedUrl = baseUrl.trim().replace(/\/+$/, "");
  if (trimmedUrl.endsWith("/models")) {
    return trimmedUrl;
  }

  if (trimmedUrl.endsWith("/v1")) {
    return `${trimmedUrl}/models`;
  }

  return `${trimmedUrl}/v1/models`;
}

function buildResponsesUrl(baseUrl: string) {
  const trimmedUrl = baseUrl.trim().replace(/\/+$/, "");
  if (trimmedUrl.endsWith("/responses")) {
    return trimmedUrl;
  }

  if (trimmedUrl.endsWith("/v1/models")) {
    return `${trimmedUrl.slice(0, -"/models".length)}/responses`;
  }

  if (trimmedUrl.endsWith("/v1")) {
    return `${trimmedUrl}/responses`;
  }

  return `${trimmedUrl}/v1/responses`;
}

function extractTextOutput(responseJson: unknown) {
  if (!responseJson || typeof responseJson !== "object") {
    return "";
  }

  const outputText = (responseJson as { output_text?: unknown }).output_text;
  if (typeof outputText === "string" && outputText.trim()) {
    return outputText.trim();
  }

  const output = (responseJson as { output?: unknown }).output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (
        !item ||
        typeof item !== "object" ||
        (item as { type?: unknown }).type !== "message"
      ) {
        continue;
      }

      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) {
        continue;
      }

      const text = content
        .map((contentItem) => {
          if (!contentItem || typeof contentItem !== "object") {
            return "";
          }

          const value = (contentItem as { text?: unknown }).text;
          return typeof value === "string" ? value.trim() : "";
        })
        .filter(Boolean)
        .join("\n");

      if (text) {
        return text;
      }
    }
  }

  return extractChatCompletionOutput(responseJson);
}

function parseResponsesBody(responseText: string) {
  try {
    return JSON.parse(responseText) as unknown;
  } catch {
    const streamResponse = parseResponsesStream(responseText);
    if (streamResponse) {
      return streamResponse;
    }

    throw new Error("Could not parse provider response");
  }
}

function parseResponsesStream(responseText: string) {
  let outputText = "";
  const output: unknown[] = [];

  for (const data of readResponseStreamEvents(responseText)) {
    const trimmedData = data.trim();
    if (!trimmedData || trimmedData === "[DONE]") {
      continue;
    }

    let event: {
      delta?: unknown;
      item?: unknown;
      response?: unknown;
      result?: unknown;
      type?: unknown;
    };
    try {
      event = JSON.parse(trimmedData);
    } catch {
      continue;
    }

    if (event.type === "response.output_text.delta") {
      outputText += typeof event.delta === "string" ? event.delta : "";
      continue;
    }

    if (event.type === "response.completed" && event.response) {
      return event.response;
    }

    if (
      typeof event.type === "string" &&
      (event.type.includes("image_generation_call") ||
        event.type === "response.output_item.done")
    ) {
      if (typeof event.result === "string") {
        output.push({
          type: "image_generation_call",
          result: event.result,
        });
      } else if (hasEventItemResult(event.item)) {
        output.push({
          type: "image_generation_call",
          result: event.item.result,
        });
      } else if (
        event.type !== "response.image_generation_call.partial_image" &&
        event.item
      ) {
        output.push(event.item);
      }
    }
  }

  return {
    output_text: outputText,
    output,
  };
}

function readResponseStreamEvents(responseText: string) {
  const events: string[] = [];
  let eventDataLines: string[] = [];

  for (const line of responseText.split(/\r?\n/)) {
    const trimmedLine = line.trimEnd();
    if (!trimmedLine) {
      if (eventDataLines.length > 0) {
        events.push(eventDataLines.join("\n"));
        eventDataLines = [];
      }
      continue;
    }

    const trimmedStart = trimmedLine.trimStart();
    if (trimmedStart.startsWith("data:")) {
      eventDataLines.push(trimmedStart.slice("data:".length).trimStart());
    }
  }

  if (eventDataLines.length > 0) {
    events.push(eventDataLines.join("\n"));
  }

  return events;
}

function hasEventItemResult(item: unknown): item is { result: string } {
  return (
    Boolean(item) &&
    typeof item === "object" &&
    typeof (item as { result?: unknown }).result === "string" &&
    Boolean((item as { result: string }).result.trim())
  );
}

function extractChatCompletionOutput(responseJson: unknown) {
  if (!responseJson || typeof responseJson !== "object") {
    return "";
  }

  const choices = (responseJson as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) {
    return "";
  }

  for (const choice of choices) {
    const content =
      (choice as { message?: { content?: unknown }; text?: unknown }).message
        ?.content ?? (choice as { text?: unknown }).text;
    const output = extractTextContent(content);
    if (output) {
      return output;
    }
  }

  return "";
}

function extractTextContent(content: unknown) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .map((item) => {
      if (!item || typeof item !== "object") {
        return "";
      }

      const value =
        (item as { text?: unknown }).text ??
        (item as { content?: unknown }).content;
      return typeof value === "string" ? value.trim() : "";
    })
    .filter(Boolean)
    .join("\n");
}

function hasImageGenerationOutput(responseJson: unknown) {
  if (!responseJson || typeof responseJson !== "object") {
    return false;
  }

  const output = (responseJson as { output?: unknown }).output;
  if (Array.isArray(output)) {
    const hasResponsesImage = output.some((item) => {
      if (!item || typeof item !== "object") {
        return false;
      }

      if ((item as { type?: unknown }).type !== "image_generation_call") {
        return false;
      }

      const result = (item as { result?: unknown }).result;
      return typeof result === "string" && result.trim().length > 0;
    });

    if (hasResponsesImage) {
      return true;
    }
  }

  const data = (responseJson as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    return false;
  }

  return data.some((image) => {
    if (!image || typeof image !== "object") {
      return false;
    }

    const value =
      (image as { url?: unknown }).url ??
      (image as { b64_json?: unknown }).b64_json;
    return typeof value === "string" && value.trim().length > 0;
  });
}

function extractImageBase64(responseJson: unknown) {
  if (!responseJson || typeof responseJson !== "object") {
    return "";
  }

  const output = (responseJson as { output?: unknown }).output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (
        item &&
        typeof item === "object" &&
        (item as { type?: unknown }).type === "image_generation_call"
      ) {
        const result = (item as { result?: unknown }).result;
        if (typeof result === "string" && result.trim()) {
          return result.trim();
        }
      }
    }
  }

  const data = (responseJson as { data?: unknown }).data;
  if (Array.isArray(data)) {
    for (const image of data) {
      if (!image || typeof image !== "object") {
        continue;
      }

      const result =
        (image as { b64_json?: unknown }).b64_json ??
        (image as { url?: unknown }).url;
      if (typeof result === "string" && result.trim()) {
        return result.trim();
      }
    }
  }

  return "";
}

async function readJsonBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let byteLength = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteLength += buffer.byteLength;
    if (byteLength > 128 * 1024) {
      throw new Error("Request body is too large");
    }
    chunks.push(buffer);
  }

  return JSON.parse(
    Buffer.concat(chunks).toString("utf8"),
  ) as DevProviderProxyRequest;
}

function requireField(value: string | undefined, label: string) {
  const trimmedValue = value?.trim();
  if (!trimmedValue) {
    throw new Error(`${label} is required`);
  }

  return trimmedValue;
}

function summarizeProviderError(responseText: string) {
  try {
    const responseJson = JSON.parse(responseText) as {
      error?: { message?: unknown };
    };
    if (typeof responseJson.error?.message === "string") {
      return responseJson.error.message;
    }
  } catch {
    // Fall back to the provider response body below.
  }

  const trimmedText = responseText.trim();
  return trimmedText ? trimmedText.slice(0, 240) : "empty response body";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
) {
  response.statusCode = statusCode;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}
