import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ApiProvider, ModelOption } from "../types";

const DEV_SECRET_PREFIX = "promptgrid.dev.api-key";

export type ModelFetchRequest = {
  provider: ApiProvider;
  baseUrl: string;
  customHeaders?: string;
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

  if (!window.sessionStorage.getItem(getDevSecretKey(request.provider))) {
    throw new Error("API key is not saved for this provider");
  }

  return request.provider === "openai"
    ? [
        { id: "gpt-4o-mini", ownedBy: "openai" },
        { id: "gpt-4.1-mini", ownedBy: "openai" },
        { id: "gpt-image-1", ownedBy: "openai" },
      ]
    : [
        { id: "custom-text-model", ownedBy: "custom" },
        { id: "custom-image-model", ownedBy: "custom" },
      ];
}

function getDevSecretKey(provider: ApiProvider) {
  return `${DEV_SECRET_PREFIX}.${provider}`;
}
