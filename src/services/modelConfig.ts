import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  ApiProvider,
  ModelOption,
  ReasoningEffort,
  ResponseVerbosity,
} from "../types";

const DEV_SECRET_PREFIX = "promptgrid.dev.api-key";

export type ModelFetchRequest = {
  provider: ApiProvider;
  baseUrl: string;
  customHeaders?: string;
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
  provider: ApiProvider,
  apiKey: string,
): Promise<boolean> {
  if (isTauri()) {
    return invoke<boolean>("save_provider_api_key", { provider, apiKey });
  }

  const trimmedKey = apiKey.trim();
  if (!trimmedKey) {
    return clearProviderApiKey(provider);
  }

  window.sessionStorage.setItem(getDevSecretKey(provider), trimmedKey);
  return true;
}

export async function clearProviderApiKey(
  provider: ApiProvider,
): Promise<boolean> {
  if (isTauri()) {
    return invoke<boolean>("clear_provider_api_key", { provider });
  }

  window.sessionStorage.removeItem(getDevSecretKey(provider));
  return false;
}

export async function fetchProviderModels(
  request: ModelFetchRequest,
): Promise<ModelOption[]> {
  if (isTauri()) {
    return invoke<ModelOption[]>("fetch_provider_models", { request });
  }

  const apiKey = window.sessionStorage.getItem(getDevSecretKey(request.provider));
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
  if (isTauri()) {
    return invoke<ModelTestResult>("test_provider_connection", { request });
  }

  if (!request.baseUrl.trim()) {
    throw new Error("Base URL is required");
  }

  const apiKey = window.sessionStorage.getItem(getDevSecretKey(request.provider));
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

function getDevSecretKey(provider: ApiProvider) {
  return `${DEV_SECRET_PREFIX}.${provider}`;
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
  const response = await fetch(`/__promptgrid_dev/provider-${action}`, {
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
