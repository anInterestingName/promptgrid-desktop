import { create } from "zustand";
import {
  createMockTasks,
  mockProject,
  mockSettings,
  mockVisuals,
} from "../data/mockProject";
import { getInitialLocale, saveLocale, type Locale } from "../i18n";
import {
  getInitialColorTheme,
  saveColorTheme,
  type ColorTheme,
} from "../theme";
import type { AspectRatio, GridCell, Project, Quality } from "../types";

type PromptGridState = {
  locale: Locale;
  colorTheme: ColorTheme;
  project: Project;
  tasks: GridCell[];
  selectedTaskId?: string;
  previewTaskId?: string;
  isAnalyzing: boolean;
  isGenerating: boolean;
  currentRound: number;
  setLocale: (locale: Locale) => void;
  setColorTheme: (colorTheme: ColorTheme) => void;
  setOriginalPrompt: (prompt: string) => void;
  setStyle: (style: string) => void;
  setAspectRatio: (aspectRatio: AspectRatio) => void;
  setQuality: (quality: Quality) => void;
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

function completeTask(task: GridCell, attempt = task.attempt): GridCell {
  return {
    ...task,
    attempt,
    status: "completed",
    imagePath: `mock://round-${task.explorationRound}-cell-${task.index + 1}`,
    errorMessage: undefined,
    updatedAt: new Date().toISOString(),
  };
}

function runMockCompletion(
  get: () => PromptGridState,
  set: (
    partial:
      | Partial<PromptGridState>
      | ((state: PromptGridState) => Partial<PromptGridState>),
  ) => void,
  taskIds: string[],
) {
  taskIds.forEach((taskId, position) => {
    window.setTimeout(
      () => {
        set((state) => {
          const tasks = state.tasks.map((task) => {
            if (task.id !== taskId) {
              return task;
            }

            const shouldFail = position === 5 && task.attempt === 1;
            return shouldFail
              ? {
                  ...task,
                  status: "failed" as const,
                  errorMessage: "Mock provider timeout",
                  updatedAt: new Date().toISOString(),
                }
              : completeTask(task);
          });

          const isGenerating = tasks.some((task) => task.status === "running");
          return { tasks, isGenerating };
        });
      },
      520 + position * 180,
    );
  });

  window.setTimeout(() => {
    const stillRunning = get().tasks.some((task) => task.status === "running");
    if (!stillRunning) {
      set({ isGenerating: false });
    }
  }, 2500);
}

export const usePromptGridStore = create<PromptGridState>((set, get) => ({
  locale: getInitialLocale(),
  colorTheme: getInitialColorTheme(),
  project: mockProject,
  tasks: firstTasks,
  selectedTaskId: firstTasks[0]?.id,
  previewTaskId: undefined,
  isAnalyzing: false,
  isGenerating: false,
  currentRound: 1,
  setLocale: (locale) => {
    saveLocale(locale);
    set({ locale });
  },
  setColorTheme: (colorTheme) => {
    saveColorTheme(colorTheme);
    set({ colorTheme });
  },
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
  analyzePrompt: () => {
    set({ isAnalyzing: true });
    window.setTimeout(() => {
      const state = get();
      const tasks = createMockTasks(
        state.project,
        state.project.originalPrompt,
        state.currentRound,
      );
      set({
        tasks,
        selectedTaskId: tasks[0]?.id,
        isAnalyzing: false,
      });
    }, 420);
  },
  generateImages: () => {
    const taskIds = get().tasks.map((task) => task.id);
    set((state) => ({
      isGenerating: true,
      tasks: state.tasks.map((task, index) => ({
        ...task,
        status: index < mockSettings.maxConcurrency ? "running" : "pending",
        errorMessage: undefined,
        updatedAt: new Date().toISOString(),
      })),
    }));

    taskIds.forEach((taskId, index) => {
      if (index >= mockSettings.maxConcurrency) {
        window.setTimeout(
          () => {
            set((state) => ({
              tasks: state.tasks.map((task) =>
                task.id === taskId
                  ? {
                      ...task,
                      status: "running",
                      updatedAt: new Date().toISOString(),
                    }
                  : task,
              ),
            }));
          },
          360 + index * 120,
        );
      }
    });

    runMockCompletion(get, set, taskIds);
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

    window.setTimeout(() => {
      set((state) => ({
        isGenerating: false,
        tasks: state.tasks.map((task) =>
          task.id === taskId ? completeTask(task, task.attempt) : task,
        ),
      }));
    }, 680);
  },
  retryTask: (taskId) => {
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

    window.setTimeout(() => {
      set((state) => ({
        isGenerating: false,
        tasks: state.tasks.map((task) =>
          task.id === taskId ? completeTask(task) : task,
        ),
      }));
    }, 680);
  },
  expandFromTask: (taskId) => {
    const state = get();
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
