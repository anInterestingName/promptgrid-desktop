import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppSnapshot } from "../types";

const FALLBACK_STORAGE_KEY = "promptgrid.workspace.snapshot.v1";
const DEV_SECRET_PREFIX = "promptgrid.dev.api-key";

export async function loadWorkspaceSnapshot(): Promise<AppSnapshot | null> {
  if (isTauri()) {
    return invoke<AppSnapshot | null>("load_workspace");
  }

  const rawSnapshot = window.localStorage.getItem(FALLBACK_STORAGE_KEY);
  if (!rawSnapshot) {
    return null;
  }

  const snapshot = JSON.parse(rawSnapshot) as AppSnapshot;
  const sanitizedSnapshot = sanitizeSnapshot(snapshot);
  window.localStorage.setItem(
    FALLBACK_STORAGE_KEY,
    JSON.stringify(sanitizedSnapshot),
  );

  return sanitizedSnapshot;
}

export async function saveWorkspaceSnapshot(
  snapshot: AppSnapshot,
): Promise<void> {
  if (isTauri()) {
    await invoke("save_workspace", { snapshot });
    return;
  }

  window.localStorage.setItem(
    FALLBACK_STORAGE_KEY,
    JSON.stringify(sanitizeSnapshot(snapshot)),
  );
}

function sanitizeSnapshot(snapshot: AppSnapshot): AppSnapshot {
  const settings = {
    ...snapshot.settings,
  } as AppSnapshot["settings"] & {
    openAiApiKey?: string;
    customApiKey?: string;
  };

  if (settings.openAiApiKey?.trim()) {
    window.sessionStorage.setItem(
      `${DEV_SECRET_PREFIX}.openai`,
      settings.openAiApiKey.trim(),
    );
    settings.openAiApiKeySaved = true;
  }

  if (settings.customApiKey?.trim()) {
    window.sessionStorage.setItem(
      `${DEV_SECRET_PREFIX}.custom`,
      settings.customApiKey.trim(),
    );
    settings.customApiKeySaved = true;
  }

  delete settings.openAiApiKey;
  delete settings.customApiKey;

  return {
    ...snapshot,
    settings,
  };
}
