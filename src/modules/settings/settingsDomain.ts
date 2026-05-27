import { mockSettings } from "../../data/mockProject";
import type {
  ActiveModelSelection,
  AppSettings,
  GridSize,
  ImageModelSettings,
  ModelCapability,
  ProviderConfig,
  ProviderId,
  ResponseVerbosity,
  TextModelSettings,
} from "../../types";
import { normalizeWorkflowConfigs } from "../workflows/workflowConfig";
import { providerAdapters, providerSupportsCapability } from "./providerAdapters";

const validGridSizes = [6, 9, 16, 25] as const satisfies readonly GridSize[];
const providerIds = Object.keys(providerAdapters) as ProviderId[];

type LegacyModelRoute = {
  providerId?: ProviderId | "custom";
  model?: string;
};

type LegacySettings = Partial<AppSettings> & {
  apiProvider?: "openai" | "custom";
  textModel?: string;
  imageModel?: string;
  openAiBaseUrl?: string;
  openAiApiKeySaved?: boolean;
  customProviderName?: string;
  customBaseUrl?: string;
  customApiKeySaved?: boolean;
  customTextModel?: string;
  customImageModel?: string;
  customHeaders?: string;
  reasoningEnabled?: boolean;
  reasoningEffort?: TextModelSettings["reasoningEffort"];
  responseVerbosity?: ResponseVerbosity;
  streamResponses?: boolean;
  modelRouting?: Partial<Record<ModelCapability, LegacyModelRoute>>;
  textRuntime?: Partial<TextModelSettings>;
  imageRuntime?: Partial<TextModelSettings>;
};

type ConfiguredProvider<Kind extends ModelCapability> = ProviderConfig & {
  providerId: ProviderId;
  model: string;
  modelConfig: Kind extends "text" ? TextModelSettings : ImageModelSettings;
};

export function normalizeSettings(settings: Partial<AppSettings>): AppSettings {
  const legacySettings = settings as LegacySettings;
  const providers = normalizeProviderConfigs(legacySettings);

  return {
    ...mockSettings,
    ...settings,
    providers,
    activeModelSelection: normalizeActiveModelSelection(
      legacySettings,
      providers,
    ),
    workflowConfigs: normalizeWorkflowConfigs(settings.workflowConfigs),
    showWorkflowConfigEditor: settings.showWorkflowConfigEditor ?? true,
    defaultGridSize: normalizeGridSize(settings.defaultGridSize),
    debugLogRetentionDays: clampDebugLogRetentionDays(
      settings.debugLogRetentionDays,
    ),
  };
}

function normalizeGridSize(value: unknown): GridSize {
  return validGridSizes.includes(value as GridSize)
    ? (value as GridSize)
    : mockSettings.defaultGridSize;
}

export function clampDebugLogRetentionDays(value: unknown) {
  const days =
    typeof value === "number" ? value : mockSettings.debugLogRetentionDays;
  return Math.min(
    365,
    Math.max(1, Math.round(days || mockSettings.debugLogRetentionDays)),
  );
}

function normalizeProviderConfigs(settings: LegacySettings) {
  return providerIds.reduce(
    (providers, providerId) => ({
      ...providers,
      [providerId]: normalizeProviderConfig(providerId, settings),
    }),
    {} as AppSettings["providers"],
  );
}

function normalizeProviderConfig(
  providerId: ProviderId,
  settings: LegacySettings,
): ProviderConfig {
  const adapter = providerAdapters[providerId];
  const existingProvider = settings.providers?.[providerId];
  const legacyOpenAiBaseUrl =
    typeof settings.openAiBaseUrl === "string" ? settings.openAiBaseUrl : "";
  const legacyCompatibleBaseUrl =
    typeof settings.customBaseUrl === "string" ? settings.customBaseUrl : "";
  const legacyCustomHeaders =
    typeof settings.customHeaders === "string" ? settings.customHeaders : "";
  const baseUrl =
    existingProvider?.baseUrl ??
    (providerId === "openai"
      ? legacyOpenAiBaseUrl || adapter.defaultBaseUrl
      : providerId === "openai-compatible"
        ? legacyCompatibleBaseUrl || adapter.defaultBaseUrl
        : adapter.defaultBaseUrl);
  const apiKeySaved =
    existingProvider?.apiKeySaved ??
    (providerId === "openai"
      ? settings.openAiApiKeySaved === true
      : providerId === "openai-compatible"
        ? settings.customApiKeySaved === true
        : false);
  const enabled =
    existingProvider?.enabled ??
    (apiKeySaved ||
      (providerId === "openai" && settings.apiProvider !== "custom") ||
      (providerId === "openai-compatible" &&
        (settings.apiProvider === "custom" || Boolean(legacyCompatibleBaseUrl))));

  return {
    enabled,
    baseUrl,
    apiKeySaved,
    customHeaders:
      adapter.supportsCustomHeaders
        ? existingProvider?.customHeaders ?? legacyCustomHeaders
        : undefined,
    textModel: normalizeTextModelSettings(providerId, settings),
    imageModel: normalizeImageModelSettings(providerId, settings),
  };
}

function normalizeTextModelSettings(
  providerId: ProviderId,
  settings: LegacySettings,
): TextModelSettings {
  const existingProvider = settings.providers?.[providerId];
  const defaultProvider = mockSettings.providers[providerId];
  const previousRoute = findPreviousRoute("text", providerId, settings);
  const legacyProviderId = getLegacyProviderId(settings);
  const legacyModel =
    providerId === legacyProviderId
      ? legacyProviderId === "openai"
        ? settings.textModel
        : settings.customTextModel
      : undefined;

  return {
    ...defaultProvider.textModel,
    ...settings.textRuntime,
    ...existingProvider?.textModel,
    model:
      existingProvider?.textModel?.model ??
      previousRoute?.model ??
      legacyModel ??
      defaultProvider.textModel.model,
    reasoningEnabled:
      existingProvider?.textModel?.reasoningEnabled ??
      settings.textRuntime?.reasoningEnabled ??
      settings.reasoningEnabled ??
      defaultProvider.textModel.reasoningEnabled,
    reasoningEffort:
      existingProvider?.textModel?.reasoningEffort ??
      settings.textRuntime?.reasoningEffort ??
      settings.reasoningEffort ??
      defaultProvider.textModel.reasoningEffort,
    responseVerbosity:
      existingProvider?.textModel?.responseVerbosity ??
      settings.textRuntime?.responseVerbosity ??
      settings.responseVerbosity ??
      defaultProvider.textModel.responseVerbosity,
    streamResponses:
      existingProvider?.textModel?.streamResponses ??
      settings.textRuntime?.streamResponses ??
      settings.streamResponses ??
      defaultProvider.textModel.streamResponses,
  };
}

function normalizeImageModelSettings(
  providerId: ProviderId,
  settings: LegacySettings,
): ImageModelSettings {
  const existingProvider = settings.providers?.[providerId];
  const defaultProvider = mockSettings.providers[providerId];
  const previousRoute = findPreviousRoute("image", providerId, settings);
  const legacyProviderId = getLegacyProviderId(settings);
  const legacyModel =
    providerId === legacyProviderId
      ? legacyProviderId === "openai"
        ? settings.imageModel
        : settings.customImageModel
      : undefined;

  return {
    ...defaultProvider.imageModel,
    ...settings.imageRuntime,
    ...existingProvider?.imageModel,
    model:
      existingProvider?.imageModel?.model ??
      previousRoute?.model ??
      legacyModel ??
      defaultProvider.imageModel.model,
    reasoningEnabled:
      existingProvider?.imageModel?.reasoningEnabled ??
      settings.imageRuntime?.reasoningEnabled ??
      defaultProvider.imageModel.reasoningEnabled,
    reasoningEffort:
      existingProvider?.imageModel?.reasoningEffort ??
      settings.imageRuntime?.reasoningEffort ??
      settings.textRuntime?.reasoningEffort ??
      settings.reasoningEffort ??
      defaultProvider.imageModel.reasoningEffort,
    responseVerbosity:
      existingProvider?.imageModel?.responseVerbosity ??
      settings.imageRuntime?.responseVerbosity ??
      settings.responseVerbosity ??
      defaultProvider.imageModel.responseVerbosity,
    streamResponses:
      existingProvider?.imageModel?.streamResponses ??
      settings.imageRuntime?.streamResponses ??
      defaultProvider.imageModel.streamResponses,
    quality:
      existingProvider?.imageModel?.quality ?? defaultProvider.imageModel.quality,
    background:
      existingProvider?.imageModel?.background ??
      defaultProvider.imageModel.background,
    outputFormat:
      existingProvider?.imageModel?.outputFormat ??
      defaultProvider.imageModel.outputFormat,
    outputCompression: clampImageCompression(
      existingProvider?.imageModel?.outputCompression ??
        defaultProvider.imageModel.outputCompression,
    ),
  };
}

function normalizeActiveModelSelection(
  settings: LegacySettings,
  providers: AppSettings["providers"],
): ActiveModelSelection {
  return {
    text: normalizeActiveModelRoute("text", settings, providers),
    image: normalizeActiveModelRoute("image", settings, providers),
  };
}

function normalizeActiveModelRoute(
  capability: ModelCapability,
  settings: LegacySettings,
  providers: AppSettings["providers"],
) {
  const existingRoute = settings.activeModelSelection?.[capability];
  const previousRoute = settings.modelRouting?.[capability];
  const legacyProviderId = getLegacyProviderId(settings);
  const providerId = normalizeProviderId(
    existingRoute?.providerId ?? previousRoute?.providerId ?? legacyProviderId,
    capability,
    providers,
  );

  return { providerId };
}

function normalizeProviderId(
  providerId: unknown,
  capability: ModelCapability,
  providers: AppSettings["providers"],
): ProviderId {
  const normalizedProviderId = providerId === "custom"
    ? "openai-compatible"
    : providerId;

  if (
    typeof normalizedProviderId === "string" &&
    providerIds.includes(normalizedProviderId as ProviderId) &&
    providerSupportsCapability(normalizedProviderId as ProviderId, capability)
  ) {
    return normalizedProviderId as ProviderId;
  }

  const configuredProvider = providerIds.find(
    (candidate) =>
      providerSupportsCapability(candidate, capability) &&
      providers[candidate].enabled,
  );

  return configuredProvider ?? mockSettings.activeModelSelection[capability].providerId;
}

function findPreviousRoute(
  capability: ModelCapability,
  providerId: ProviderId,
  settings: LegacySettings,
) {
  const route = settings.modelRouting?.[capability];
  const routeProviderId = route?.providerId === "custom"
    ? "openai-compatible"
    : route?.providerId;

  return routeProviderId === providerId ? route : undefined;
}

function getLegacyProviderId(settings: LegacySettings): ProviderId {
  return settings.apiProvider === "custom" ? "openai-compatible" : "openai";
}

function clampImageCompression(value: unknown) {
  const compression = typeof value === "number" ? value : 100;
  return Math.min(100, Math.max(0, Math.round(compression)));
}

export function getConfiguredTextProvider(
  settings: AppSettings,
): ConfiguredProvider<"text"> {
  const providerId = settings.activeModelSelection.text.providerId;
  const provider = settings.providers[providerId];
  return {
    ...provider,
    providerId,
    model: provider.textModel.model,
    modelConfig: provider.textModel,
  };
}

export function getConfiguredImageProvider(
  settings: AppSettings,
): ConfiguredProvider<"image"> {
  const providerId = settings.activeModelSelection.image.providerId;
  const provider = settings.providers[providerId];
  return {
    ...provider,
    providerId,
    model: provider.imageModel.model,
    modelConfig: provider.imageModel,
  };
}

export function getConfiguredTextModel(settings: AppSettings) {
  return getConfiguredTextProvider(settings).model;
}

export function getConfiguredImageModel(settings: AppSettings) {
  return getConfiguredImageProvider(settings).model;
}

export function getConfiguredProviderLabel(settings: AppSettings) {
  return getConfiguredImageProvider(settings).providerId;
}
