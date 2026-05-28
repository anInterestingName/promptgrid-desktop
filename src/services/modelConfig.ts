import { invoke, isTauri } from "@tauri-apps/api/core";
import { configureDebugLogging } from "./debugLogging";
import type {
  ModelCapability,
  ModelOption,
  ProviderId,
  ReasoningEffort,
  ResponseVerbosity,
} from "../types";

const DEV_SECRET_PREFIX = "fangcun.dev.api-key";
const LEGACY_DEV_SECRET_PREFIX = "promptgrid.dev.api-key";

export type ModelFetchRequest = {
  channel: ModelCapability;
  provider: ProviderId;
  baseUrl: string;
  customHeaders?: string;
  debugLoggingEnabled?: boolean;
  debugLogRetentionDays?: number;
};

export type ModelTestRequest = ModelFetchRequest & {
  kind: "text" | "image";
  model: string;
  reasoningEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  responseVerbosity: ResponseVerbosity;
  streamResponses: boolean;
};

export type ModelTestResult = {
  model: string;
  output: string;
};

export async function saveProviderApiKey(
  provider: ProviderId,
  apiKey: string,
): Promise<boolean> {
  if (isTauri()) {
    return invoke<boolean>("save_provider_api_key", {
      provider,
      apiKey,
    });
  }

  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return clearProviderApiKey(provider);
  }

  window.sessionStorage.setItem(getDevSecretKey(provider), trimmedKey);
  window.sessionStorage.removeItem(getLegacyDevSecretKey(provider));
  return true;
}

export async function clearProviderApiKey(
  provider: ProviderId,
): Promise<boolean> {
  if (isTauri()) {
    return invoke<boolean>("clear_provider_api_key", { provider });
  }

  window.sessionStorage.removeItem(getDevSecretKey(provider));
  window.sessionStorage.removeItem(getLegacyDevSecretKey(provider));
  return false;
}

export async function fetchProviderModels(
  request: ModelFetchRequest,
): Promise<ModelOption[]> {
  await ensureDebugLoggingConfigured(request);

  if (isTauri()) {
    return invoke<ModelOption[]>("fetch_provider_models", { request });
  }

  const apiKey = getDevApiKey(request.provider);
  if (!apiKey) {
    throw new Error("API key is not saved for this provider");
  }

  return requestDevProviderProxy<ModelOption[]>("models", {
    ...request,
    apiKey,
  });
}

export async function testProviderConnection(
  request: ModelTestRequest,
): Promise<ModelTestResult> {
  await ensureDebugLoggingConfigured(request);

  if (isTauri()) {
    return invoke<ModelTestResult>("test_provider_connection", { request });
  }

  if (!request.baseUrl.trim()) {
    throw new Error("Base URL is required");
  }

  const apiKey = getDevApiKey(request.provider);
  if (!apiKey) {
    throw new Error("API key is not saved for this provider");
  }

  const model = request.model.trim();
  if (!model) {
    throw new Error(
      request.kind === "image"
        ? "Image model is required"
        : "Text model is required",
    );
  }

  return requestDevProviderProxy<ModelTestResult>("test", {
    ...request,
    apiKey,
    model,
  });
}

export function getProviderSecretKey(provider: ProviderId) {
  return provider;
}

function getDevSecretKey(provider: ProviderId) {
  return `${DEV_SECRET_PREFIX}.${getProviderSecretKey(provider)}`;
}

function getLegacyDevSecretKey(provider: ProviderId) {
  return `${LEGACY_DEV_SECRET_PREFIX}.${getProviderSecretKey(provider)}`;
}

function getDevApiKey(provider: ProviderId) {
  return (
    window.sessionStorage.getItem(getDevSecretKey(provider)) ??
    window.sessionStorage.getItem(getLegacyDevSecretKey(provider))
  );
}

async function ensureDebugLoggingConfigured(request: ModelFetchRequest) {
  await configureDebugLogging({
    enabled: request.debugLoggingEnabled === true,
    retentionDays: request.debugLogRetentionDays ?? 7,
  });
}

async function requestDevProviderProxy<ResponseBody>(
  action: "models" | "test",
  payload: ModelFetchRequest & {
    apiKey: string;
    kind?: "text" | "image";
    model?: string;
    reasoningEnabled?: boolean;
    reasoningEffort?: ReasoningEffort;
    responseVerbosity?: ResponseVerbosity;
    streamResponses?: boolean;
  },
): Promise<ResponseBody> {
  const response = await fetch(`/__fangcun_dev/provider-${action}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();
  const responseBody = responseText ? JSON.parse(responseText) : null;

  if (!response.ok) {
    const message =
      typeof responseBody?.error === "string"
        ? responseBody.error
        : `Provider request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return responseBody as ResponseBody;
}
