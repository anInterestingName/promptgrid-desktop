import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppSettings, Project } from "../types";

const DEV_SECRET_PREFIX = "promptgrid.dev.api-key";

export type PromptDirection = {
  prompt: string;
  title: string;
};

export type PromptAnalysisResult = {
  conversationTitle: string;
  directions: PromptDirection[];
};

export type AnalyzePromptRequest = ProviderRuntime & {
  aspectRatio: string;
  gridSize: number;
  originalPrompt: string;
  outputSize: string;
  quality: string;
  style: string;
  textModel: string;
};

export type GenerateImageRequest = ProviderRuntime & {
  aspectRatio: string;
  imageModel: string;
  outputSize: string;
  prompt: string;
  quality: string;
};

export type GeneratedImage = {
  imageDataUrl: string;
};

type ProviderRuntime = {
  baseUrl: string;
  customHeaders?: string;
  provider: string;
  reasoningEnabled: boolean;
  reasoningEffort: string;
  responseVerbosity: string;
  streamResponses: boolean;
};

export async function analyzePromptDirections(
  project: Project,
  settings: AppSettings,
): Promise<PromptAnalysisResult> {
  const request = {
    ...buildProviderRuntime(settings),
    aspectRatio: project.aspectRatio,
    gridSize: project.gridSize,
    originalPrompt: project.originalPrompt,
    outputSize: project.outputSize,
    quality: project.quality,
    style: project.style,
    textModel: getConfiguredTextModel(settings),
  } satisfies AnalyzePromptRequest;

  if (isTauri()) {
    return invoke<PromptAnalysisResult>("analyze_prompt_directions", { request });
  }

  return requestDevAiProxy<PromptAnalysisResult>("analyze-prompts", request);
}

export async function generatePromptImage(
  prompt: string,
  project: Project,
  settings: AppSettings,
): Promise<GeneratedImage> {
  const request = {
    ...buildProviderRuntime(settings),
    aspectRatio: project.aspectRatio,
    imageModel: getConfiguredImageModel(settings),
    outputSize: getSupportedOutputSize(project.outputSize, settings),
    prompt,
    quality: project.quality,
  } satisfies GenerateImageRequest;

  if (isTauri()) {
    return invoke<GeneratedImage>("generate_prompt_image", { request });
  }

  return requestDevAiProxy<GeneratedImage>("generate-image", request);
}

function buildProviderRuntime(settings: AppSettings): ProviderRuntime {
  const provider = settings.apiProvider;

  return {
    provider,
    baseUrl:
      provider === "openai"
        ? settings.openAiBaseUrl
        : settings.customBaseUrl ?? "",
    customHeaders: provider === "custom" ? settings.customHeaders : undefined,
    reasoningEnabled: settings.reasoningEnabled,
    reasoningEffort: settings.reasoningEffort,
    responseVerbosity: settings.responseVerbosity,
    streamResponses: settings.streamResponses,
  };
}

function getConfiguredTextModel(settings: AppSettings) {
  return settings.apiProvider === "openai"
    ? settings.textModel
    : settings.customTextModel ?? "";
}

function getConfiguredImageModel(settings: AppSettings) {
  return settings.apiProvider === "openai"
    ? settings.imageModel
    : settings.customImageModel ?? "";
}

function getSupportedOutputSize(outputSize: string, settings: AppSettings) {
  if (outputSize !== "2k" && outputSize !== "4k") {
    return outputSize;
  }

  const imageModel = getConfiguredImageModel(settings).toLowerCase();
  if (settings.apiProvider === "custom" || imageModel.includes("gpt-image-2")) {
    return outputSize;
  }

  return "large";
}

async function requestDevAiProxy<ResponseBody>(
  action: "analyze-prompts" | "generate-image",
  payload: AnalyzePromptRequest | GenerateImageRequest,
): Promise<ResponseBody> {
  const apiKey = window.sessionStorage.getItem(
    `${DEV_SECRET_PREFIX}.${payload.provider}`,
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
