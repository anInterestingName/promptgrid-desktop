import { t, type Locale } from "../../i18n";
import type { ModelOption } from "../../types";
import type { ModelFetchStatus, ModelTestKind } from "./types";
import { getErrorMessage } from "../../shared/utils/error";

export function getSuggestedModelId(
  models: ModelOption[],
  kind: "text" | "image",
) {
  const hints =
    kind === "image"
      ? ["image", "gpt-image", "dall", "flux", "imagen", "sdxl"]
      : ["gpt", "claude", "gemini", "deepseek", "qwen", "llama", "codex"];

  return models.find((model) => {
    const id = model.id.toLowerCase();
    return hints.some((hint) => id.includes(hint));
  })?.id;
}

export function getModelFetchMessage(
  locale: Locale,
  status: ModelFetchStatus,
  count: number,
) {
  if (status === "loading") {
    return t(locale, "fetchingModels");
  }

  if (status === "ready") {
    return count > 0
      ? t(locale, "modelsReady").replace("{count}", String(count))
      : t(locale, "modelsEmpty");
  }

  return t(locale, "modelsFetchError");
}

export function getModelFetchErrorMessage(locale: Locale, error: unknown) {
  const message = getErrorMessage(error);

  if (message.includes("API key is not saved")) {
    return t(locale, "apiKeyRequiredForModelFetch");
  }

  if (message.includes("Base URL is required")) {
    return t(locale, "baseUrlRequiredForModelFetch");
  }

  return message;
}

export function getModelTestErrorMessage(
  locale: Locale,
  error: unknown,
  kind: ModelTestKind,
) {
  const message = getErrorMessage(error);

  if (message.includes("API key is not saved")) {
    return t(locale, "apiKeyRequiredForModelTest");
  }

  if (message.includes("Base URL is required")) {
    return t(locale, "baseUrlRequiredForModelTest");
  }

  if (message.includes("Text model is required")) {
    return t(locale, "textModelRequiredForModelTest");
  }

  if (message.includes("Image model is required")) {
    return t(locale, "imageModelRequiredForModelTest");
  }

  if (message.includes("no image output")) {
    return t(locale, "imageModelTestEmptyOutput");
  }

  if (message.includes("empty response")) {
    return t(
      locale,
      kind === "image" ? "imageModelTestEmptyOutput" : "modelTestEmptyOutput",
    );
  }

  return message;
}
