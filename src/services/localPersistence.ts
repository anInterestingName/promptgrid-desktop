import { invoke, isTauri } from "@tauri-apps/api/core";
import type { AppSnapshot, Conversation, GridCell, Project } from "../types";

const FALLBACK_STORAGE_KEY = "promptgrid.workspace.snapshot.v1";
const DEV_SECRET_PREFIX = "promptgrid.dev.api-key";

export type StorageInfo = {
  currentDataDir: string;
  databasePath: string;
  defaultDataDir: string;
  usesCustomDataDir: boolean;
};

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

export async function getStorageInfo(): Promise<StorageInfo | null> {
  if (!isTauri()) {
    return null;
  }

  return invoke<StorageInfo>("get_storage_info");
}

export async function setDataDirectory(
  directory?: string,
): Promise<StorageInfo | null> {
  if (!isTauri()) {
    return null;
  }

  return invoke<StorageInfo>("set_data_directory", {
    directory: directory?.trim() || null,
  });
}

export async function pickDataDirectory(): Promise<string | null> {
  if (!isTauri()) {
    return null;
  }

  return invoke<string | null>("pick_data_directory");
}

export async function openProjectFolder(project: Project): Promise<void> {
  if (!isTauri()) {
    throw new Error("Open project folder is only available in the desktop app.");
  }

  await invoke("open_project_folder", {
    projectId: project.id,
    projectTitle: project.title,
    projectDirectory: project.projectDirectory ?? null,
  });
}

export async function saveGeneratedImage({
  imageDataUrl,
  project,
  conversation,
  task,
}: {
  imageDataUrl: string;
  project: Project;
  conversation: Conversation;
  task: GridCell;
}): Promise<string> {
  if (!isTauri()) {
    return imageDataUrl;
  }

  const result = await invoke<{ imagePath: string }>("save_generated_image", {
    request: {
      imageDataUrl,
      projectId: project.id,
      projectTitle: project.title,
      projectDirectory: project.projectDirectory ?? null,
      conversationId: conversation.id,
      gridSize: task.gridSize ?? project.gridSize,
      explorationRound: task.explorationRound,
      cellIndex: task.index,
      attempt: task.attempt,
    },
  });

  return result.imagePath;
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
