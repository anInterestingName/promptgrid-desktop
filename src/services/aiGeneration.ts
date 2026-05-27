import { invoke, isTauri } from "@tauri-apps/api/core";
import { configureDebugLogging } from "./debugLogging";
import type {
  AppSettings,
  ImageReference,
  ModelCapability,
  Project,
  ProviderId,
  ImageModelSettings,
} from "../types";
import {
  getConfiguredImageProvider,
  getConfiguredTextProvider,
} from "../modules/settings/settingsDomain";
import { getProviderSecretKey } from "./modelConfig";

const DEV_SECRET_PREFIX = "promptgrid.dev.api-key";

export type PromptDirection = {
  prompt: string;
  title: string;
};

export type PromptAnalysisResult = {
  conversationTitle: string;
  directions: PromptDirection[];
};

export type AnalyzePromptRequest = TextProviderRuntime & {
  gridSize: number;
  prompt: string;
  textModel: string;
};

export type GenerateImageRequest = ImageProviderRuntime & {
  aspectRatio: string;
  imageBackground: ImageModelSettings["background"];
  imageModel: string;
  imageOutputCompression: number;
  imageOutputFormat: ImageModelSettings["outputFormat"];
  imageQuality: ImageModelSettings["quality"];
  outputSize: string;
  prompt: string;
  quality: string;
  referenceImages?: ImageReference[];
};

export type GeneratedImage = {
  imageDataUrl: string;
};

type ProviderRuntime = {
  channel: ModelCapability;
  baseUrl: string;
  customHeaders?: string;
  provider: ProviderId;
  responseVerbosity: string;
  debugLoggingEnabled: boolean;
  debugLogRetentionDays: number;
};

type TextProviderRuntime = ProviderRuntime & {
  channel: "text";
  reasoningEnabled: boolean;
  reasoningEffort: string;
  streamResponses: boolean;
};

type ImageProviderRuntime = ProviderRuntime & {
  channel: "image";
  reasoningEnabled: boolean;
  reasoningEffort: string;
  streamResponses: boolean;
};

export async function analyzePromptDirections(
  project: Project,
  settings: AppSettings,
  prompt: string,
): Promise<PromptAnalysisResult> {
  const textProvider = getConfiguredTextProvider(settings);
  const request = {
    ...buildTextProviderRuntime(settings),
    gridSize: project.gridSize,
    prompt,
    textModel: textProvider.model,
  } satisfies AnalyzePromptRequest;

  await ensureDebugLoggingConfigured(request);

  if (isTauri()) {
    return invoke<PromptAnalysisResult>("analyze_prompt_directions", { request });
  }

  return requestDevAiProxy<PromptAnalysisResult>("analyze-prompts", request);
}

export async function generatePromptImage({
  prompt,
  project,
  settings,
  referenceImages = [],
}: {
  prompt: string;
  project: Project;
  settings: AppSettings;
  referenceImages?: ImageReference[];
}): Promise<GeneratedImage> {
  const imageProvider = getConfiguredImageProvider(settings);
  const request = {
    ...buildImageProviderRuntime(settings),
    aspectRatio: project.aspectRatio,
    imageBackground: imageProvider.modelConfig.background,
    imageModel: imageProvider.model,
    imageOutputCompression: imageProvider.modelConfig.outputCompression,
    imageOutputFormat: imageProvider.modelConfig.outputFormat,
    imageQuality: imageProvider.modelConfig.quality,
    outputSize: getSupportedOutputSize(project.outputSize, settings),
    prompt,
    quality: project.quality,
    referenceImages,
  } satisfies GenerateImageRequest;

  await ensureDebugLoggingConfigured(request);

  if (isTauri()) {
    return invoke<GeneratedImage>("generate_prompt_image", { request });
  }

  return requestDevAiProxy<GeneratedImage>("generate-image", request);
}

async function ensureDebugLoggingConfigured(request: ProviderRuntime) {
  await configureDebugLogging({
    enabled: request.debugLoggingEnabled,
    retentionDays: request.debugLogRetentionDays,
  });
}

function buildTextProviderRuntime(settings: AppSettings): TextProviderRuntime {
  const route = getConfiguredTextProvider(settings);
  return {
    channel: "text",
    provider: route.providerId,
    baseUrl: route.baseUrl,
    customHeaders: route.customHeaders,
    reasoningEnabled: route.modelConfig.reasoningEnabled,
    reasoningEffort: route.modelConfig.reasoningEffort,
    responseVerbosity: route.modelConfig.responseVerbosity,
    streamResponses: route.modelConfig.streamResponses,
    debugLoggingEnabled: settings.debugLoggingEnabled,
    debugLogRetentionDays: settings.debugLogRetentionDays,
  };
}

function buildImageProviderRuntime(settings: AppSettings): ImageProviderRuntime {
  const route = getConfiguredImageProvider(settings);
  return {
    channel: "image",
    provider: route.providerId,
    baseUrl: route.baseUrl,
    customHeaders: route.customHeaders,
    reasoningEnabled: route.modelConfig.reasoningEnabled,
    reasoningEffort: route.modelConfig.reasoningEffort,
    responseVerbosity: route.modelConfig.responseVerbosity,
    streamResponses: route.modelConfig.streamResponses,
    debugLoggingEnabled: settings.debugLoggingEnabled,
    debugLogRetentionDays: settings.debugLogRetentionDays,
  };
}

function getSupportedOutputSize(outputSize: string, settings: AppSettings) {
  if (outputSize !== "2k" && outputSize !== "4k") {
    return outputSize;
  }

  const imageProvider = getConfiguredImageProvider(settings);
  const imageModel = imageProvider.model.toLowerCase();
  if (imageModel.includes("gpt-image-2")) {
    return outputSize;
  }

  return "large";
}

async function requestDevAiProxy<ResponseBody>(
  action: "analyze-prompts" | "generate-image",
  payload: AnalyzePromptRequest | GenerateImageRequest,
): Promise<ResponseBody> {
  const apiKey = window.sessionStorage.getItem(
    `${DEV_SECRET_PREFIX}.${getProviderSecretKey(payload.provider)}`,
  );
  if (!apiKey) {
    throw new Error("API key is not saved for this provider");
  }

  const response = await fetch(`/__promptgrid_dev/${action}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ...payload,
      apiKey,
    }),
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
