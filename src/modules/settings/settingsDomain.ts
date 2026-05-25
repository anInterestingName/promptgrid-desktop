import { mockSettings } from "../../data/mockProject";
import type { AppSettings } from "../../types";

export function normalizeSettings(settings: Partial<AppSettings>): AppSettings {
  const apiProvider =
    settings.apiProvider === "custom" || settings.apiProvider === "openai"
      ? settings.apiProvider
      : mockSettings.apiProvider;

  return {
    ...mockSettings,
    ...settings,
    apiProvider,
    debugLogRetentionDays: clampDebugLogRetentionDays(
      settings.debugLogRetentionDays,
    ),
  };
}

export function clampDebugLogRetentionDays(value: unknown) {
  const days =
    typeof value === "number" ? value : mockSettings.debugLogRetentionDays;
  return Math.min(
    365,
    Math.max(1, Math.round(days || mockSettings.debugLogRetentionDays)),
  );
}

export function getConfiguredImageModel(settings: AppSettings) {
  return settings.apiProvider === "openai"
    ? settings.imageModel
    : settings.customImageModel || "";
}

export function getConfiguredProviderLabel(settings: AppSettings) {
  return settings.apiProvider === "openai"
    ? "openai"
    : settings.customProviderName?.trim() || "custom";
}
