import type { MessageKey } from "../../i18n";
import type { ModelCapability, ProviderId } from "../../types";

export type ProviderAdapter = {
  id: ProviderId;
  labelKey: MessageKey;
  capabilities: ModelCapability[];
  defaultBaseUrl: string;
  configurableBaseUrl: boolean;
  wireApi: "codex_responses";
  responseReader: "codex_responses";
  supportsReasoning: boolean;
  supportsImageGenerationTool: boolean;
  supportsCustomHeaders: boolean;
  supportsModelList: boolean;
};

export const providerAdapters: Record<ProviderId, ProviderAdapter> = {
  openai: {
    id: "openai",
    labelKey: "providerOpenAI",
    capabilities: ["text", "image"],
    defaultBaseUrl: "https://api.openai.com/v1",
    configurableBaseUrl: true,
    wireApi: "codex_responses",
    responseReader: "codex_responses",
    supportsReasoning: true,
    supportsImageGenerationTool: true,
    supportsCustomHeaders: false,
    supportsModelList: true,
  },
  deepseek: {
    id: "deepseek",
    labelKey: "providerDeepSeek",
    capabilities: ["text"],
    defaultBaseUrl: "https://api.deepseek.com",
    configurableBaseUrl: true,
    wireApi: "codex_responses",
    responseReader: "codex_responses",
    supportsReasoning: true,
    supportsImageGenerationTool: false,
    supportsCustomHeaders: false,
    supportsModelList: true,
  },
  "openai-compatible": {
    id: "openai-compatible",
    labelKey: "providerOpenAICompatible",
    capabilities: ["text", "image"],
    defaultBaseUrl: "",
    configurableBaseUrl: true,
    wireApi: "codex_responses",
    responseReader: "codex_responses",
    supportsReasoning: true,
    supportsImageGenerationTool: true,
    supportsCustomHeaders: true,
    supportsModelList: true,
  },
};

export const providerAdapterList = Object.values(providerAdapters);
export const visibleProviderAdapterList = providerAdapterList.filter(
  (adapter) => adapter.id !== "deepseek",
);

export function getProviderAdapter(providerId: ProviderId) {
  return providerAdapters[providerId];
}

export function providerSupportsCapability(
  providerId: ProviderId,
  capability: ModelCapability,
) {
  return providerAdapters[providerId].capabilities.includes(capability);
}
