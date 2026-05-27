import { appendFile, mkdir, readdir, rm, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import {
  buildProviderHeaders,
  getProviderCompatibilityAdapter,
  type ProviderHttpRequest,
  type UnifiedProviderRequest,
} from "./src/providerCompatibility";

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
  imageBackground?: "auto" | "transparent" | "opaque";
  imageModel?: string;
  imageOutputCompression?: number;
  imageOutputFormat?: "png" | "jpeg" | "webp";
  imageQuality?: "auto" | "low" | "medium" | "high";
  kind?: "text" | "image";
  model?: string;
  outputSize?: string;
  provider?: string;
  prompt?: string;
  referenceImages?: Array<{
    id: string;
    role: string;
    imagePath: string;
    name?: string;
  }>;
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
  const unifiedRequest = buildUnifiedProviderRequest(body, {
    model,
    operation: "analyzePromptDirections",
    prompt: requireField(body.prompt, "Workflow analysis prompt"),
    streamResponses: false,
  });
  const providerAdapter = getProviderCompatibilityAdapter(body.provider);
  const providerRequest = providerAdapter.buildRequest(unifiedRequest);
  const { providerResponse, responseText } = await fetchProviderWithDebugLog({
    debugConfig: getDebugLoggingConfig(body),
    operation: "analyze_prompt_directions",
    provider: body.provider,
    model,
    providerRequest,
    fetchOptions: buildProviderFetchOptions(unifiedRequest, providerRequest),
  });

  if (!providerResponse.ok) {
    throw new Error(
      `Prompt analysis failed with HTTP ${providerResponse.status}: ${summarizeProviderError(
        responseText,
      )}`,
    );
  }

  const unifiedResponse = providerAdapter.parseResponse(
    unifiedRequest,
    responseText,
  );
  if (unifiedResponse.kind !== "text") {
    throw new Error("Prompt analysis returned an incompatible response");
  }

  const output = unifiedResponse.text;
  const analysis = parsePromptDirections(output, gridSize);
  sendJson(response, 200, analysis);
}

async function handleGenerateImage(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const body = await readJsonBody(request);
  const model = requireField(body.imageModel, "Image model");
  const unifiedRequest = buildUnifiedProviderRequest(body, {
    image: {
      aspectRatio: body.aspectRatio,
      background: body.imageBackground,
      compression: body.imageOutputCompression,
      format: body.imageOutputFormat,
      model,
      outputSize: body.outputSize,
      projectQuality: body.quality,
      quality: body.imageQuality,
    },
    model,
    operation: "generatePromptImage",
    prompt: body.prompt,
    reasoningEnabled: false,
  });
  const providerAdapter = getProviderCompatibilityAdapter(body.provider);
  const providerRequest = providerAdapter.buildRequest(unifiedRequest);
  const { providerResponse, responseText } = await fetchProviderWithDebugLog({
    debugConfig: getDebugLoggingConfig(body),
    operation: "generate_prompt_image",
    provider: body.provider,
    model,
    providerRequest,
    fetchOptions: buildProviderFetchOptions(unifiedRequest, providerRequest),
  });

  if (!providerResponse.ok) {
    throw new Error(
      `Image generation failed with HTTP ${providerResponse.status}: ${summarizeProviderError(
        responseText,
      )}`,
    );
  }

  const unifiedResponse = providerAdapter.parseResponse(
    unifiedRequest,
    responseText,
  );
  if (unifiedResponse.kind !== "image") {
    throw new Error("Image generation returned an incompatible response");
  }

  sendJson(response, 200, {
    imageDataUrl: `data:image/png;base64,${unifiedResponse.imageBase64}`,
  });
}

async function handleProviderModels(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const body = await readJsonBody(request);
  const unifiedRequest = buildUnifiedProviderRequest(body, {
    operation: "fetchModels",
  });
  const providerAdapter = getProviderCompatibilityAdapter(body.provider);
  const providerRequest = providerAdapter.buildRequest(unifiedRequest);
  const { providerResponse, responseText } = await fetchProviderWithDebugLog({
    debugConfig: getDebugLoggingConfig(body),
    operation: "fetch_provider_models",
    provider: body.provider,
    providerRequest,
    fetchOptions: buildProviderFetchOptions(unifiedRequest, providerRequest),
  });

  if (!providerResponse.ok) {
    throw new Error(
      `Model list request failed with HTTP ${providerResponse.status}: ${summarizeProviderError(
        responseText,
      )}`,
    );
  }

  const unifiedResponse = providerAdapter.parseResponse(
    unifiedRequest,
    responseText,
  );
  if (unifiedResponse.kind !== "models") {
    throw new Error("Model list returned an incompatible response");
  }

  sendJson(response, 200, unifiedResponse.models);
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
  const unifiedRequest = buildUnifiedProviderRequest(body, {
    model,
    operation: "testTextModel",
  });
  const providerAdapter = getProviderCompatibilityAdapter(body.provider);
  const providerRequest = providerAdapter.buildRequest(unifiedRequest);
  const { providerResponse, responseText } = await fetchProviderWithDebugLog({
    debugConfig: getDebugLoggingConfig(body),
    operation: "test_text_model",
    provider: body.provider,
    model,
    providerRequest,
    fetchOptions: buildProviderFetchOptions(unifiedRequest, providerRequest),
  });

  if (!providerResponse.ok) {
    throw new Error(
      `Model connection test failed with HTTP ${providerResponse.status}: ${summarizeProviderError(
        responseText,
      )}`,
    );
  }

  const unifiedResponse = providerAdapter.parseResponse(
    unifiedRequest,
    responseText,
  );
  if (unifiedResponse.kind !== "text") {
    throw new Error("Text model test returned an incompatible response");
  }

  sendJson(response, 200, {
    model,
    output: unifiedResponse.text,
  });
}

async function handleImageModelTest(
  body: DevProviderProxyRequest,
  response: ServerResponse,
) {
  const model = requireField(body.model, "Image model");
  const unifiedRequest = buildUnifiedProviderRequest(body, {
    image: {
      model,
    },
    model,
    operation: "testImageModel",
    streamResponses: false,
  });
  const providerAdapter = getProviderCompatibilityAdapter(body.provider);
  const providerRequest = providerAdapter.buildRequest(unifiedRequest);
  const { providerResponse, responseText } = await fetchProviderWithDebugLog({
    debugConfig: getDebugLoggingConfig(body),
    operation: "test_image_model",
    provider: body.provider,
    model,
    providerRequest,
    fetchOptions: buildProviderFetchOptions(unifiedRequest, providerRequest),
  });

  if (!providerResponse.ok) {
    throw new Error(
      `Image model connection test failed with HTTP ${providerResponse.status}: ${summarizeProviderError(
        responseText,
      )}`,
    );
  }

  const unifiedResponse = providerAdapter.parseResponse(
    unifiedRequest,
    responseText,
  );
  if (unifiedResponse.kind !== "image") {
    throw new Error("Image model test returned an incompatible response");
  }

  sendJson(response, 200, {
    model,
    output: "Image output returned from Responses API",
  });
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

function buildUnifiedProviderRequest(
  request: DevProviderProxyRequest,
  update: Partial<UnifiedProviderRequest>,
): UnifiedProviderRequest {
  return {
    apiKey: requireField(request.apiKey, "API key"),
    baseUrl: request.baseUrl ?? "",
    customHeaders: request.customHeaders,
    provider: request.provider,
    reasoningEnabled: request.reasoningEnabled,
    reasoningEffort: request.reasoningEffort,
    responseVerbosity: request.responseVerbosity,
    streamResponses: request.streamResponses,
    referenceImages: request.referenceImages,
    ...update,
  } as UnifiedProviderRequest;
}

function buildProviderFetchOptions(
  unifiedRequest: UnifiedProviderRequest,
  providerRequest: ProviderHttpRequest,
): RequestInit {
  return {
    method: providerRequest.method,
    headers: buildProviderHeaders(unifiedRequest),
    body:
      providerRequest.body === undefined
        ? undefined
        : JSON.stringify(providerRequest.body),
  };
}

async function fetchProviderWithDebugLog({
  fetchOptions,
  debugConfig,
  model,
  operation,
  provider,
  providerRequest,
}: {
  debugConfig: DebugLoggingConfig;
  fetchOptions: RequestInit;
  model?: string;
  operation: string;
  provider?: string;
  providerRequest: ProviderHttpRequest;
}) {
  const startedAt = Date.now();

  try {
    const providerResponse = await fetch(providerRequest.url, fetchOptions);
    const responseText = await providerResponse.text();
    if (debugConfig.enabled) {
      await appendDebugLogEntry(
        {
          durationMs: Date.now() - startedAt,
          method: providerRequest.method,
          model,
          ok: providerResponse.ok,
          operation,
          provider,
          request: providerRequest.body ?? null,
          response: responseTextToLogValue(responseText),
          status: providerResponse.status,
          timestampMs: Date.now(),
          url: providerRequest.url,
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
          method: providerRequest.method,
          model,
          ok: false,
          operation,
          provider,
          request: providerRequest.body ?? null,
          response: null,
          timestampMs: Date.now(),
          url: providerRequest.url,
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
