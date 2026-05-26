import { mockSettings } from "../../data/mockProject";
import type { AppSettings, GridSize } from "../../types";

const validGridSizes = [6, 9, 16, 25] as const satisfies readonly GridSize[];

export function normalizeSettings(settings: Partial<AppSettings>): AppSettings {
  const apiProvider =
    settings.apiProvider === "custom" || settings.apiProvider === "openai"
      ? settings.apiProvider
      : mockSettings.apiProvider;

  return {
    ...mockSettings,
    ...settings,
    apiProvider,
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
