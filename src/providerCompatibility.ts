import {
  extractResponsesError,
  extractResponsesImageBase64,
  extractResponsesText,
  hasResponsesImageOutput,
} from "./devProviderResponses";

// This layer is the only place where provider-specific HTTP payloads and
// response shapes should leak into the development proxy.
export type ProviderIdLike =
  | "openai"
  | "deepseek"
  | "openai-compatible"
  | string;

export type ProviderCapability = "text" | "image";

export type ProviderRuntimeOptions = {
  reasoningEnabled?: boolean;
  reasoningEffort?: string;
  responseVerbosity?: string;
  streamResponses?: boolean;
};

export type UnifiedProviderRequest = ProviderRuntimeOptions & {
  apiKey: string;
  baseUrl: string;
  customHeaders?: string;
  model?: string;
  operation:
    | "fetchModels"
    | "testTextModel"
    | "testImageModel"
    | "analyzePromptDirections"
    | "generatePromptImage";
  provider?: ProviderIdLike;
  prompt?: string;
  referenceImages?: Array<{
    id: string;
    role: string;
    imagePath: string;
    name?: string;
  }>;
  image?: {
    aspectRatio?: string;
    background?: "auto" | "transparent" | "opaque";
    compression?: number;
    format?: "png" | "jpeg" | "webp";
    model?: string;
    outputSize?: string;
    projectQuality?: string;
    quality?: "auto" | "low" | "medium" | "high";
  };
};

export type ProviderHttpRequest = {
  body?: unknown;
  method: "GET" | "POST";
  url: string;
};

export type UnifiedProviderResponse =
  | { kind: "models"; models: Array<{ id: string; ownedBy?: string }> }
  | { kind: "text"; text: string }
  | { kind: "image"; imageBase64: string };

export type ProviderAdapter = {
  buildRequest: (request: UnifiedProviderRequest) => ProviderHttpRequest;
  parseResponse: (
    request: UnifiedProviderRequest,
    responseText: string,
  ) => UnifiedProviderResponse;
};

type ProviderModel = {
  id?: string;
  owned_by?: string;
};

type ProviderModelsResponse = {
  data?: ProviderModel[];
};

const responsesProviderAdapter: ProviderAdapter = {
  buildRequest(request) {
    if (request.operation === "fetchModels") {
      return {
        method: "GET",
        url: buildModelsUrl(requireField(request.baseUrl, "Base URL")),
      };
    }

    const model = requireField(
      request.image?.model ?? request.model,
      request.operation === "generatePromptImage" ||
        request.operation === "testImageModel"
        ? "Image model"
        : "Text model",
    );

    if (request.operation === "generatePromptImage") {
      return {
        method: "POST",
        url: buildResponsesUrl(requireField(request.baseUrl, "Base URL")),
        body: withRuntimeParameters(
          {
            model,
            input: buildResponsesUserInput(
              requireField(request.prompt, "Image prompt"),
              request.referenceImages,
            ),
            tools: [buildImageGenerationTool(request, model)],
            tool_choice: {
              type: "image_generation",
            },
          },
          {
            ...request,
            reasoningEnabled: false,
          },
        ),
      };
    }

    if (request.operation === "testImageModel") {
      return {
        method: "POST",
        url: buildResponsesUrl(requireField(request.baseUrl, "Base URL")),
        body: withRuntimeParameters(
          {
            model,
            input: buildResponsesUserInput(
              "Generate a simple image of a small blue square on a white background.",
            ),
            tools: [
              {
                type: "image_generation",
              },
            ],
            tool_choice: {
              type: "image_generation",
            },
          },
          { ...request, streamResponses: false },
        ),
      };
    }

    return {
      method: "POST",
      url: buildResponsesUrl(requireField(request.baseUrl, "Base URL")),
      body: withRuntimeParameters(
        {
          model,
          input: buildResponsesUserInput(
            request.operation === "testTextModel"
              ? "Reply with exactly: OK"
              : requireField(request.prompt, "Text prompt"),
          ),
        },
        request.operation === "analyzePromptDirections"
          ? { ...request, streamResponses: false }
          : request,
      ),
    };
  },

  parseResponse(request, responseText) {
    if (request.operation === "fetchModels") {
      return {
        kind: "models",
        models: parseModelList(responseText),
      };
    }

    if (
      request.operation === "generatePromptImage" ||
      request.operation === "testImageModel"
    ) {
      const error = extractResponsesError(responseText);
      if (error) {
        throw new Error(error);
      }

      const imageBase64 = extractResponsesImageBase64(responseText);
      if (!imageBase64 && !hasResponsesImageOutput(responseText)) {
        throw new Error("Image model returned no image output");
      }

      return {
        kind: "image",
        imageBase64,
      };
    }

    const error = extractResponsesError(responseText);
    if (error) {
      throw new Error(error);
    }

    const text = extractResponsesText(responseText);
    if (!text) {
      throw new Error("Model returned an empty response");
    }

    return {
      kind: "text",
      text,
    };
  },
};

function buildResponsesUserInput(
  prompt: string,
  referenceImages: UnifiedProviderRequest["referenceImages"] = [],
) {
  return [
    {
      type: "message",
      role: "user",
      content: [
        {
          type: "input_text",
          text: prompt,
        },
        ...referenceImages.map((reference) => ({
          type: "input_image",
          image_url: requireField(reference.imagePath, "Reference image"),
        })),
      ],
    },
  ];
}

const providerCompatibilityAdapters: Record<string, ProviderAdapter> = {
  deepseek: responsesProviderAdapter,
  openai: responsesProviderAdapter,
  "openai-compatible": responsesProviderAdapter,
};

export function getProviderCompatibilityAdapter(
  provider?: ProviderIdLike,
): ProviderAdapter {
  return (
    providerCompatibilityAdapters[provider ?? ""] ?? responsesProviderAdapter
  );
}

export function buildProviderHeaders(request: UnifiedProviderRequest) {
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

function parseModelList(responseText: string) {
  const modelList = JSON.parse(responseText) as ProviderModelsResponse;
  return (modelList.data ?? [])
    .filter(
      (model): model is Required<Pick<ProviderModel, "id">> & ProviderModel =>
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
}

function withRuntimeParameters(
  payload: Record<string, unknown>,
  request: ProviderRuntimeOptions,
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

function buildImageGenerationTool(
  request: UnifiedProviderRequest,
  model: string,
) {
  const image = request.image ?? {};
  const tool: Record<string, unknown> = {
    type: "image_generation",
    quality: mapImageQuality(image.quality, image.projectQuality),
    size: mapImageSize(
      image.aspectRatio,
      image.outputSize,
      model,
      request.provider,
    ),
  };

  if (image.background && image.background !== "auto") {
    tool.background = image.background;
  }

  if (image.format && image.format !== "png") {
    tool.output_format = image.format;
  }

  if (typeof image.compression === "number" && image.compression < 100) {
    tool.output_compression = Math.min(
      100,
      Math.max(0, Math.round(image.compression)),
    );
  }

  if (supportsPartialImageStreaming(model) && request.streamResponses) {
    tool.partial_images = 1;
  }

  return tool;
}

function mapImageQuality(imageQuality?: string, projectQuality?: string) {
  if (
    imageQuality === "low" ||
    imageQuality === "medium" ||
    imageQuality === "high"
  ) {
    return imageQuality;
  }

  if (projectQuality === "high") {
    return "high";
  }

  if (projectQuality === "standard") {
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
  void provider;
  return model?.toLowerCase().includes("gpt-image-2") === true;
}

function supportsPartialImageStreaming(model?: string) {
  return model?.toLowerCase().includes("gpt-image-2") === true;
}

function buildModelsUrl(baseUrl: string) {
  return buildEndpointUrl(baseUrl, "models");
}

function buildResponsesUrl(baseUrl: string) {
  return buildEndpointUrl(baseUrl, "responses");
}

function buildEndpointUrl(baseUrl: string, endpoint: "models" | "responses") {
  const trimmedUrl = baseUrl.trim().replace(/\/+$/, "");
  if (trimmedUrl.endsWith(`/${endpoint}`)) {
    return trimmedUrl;
  }

  const alternateEndpoint = endpoint === "models" ? "responses" : "models";
  if (trimmedUrl.endsWith(`/${alternateEndpoint}`)) {
    return `${trimmedUrl.slice(0, -alternateEndpoint.length)}${endpoint}`;
  }

  return `${trimmedUrl}/${endpoint}`;
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

function requireField(value: string | undefined, label: string) {
  const trimmedValue = value?.trim();
  if (!trimmedValue) {
    throw new Error(`${label} is required`);
  }

  return trimmedValue;
}
