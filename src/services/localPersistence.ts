import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  AppSnapshot,
  Conversation,
  GridCell,
  Project,
  ProviderId,
} from "../types";

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

export async function openImageInFileManager(imagePath: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("Open image location is only available in the desktop app.");
  }

  await invoke("open_image_in_file_manager", { imagePath });
}

export async function copyImageFile(imagePath: string): Promise<void> {
  if (!isTauri()) {
    throw new Error("Copy image file is only available in the desktop app.");
  }

  await invoke("copy_image_file_to_clipboard", { imagePath });
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
    deepseekApiKey?: string;
    customApiKey?: string;
    openAiApiKeySaved?: boolean;
    deepseekApiKeySaved?: boolean;
    customApiKeySaved?: boolean;
  };

  if (settings.openAiApiKey?.trim()) {
    window.sessionStorage.setItem(
      `${DEV_SECRET_PREFIX}.openai`,
      settings.openAiApiKey.trim(),
    );
    markProviderApiKeySaved(settings, "openai");
  }

  if (settings.customApiKey?.trim()) {
    window.sessionStorage.setItem(
      `${DEV_SECRET_PREFIX}.openai-compatible`,
      settings.customApiKey.trim(),
    );
    markProviderApiKeySaved(settings, "openai-compatible");
  }

  if (settings.deepseekApiKey?.trim()) {
    window.sessionStorage.setItem(
      `${DEV_SECRET_PREFIX}.deepseek`,
      settings.deepseekApiKey.trim(),
    );
    markProviderApiKeySaved(settings, "deepseek");
  }

  delete settings.openAiApiKey;
  delete settings.customApiKey;
  delete settings.deepseekApiKey;
  delete settings.openAiApiKeySaved;
  delete settings.customApiKeySaved;
  delete settings.deepseekApiKeySaved;

  return {
    ...snapshot,
    settings,
  };
}

function markProviderApiKeySaved(
  settings: AppSnapshot["settings"],
  providerId: ProviderId,
) {
  const providers = settings.providers ?? {
    openai: {
      enabled: true,
      baseUrl: "https://api.openai.com/v1",
      apiKeySaved: false,
      textModel: {
        model: "gpt-4o-mini",
        reasoningEnabled: false,
        reasoningEffort: "medium",
        responseVerbosity: "medium",
        streamResponses: false,
      },
      imageModel: {
        model: "gpt-image-1",
        reasoningEnabled: false,
        reasoningEffort: "medium",
        responseVerbosity: "medium",
        streamResponses: true,
        quality: "auto",
        background: "auto",
        outputFormat: "png",
        outputCompression: 100,
      },
    },
    deepseek: {
      enabled: false,
      baseUrl: "https://api.deepseek.com",
      apiKeySaved: false,
      textModel: {
        model: "deepseek-chat",
        reasoningEnabled: false,
        reasoningEffort: "medium",
        responseVerbosity: "medium",
        streamResponses: false,
      },
      imageModel: {
        model: "",
        reasoningEnabled: false,
        reasoningEffort: "medium",
        responseVerbosity: "medium",
        streamResponses: true,
        quality: "auto",
        background: "auto",
        outputFormat: "png",
        outputCompression: 100,
      },
    },
    "openai-compatible": {
      enabled: false,
      baseUrl: "",
      apiKeySaved: false,
      customHeaders: "",
      textModel: {
        model: "",
        reasoningEnabled: false,
        reasoningEffort: "medium",
        responseVerbosity: "medium",
        streamResponses: false,
      },
      imageModel: {
        model: "",
        reasoningEnabled: false,
        reasoningEffort: "medium",
        responseVerbosity: "medium",
        streamResponses: true,
        quality: "auto",
        background: "auto",
        outputFormat: "png",
        outputCompression: 100,
      },
    },
  };

  settings.providers = {
    ...providers,
    [providerId]: {
      ...providers[providerId],
      apiKeySaved: true,
      enabled: true,
    },
  };
}
