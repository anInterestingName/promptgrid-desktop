import { create } from "zustand";
import {
  createMockTasks,
  mockProject,
  mockSettings,
  mockVisuals,
} from "../data/mockProject";
import { getInitialLocale, saveLocale, type Locale } from "../i18n";
import {
  loadWorkspaceSnapshot,
  saveWorkspaceSnapshot,
} from "../services/localPersistence";
import {
  analyzePromptDirections,
  generatePromptImage,
} from "../services/aiGeneration";
import {
  getInitialColorTheme,
  saveColorTheme,
  type ColorTheme,
} from "../theme";
import type {
  AppSettings,
  AppSnapshot,
  AspectRatio,
  GridCell,
  OutputSize,
  Project,
  Quality,
} from "../types";

type ActiveSection = "projects" | "settings";
type StorageStatus = "idle" | "loading" | "saving" | "saved" | "error";

type PromptGridState = {
  locale: Locale;
  colorTheme: ColorTheme;
  activeSection: ActiveSection;
  project: Project;
  tasks: GridCell[];
  settings: AppSettings;
  selectedTaskId?: string;
  previewTaskId?: string;
  isAnalyzing: boolean;
  isGenerating: boolean;
  isHydrated: boolean;
  isHydrating: boolean;
  storageStatus: StorageStatus;
  currentRound: number;
  hydrate: () => Promise<void>;
  setActiveSection: (section: ActiveSection) => void;
  setLocale: (locale: Locale) => void;
  setColorTheme: (colorTheme: ColorTheme) => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
  setOriginalPrompt: (prompt: string) => void;
  setStyle: (style: string) => void;
  setAspectRatio: (aspectRatio: AspectRatio) => void;
  setQuality: (quality: Quality) => void;
  setOutputSize: (outputSize: OutputSize) => void;
  analyzePrompt: () => void;
  generateImages: () => void;
  updateTaskPrompt: (taskId: string, prompt: string) => void;
  selectTask: (taskId: string) => void;
  previewTask: (taskId?: string) => void;
  regenerateTask: (taskId: string) => void;
  retryTask: (taskId: string) => void;
  expandFromTask: (taskId: string) => void;
};

const firstTasks = createMockTasks(mockProject);
const firstSelectedTaskId = firstTasks[0]?.id;

function createSnapshot(state: PromptGridState): AppSnapshot {
  return {
    project: state.project,
    tasks: state.tasks,
    settings: state.settings,
    selectedTaskId: state.selectedTaskId,
    currentRound: state.currentRound,
  };
}

function createSnapshotSignature(state: PromptGridState) {
  const taskSignature = state.tasks
    .map((task) =>
      [
        task.id,
        task.parentTaskId ?? "",
        task.explorationRound,
        task.index,
        task.prompt,
        task.directionTitle ?? "",
        task.status,
        task.errorMessage ?? "",
        task.provider,
        task.model,
        task.attempt,
        task.updatedAt,
        getImagePathSignature(task.imagePath),
        task.visual.title,
        task.visual.texture,
        ...task.visual.palette,
      ].join("\u001f"),
    )
    .join("\u001e");

  return JSON.stringify({
    project: state.project,
    settings: state.settings,
    selectedTaskId: state.selectedTaskId ?? "",
    currentRound: state.currentRound,
    tasks: taskSignature,
  });
}

function getImagePathSignature(imagePath?: string) {
  if (!imagePath) {
    return "";
  }

  return `${imagePath.length}:${imagePath.slice(0, 32)}`;
}

function normalizeSnapshot(snapshot: AppSnapshot) {
  const selectedTaskId =
    snapshot.selectedTaskId &&
    snapshot.tasks.some((task) => task.id === snapshot.selectedTaskId)
      ? snapshot.selectedTaskId
      : snapshot.tasks[0]?.id;
  const highestRound = snapshot.tasks.reduce(
    (round, task) => Math.max(round, task.explorationRound),
    1,
  );

  return {
    project: normalizeProject(snapshot.project),
    tasks: snapshot.tasks,
    settings: normalizeSettings(snapshot.settings),
    selectedTaskId,
    previewTaskId: undefined,
    currentRound: Math.max(snapshot.currentRound, highestRound),
  };
}

function normalizeProject(project: Partial<Project>): Project {
  return {
    ...mockProject,
    ...project,
    outputSize: project.outputSize ?? mockProject.outputSize,
  };
}

function normalizeSettings(settings: Partial<AppSettings>): AppSettings {
  const apiProvider =
    settings.apiProvider === "custom" || settings.apiProvider === "openai"
      ? settings.apiProvider
      : mockSettings.apiProvider;

  return {
    ...mockSettings,
    ...settings,
    apiProvider,
  };
}

function getConfiguredImageModel(settings: AppSettings) {
  return settings.apiProvider === "openai"
    ? settings.imageModel
    : settings.customImageModel || "";
}

function getConfiguredProviderLabel(settings: AppSettings) {
  return settings.apiProvider === "openai"
    ? "openai"
    : settings.customProviderName?.trim() || "custom";
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function runImageGeneration(
  get: () => PromptGridState,
  set: (
    partial:
      | Partial<PromptGridState>
      | ((state: PromptGridState) => Partial<PromptGridState>),
  ) => void,
  taskIds: string[],
) {
  const maxConcurrency = get().settings.maxConcurrency;
  const pendingTaskIds = [...taskIds];
  const workerCount = Math.max(1, Math.min(maxConcurrency, pendingTaskIds.length));

  async function runWorker() {
    while (pendingTaskIds.length > 0) {
      const taskId = pendingTaskIds.shift();
      if (!taskId) {
        return;
      }

      set((state) => ({
        tasks: state.tasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                status: "running",
                errorMessage: undefined,
                updatedAt: new Date().toISOString(),
              }
            : task,
        ),
      }));

      const state = get();
      const task = state.tasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        continue;
      }

      try {
        const image = await generatePromptImage(
          task.prompt,
          state.project,
          state.settings,
        );
        const provider = getConfiguredProviderLabel(state.settings);
        const model = getConfiguredImageModel(state.settings);
        set((latestState) => ({
          tasks: latestState.tasks.map((candidate) =>
            candidate.id === taskId
              ? {
                  ...candidate,
                  provider,
                  model,
                  status: "completed",
                  imagePath: image.imageDataUrl,
                  errorMessage: undefined,
                  updatedAt: new Date().toISOString(),
                }
              : candidate,
          ),
        }));
      } catch (error) {
        set((latestState) => ({
          tasks: latestState.tasks.map((candidate) =>
            candidate.id === taskId
              ? {
                  ...candidate,
                  status: "failed",
                  errorMessage: getErrorMessage(error),
                  updatedAt: new Date().toISOString(),
                }
              : candidate,
          ),
        }));
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runWorker));
  set({ isGenerating: false });
}

export const usePromptGridStore = create<PromptGridState>((set, get) => ({
  locale: getInitialLocale(),
  colorTheme: getInitialColorTheme(),
  activeSection: "projects",
  project: mockProject,
  tasks: firstTasks,
  settings: mockSettings,
  selectedTaskId: firstSelectedTaskId,
  previewTaskId: undefined,
  isAnalyzing: false,
  isGenerating: false,
  isHydrated: false,
  isHydrating: false,
  storageStatus: "idle",
  currentRound: 1,
  hydrate: async () => {
    const state = get();
    if (state.isHydrated || state.isHydrating) {
      return;
    }

    set({ isHydrating: true, storageStatus: "loading" });

    try {
      const snapshot = await loadWorkspaceSnapshot();
      if (snapshot) {
        set({
          ...normalizeSnapshot(snapshot),
          isHydrated: true,
          isHydrating: false,
          storageStatus: "saved",
        });
        return;
      }

      set({
        isHydrated: true,
        isHydrating: false,
        storageStatus: "saved",
      });
    } catch {
      set({
        isHydrated: true,
        isHydrating: false,
        storageStatus: "error",
      });
    }
  },
  setActiveSection: (activeSection) => set({ activeSection }),
  setLocale: (locale) => {
    saveLocale(locale);
    set({ locale });
  },
  setColorTheme: (colorTheme) => {
    saveColorTheme(colorTheme);
    set({ colorTheme });
  },
  updateSettings: (settings) =>
    set((state) => ({
      settings: {
        ...state.settings,
        ...settings,
      },
    })),
  setOriginalPrompt: (originalPrompt) =>
    set((state) => ({
      project: {
        ...state.project,
        originalPrompt,
        updatedAt: new Date().toISOString(),
      },
    })),
  setStyle: (style) =>
    set((state) => ({
      project: { ...state.project, style, updatedAt: new Date().toISOString() },
    })),
  setAspectRatio: (aspectRatio) =>
    set((state) => ({
      project: {
        ...state.project,
        aspectRatio,
        updatedAt: new Date().toISOString(),
      },
    })),
  setQuality: (quality) =>
    set((state) => ({
      project: {
        ...state.project,
        quality,
        updatedAt: new Date().toISOString(),
      },
    })),
  setOutputSize: (outputSize) =>
    set((state) => ({
      project: {
        ...state.project,
        outputSize,
        updatedAt: new Date().toISOString(),
      },
    })),
  analyzePrompt: () => {
    if (get().isAnalyzing || get().isGenerating) {
      return;
    }

    set({ isAnalyzing: true });
    void (async () => {
      const state = get();
      const baseTasks = createMockTasks(
        state.project,
        state.project.originalPrompt,
        state.currentRound,
      );

      try {
        const directions = await analyzePromptDirections(
          state.project,
          state.settings,
        );
        const provider = getConfiguredProviderLabel(state.settings);
        const model = getConfiguredImageModel(state.settings);
        const tasks = baseTasks.map((task, index) => ({
          ...task,
          prompt: directions[index]?.prompt || task.prompt,
          directionTitle: directions[index]?.title,
          provider,
          model,
          imagePath: undefined,
          errorMessage: undefined,
          status: "pending" as const,
          updatedAt: new Date().toISOString(),
        }));
        set({
          tasks,
          selectedTaskId: tasks[0]?.id,
          isAnalyzing: false,
        });
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        const tasks = baseTasks.map((task) => ({
          ...task,
          status: "failed" as const,
          errorMessage,
          updatedAt: new Date().toISOString(),
        }));
        set({
          tasks,
          selectedTaskId: tasks[0]?.id,
          isAnalyzing: false,
        });
      }
    })();
  },
  generateImages: () => {
    const state = get();
    if (state.isAnalyzing || state.isGenerating) {
      return;
    }

    const taskIds = state.tasks.map((task) => task.id);
    set((state) => ({
      isGenerating: true,
      tasks: state.tasks.map((task) => ({
        ...task,
        status: "pending",
        errorMessage: undefined,
        updatedAt: new Date().toISOString(),
      })),
    }));

    void runImageGeneration(get, set, taskIds);
  },
  updateTaskPrompt: (taskId, prompt) =>
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? { ...task, prompt, updatedAt: new Date().toISOString() }
          : task,
      ),
    })),
  selectTask: (taskId) => set({ selectedTaskId: taskId }),
  previewTask: (taskId) => set({ previewTaskId: taskId }),
  regenerateTask: (taskId) => {
    if (get().isAnalyzing || get().isGenerating) {
      return;
    }

    set((state) => ({
      isGenerating: true,
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              attempt: task.attempt + 1,
              status: "running",
              errorMessage: undefined,
              updatedAt: new Date().toISOString(),
            }
          : task,
      ),
    }));

    void runImageGeneration(get, set, [taskId]);
  },
  retryTask: (taskId) => {
    if (get().isAnalyzing || get().isGenerating) {
      return;
    }

    set((state) => ({
      isGenerating: true,
      tasks: state.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: "running",
              errorMessage: undefined,
              updatedAt: new Date().toISOString(),
            }
          : task,
      ),
    }));

    void runImageGeneration(get, set, [taskId]);
  },
  expandFromTask: (taskId) => {
    const state = get();
    if (state.isAnalyzing || state.isGenerating) {
      return;
    }

    const seedTask = state.tasks.find((task) => task.id === taskId);

    if (!seedTask) {
      return;
    }

    const nextRound = state.currentRound + 1;
    const tasks = createMockTasks(
      state.project,
      seedTask.prompt,
      nextRound,
      seedTask.id,
    ).map((task, index) => ({
      ...task,
      directionTitle: undefined,
      visual: mockVisuals[(index + nextRound) % mockVisuals.length],
    }));

    set({
      currentRound: nextRound,
      tasks,
      selectedTaskId: tasks[0]?.id,
      previewTaskId: undefined,
    });
  },
}));

let saveTimer: number | undefined;
let pendingSnapshot: AppSnapshot | undefined;
let lastQueuedSnapshotSignature = "";
let saveQueue = Promise.resolve();

usePromptGridStore.subscribe((state) => {
  if (!state.isHydrated || state.isHydrating) {
    return;
  }

  const snapshotSignature = createSnapshotSignature(state);
  if (snapshotSignature === lastQueuedSnapshotSignature) {
    return;
  }

  lastQueuedSnapshotSignature = snapshotSignature;
  pendingSnapshot = createSnapshot(state);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const snapshot = pendingSnapshot;
    const saveSignature = lastQueuedSnapshotSignature;
    if (!snapshot) {
      return;
    }

    pendingSnapshot = undefined;
    usePromptGridStore.setState({ storageStatus: "saving" });
    const saveJob = saveQueue
      .catch(() => undefined)
      .then(() => saveWorkspaceSnapshot(snapshot));

    saveQueue = saveJob;

    void saveJob
      .then(() => {
        if (saveSignature === lastQueuedSnapshotSignature) {
          usePromptGridStore.setState({ storageStatus: "saved" });
        }
      })
      .catch(() => {
        if (saveSignature === lastQueuedSnapshotSignature) {
          usePromptGridStore.setState({ storageStatus: "error" });
        }
      });
  }, 500);
});
