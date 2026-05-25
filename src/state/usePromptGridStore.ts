import { create } from "zustand";
import {
  createMockTasks,
  mockConversation,
  mockProject,
  mockSettings,
  mockVisuals,
} from "../data/mockProject";
import { getInitialLocale, saveLocale, type Locale } from "../i18n";
import {
  loadWorkspaceSnapshot,
  saveGeneratedImage,
  saveWorkspaceSnapshot,
} from "../services/localPersistence";
import { configureDebugLogging } from "../services/debugLogging";
import {
  analyzePromptDirections,
  generatePromptImage,
} from "../services/aiGeneration";
import {
  getInitialColorTheme,
  saveColorTheme,
  type ColorTheme,
} from "../theme";
import { getHighestRound } from "../modules/generation/taskUtils";
import { getErrorMessage } from "../shared/utils/error";
import { ensureById, upsertById } from "../shared/utils/collections";
import {
  clampDebugLogRetentionDays,
  getConfiguredImageModel,
  getConfiguredProviderLabel,
  normalizeSettings,
} from "../modules/settings/settingsDomain";
import type {
  AppSettings,
  AppSnapshot,
  AspectRatio,
  Conversation,
  GridCell,
  GridSize,
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
  conversation: Conversation;
  isConversationSaved: boolean;
  projects: Project[];
  conversations: Conversation[];
  conversationTasks: Record<string, GridCell[]>;
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
  createProject: (input?: { title?: string; projectDirectory?: string }) => void;
  startNewConversation: (projectId?: string) => void;
  openProject: (projectId: string) => void;
  openConversation: (conversationId: string) => void;
  setProjectTitle: (title: string) => void;
  setConversationTitle: (title: string) => void;
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

const firstTasks = createMockTasks(
  mockProject,
  mockProject.originalPrompt,
  1,
  undefined,
  mockConversation.id,
);
const firstSelectedTaskId = firstTasks[0]?.id;

function createSnapshot(state: PromptGridState): AppSnapshot {
  const projects = upsertById(state.projects, state.project);
  const conversations = state.isConversationSaved
    ? upsertById(state.conversations, state.conversation)
    : state.conversations;
  const conversationTasks = state.isConversationSaved
    ? {
        ...state.conversationTasks,
        [state.conversation.id]: state.tasks,
      }
    : state.conversationTasks;
  const snapshotConversation = state.isConversationSaved
    ? state.conversation
    : getLatestConversationForProject(conversations, state.project.id);
  const snapshotTasks = snapshotConversation
    ? conversationTasks[snapshotConversation.id] ?? []
    : [];

  return {
    project: state.project,
    conversation: snapshotConversation,
    activeConversationId: snapshotConversation?.id,
    projects,
    conversations,
    tasks: snapshotTasks,
    conversationTasks,
    settings: state.settings,
    selectedTaskId: state.isConversationSaved ? state.selectedTaskId : undefined,
    currentRound: state.isConversationSaved ? state.currentRound : 1,
  };
}

function createSnapshotSignature(state: PromptGridState) {
  const conversationTasks = state.isConversationSaved
    ? {
        ...state.conversationTasks,
        [state.conversation.id]: state.tasks,
      }
    : state.conversationTasks;
  const conversationTaskSignature = Object.entries(conversationTasks)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([conversationId, tasks]) =>
        `${conversationId}:${createTasksSignature(tasks)}`,
    )
    .join("\u001d");

  return JSON.stringify({
    project: state.project,
    conversation: state.isConversationSaved ? state.conversation : undefined,
    projects: upsertById(state.projects, state.project),
    conversations: state.isConversationSaved
      ? upsertById(state.conversations, state.conversation)
      : state.conversations,
    settings: state.settings,
    selectedTaskId: state.isConversationSaved ? state.selectedTaskId ?? "" : "",
    currentRound: state.isConversationSaved ? state.currentRound : 1,
    conversationTasks: conversationTaskSignature,
  });
}

function createTasksSignature(tasks: GridCell[]) {
  return tasks
    .map((task) =>
      [
        task.id,
        task.projectId,
        task.conversationId ?? "",
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
}

function getImagePathSignature(imagePath?: string) {
  if (!imagePath) {
    return "";
  }

  return `${imagePath.length}:${imagePath.slice(0, 32)}`;
}

function normalizeSnapshot(snapshot: AppSnapshot, locale: Locale) {
  const baseProject = normalizeProject(snapshot.project);
  const snapshotConversation = snapshot.conversation
    ? normalizeConversation(snapshot.conversation, baseProject)
    : undefined;
  const conversations = snapshot.conversations?.length
    ? snapshot.conversations.map((conversation) =>
        normalizeConversation(conversation, baseProject),
      )
    : [];
  const normalizedConversations = snapshotConversation
    ? ensureById(conversations, snapshotConversation)
    : conversations;
  const projects = ensureById(
    (snapshot.projects?.length ? snapshot.projects : [baseProject]).map(
      normalizeProject,
    ),
    baseProject,
  );

  const activeConversationId =
    snapshot.activeConversationId ?? snapshotConversation?.id;
  const selectedConversation = activeConversationId
    ? normalizedConversations.find(
        (candidate) => candidate.id === activeConversationId,
      )
    : undefined;
  const savedConversation =
    (selectedConversation?.projectId === baseProject.id
      ? selectedConversation
      : undefined) ??
    getLatestConversationForProject(normalizedConversations, baseProject.id);
  const projectRecord =
    projects.find((candidate) => candidate.id === savedConversation?.projectId) ??
    baseProject;
  const project = savedConversation
    ? mergeProjectWithConversation(projectRecord, savedConversation)
    : projectRecord;
  const conversation =
    savedConversation ?? createPendingConversation(project, locale);
  const conversationTasks = normalizeConversationTasks(
    snapshot.conversationTasks,
    normalizedConversations,
    projects,
  );

  if (savedConversation && !conversationTasks[conversation.id] && snapshot.tasks.length > 0) {
    conversationTasks[conversation.id] = normalizeTaskReferences(
      snapshot.tasks,
      project.id,
      conversation.id,
    );
  }

  const tasks = savedConversation
    ? conversationTasks[conversation.id] ??
      createMockTasks(
        project,
        conversation.originalPrompt,
        1,
        undefined,
        conversation.id,
      )
    : createMockTasks(project, "", 1, undefined, conversation.id);
  const selectedTaskId =
    snapshot.selectedTaskId &&
    tasks.some((task) => task.id === snapshot.selectedTaskId)
      ? snapshot.selectedTaskId
      : tasks[0]?.id;
  const highestRound = getHighestRound(tasks);

  return {
    project,
    conversation,
    projects: upsertById(projects, project),
    isConversationSaved: Boolean(savedConversation),
    conversations: savedConversation
      ? upsertById(normalizedConversations, conversation)
      : normalizedConversations,
    conversationTasks: savedConversation
      ? {
          ...conversationTasks,
          [conversation.id]: tasks,
        }
      : conversationTasks,
    tasks,
    settings: normalizeSettings(snapshot.settings),
    selectedTaskId,
    previewTaskId: undefined,
    currentRound: savedConversation ? Math.max(snapshot.currentRound, highestRound) : 1,
  };
}

function normalizeConversationTasks(
  conversationTasks: AppSnapshot["conversationTasks"],
  conversations: Conversation[],
  projects: Project[],
) {
  const normalized: Record<string, GridCell[]> = {};

  for (const [conversationId, tasks] of Object.entries(conversationTasks ?? {})) {
    const conversation = conversations.find(
      (candidate) => candidate.id === conversationId,
    );
    const projectId = conversation?.projectId ?? projects[0]?.id ?? mockProject.id;
    normalized[conversationId] = normalizeTaskReferences(
      tasks,
      projectId,
      conversationId,
    );
  }

  return normalized;
}

function normalizeTaskReferences(
  tasks: GridCell[],
  projectId: string,
  conversationId: string,
) {
  return tasks.map((task) => ({
    ...task,
    projectId: task.projectId || projectId,
    conversationId: task.conversationId || conversationId,
  }));
}

function normalizeProject(project: Partial<Project>): Project {
  return {
    ...mockProject,
    ...project,
    outputSize: project.outputSize ?? mockProject.outputSize,
  };
}

function normalizeConversation(
  conversation: Partial<Conversation>,
  project: Project,
): Conversation {
  return {
    id: conversation.id ?? `conversation-${project.id}`,
    projectId: conversation.projectId ?? project.id,
    title: conversation.title?.trim() || project.title,
    originalPrompt: conversation.originalPrompt ?? project.originalPrompt,
    style: conversation.style ?? project.style,
    gridSize: conversation.gridSize ?? project.gridSize,
    aspectRatio: conversation.aspectRatio ?? project.aspectRatio,
    quality: conversation.quality ?? project.quality,
    outputSize: conversation.outputSize ?? project.outputSize,
    schemaVersion: conversation.schemaVersion ?? project.schemaVersion,
    createdAt: conversation.createdAt ?? project.createdAt,
    updatedAt: conversation.updatedAt ?? project.updatedAt,
  };
}

function mergeProjectWithConversation(
  project: Project,
  conversation: Conversation,
): Project {
  return {
    ...project,
    originalPrompt: conversation.originalPrompt,
    style: conversation.style,
    gridSize: conversation.gridSize,
    aspectRatio: conversation.aspectRatio,
    quality: conversation.quality,
    outputSize: conversation.outputSize,
    schemaVersion: conversation.schemaVersion,
    updatedAt: laterTimestamp(project.updatedAt, conversation.updatedAt),
  };
}

function laterTimestamp(left: string, right: string) {
  return left > right ? left : right;
}

function createTimestampedProject(
  state: PromptGridState,
  title: string,
  projectDirectory?: string,
): Project {
  const createdAt = new Date().toISOString();
  const gridSize = state.settings.defaultGridSize as GridSize;

  return {
    id: `project-${Date.now()}`,
    title: title.trim() || getUntitledProjectName(state.locale, state.projects.length + 1),
    projectDirectory: projectDirectory?.trim() || undefined,
    originalPrompt: "",
    style: mockProject.style,
    gridSize,
    aspectRatio: state.settings.defaultAspectRatio,
    quality: "draft",
    outputSize: "standard",
    schemaVersion: 1,
    createdAt,
    updatedAt: createdAt,
  };
}

function createTimestampedConversation(
  project: Project,
  title: string,
  originalPrompt = project.originalPrompt,
): Conversation {
  const createdAt = new Date().toISOString();

  return {
    id: `conversation-${Date.now()}`,
    projectId: project.id,
    title: title.trim(),
    originalPrompt,
    style: project.style,
    gridSize: project.gridSize,
    aspectRatio: project.aspectRatio,
    quality: project.quality,
    outputSize: project.outputSize,
    schemaVersion: project.schemaVersion,
    createdAt,
    updatedAt: createdAt,
  };
}

function createPendingConversation(project: Project, locale: Locale): Conversation {
  return {
    ...createTimestampedConversation(
      {
        ...project,
        originalPrompt: "",
      },
      getUntitledConversationName(locale, 1),
      "",
    ),
    id: `pending-conversation-${Date.now()}`,
  };
}

function createAnalysisConversationTitle(
  rawTitle: string | undefined,
  originalPrompt: string,
  locale: Locale,
) {
  const title = rawTitle
    ?.trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 60);

  if (title) {
    return title;
  }

  const promptTitle = originalPrompt.trim().replace(/\s+/g, " ").slice(0, 30);
  return promptTitle || getUntitledConversationName(locale, 1);
}

function getUntitledProjectName(locale: Locale, index: number) {
  return locale === "zh" ? `未命名项目 ${index}` : `Untitled Project ${index}`;
}

function getUntitledConversationName(locale: Locale, index: number) {
  return locale === "zh" ? `未命名对话 ${index}` : `Untitled Chat ${index}`;
}

function getLatestConversationForProject(
  conversations: Conversation[],
  projectId: string,
) {
  return [...conversations]
    .filter((conversation) => conversation.projectId === projectId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

function createWorkspacePatch(
  state: PromptGridState,
  project: Project,
  conversation: Conversation,
  tasks: GridCell[],
) {
  return {
    project,
    conversation,
    projects: upsertById(state.projects, project),
    conversations: upsertById(state.conversations, conversation),
    conversationTasks: {
      ...state.conversationTasks,
      [conversation.id]: tasks,
    },
    tasks,
    selectedTaskId: tasks[0]?.id,
    previewTaskId: undefined,
    currentRound: getHighestRound(tasks),
    activeSection: "projects" as const,
    isConversationSaved: true,
  };
}

function createPendingWorkspacePatch(
  state: PromptGridState,
  projectRecord: Project,
) {
  const conversation = createPendingConversation(projectRecord, state.locale);
  const project = mergeProjectWithConversation(projectRecord, conversation);
  const tasks = createMockTasks(
    project,
    conversation.originalPrompt,
    1,
    undefined,
    conversation.id,
  );

  return {
    project,
    conversation,
    projects: upsertById(state.projects, project),
    tasks,
    selectedTaskId: tasks[0]?.id,
    previewTaskId: undefined,
    currentRound: 1,
    activeSection: "projects" as const,
    isConversationSaved: false,
  };
}

function createActiveMetadataPatch(
  state: PromptGridState,
  project: Project,
  conversation: Conversation,
) {
  const patch = {
    project,
    conversation,
    projects: upsertById(state.projects, project),
  };

  if (!state.isConversationSaved) {
    return patch;
  }

  return {
    ...patch,
    conversations: upsertById(state.conversations, conversation),
  };
}

function createActiveTaskPatch(
  state: PromptGridState,
  tasks: GridCell[],
  updatedAt = new Date().toISOString(),
) {
  const conversation = {
    ...state.conversation,
    updatedAt,
  };
  const project = {
    ...state.project,
    updatedAt,
  };

  const patch = {
    project,
    conversation,
    projects: upsertById(state.projects, project),
    tasks,
  };

  if (!state.isConversationSaved) {
    return patch;
  }

  return {
    ...patch,
    conversations: upsertById(state.conversations, conversation),
    conversationTasks: {
      ...state.conversationTasks,
      [conversation.id]: tasks,
    },
  };
}

async function runImageGeneration(
  get: () => PromptGridState,
  set: (
    partial:
      | Partial<PromptGridState>
      | ((state: PromptGridState) => Partial<PromptGridState>),
  ) => void,
  taskIds: string[],
  conversationId: string,
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

      set((state) => {
        const sourceTasks =
          state.conversationTasks[conversationId] ??
          (state.conversation.id === conversationId ? state.tasks : []);
        const tasks = sourceTasks.map((task) =>
          task.id === taskId
            ? {
                ...task,
                status: "running" as const,
                errorMessage: undefined,
                updatedAt: new Date().toISOString(),
              }
            : task,
        );

        return state.conversation.id === conversationId
          ? createActiveTaskPatch(state, tasks)
          : {
              conversationTasks: {
                ...state.conversationTasks,
                [conversationId]: tasks,
              },
            };
      });

      const state = get();
      const sourceTasks =
        state.conversationTasks[conversationId] ??
        (state.conversation.id === conversationId ? state.tasks : []);
      const task = sourceTasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        continue;
      }

      try {
        const image = await generatePromptImage(
          task.prompt,
          state.project,
          state.settings,
        );
        const generationState = get();
        const generationConversation =
          generationState.conversations.find(
            (candidate) => candidate.id === conversationId,
          ) ?? generationState.conversation;
        const generationProject =
          generationState.projects.find(
            (candidate) => candidate.id === generationConversation.projectId,
          ) ?? generationState.project;
        const imagePath = await saveGeneratedImage({
          imageDataUrl: image.imageDataUrl,
          project: generationProject,
          conversation: generationConversation,
          task,
        });
        const provider = getConfiguredProviderLabel(state.settings);
        const model = getConfiguredImageModel(state.settings);
        set((latestState) => {
          const latestTasks =
            latestState.conversationTasks[conversationId] ??
            (latestState.conversation.id === conversationId
              ? latestState.tasks
              : []);
          const tasks = latestTasks.map((candidate) =>
            candidate.id === taskId
              ? {
                  ...candidate,
                  provider,
                  model,
                  status: "completed" as const,
                  imagePath,
                  errorMessage: undefined,
                  updatedAt: new Date().toISOString(),
                }
              : candidate,
          );

          return latestState.conversation.id === conversationId
            ? createActiveTaskPatch(latestState, tasks)
            : {
                conversationTasks: {
                  ...latestState.conversationTasks,
                  [conversationId]: tasks,
                },
              };
        });
      } catch (error) {
        set((latestState) => {
          const latestTasks =
            latestState.conversationTasks[conversationId] ??
            (latestState.conversation.id === conversationId
              ? latestState.tasks
              : []);
          const tasks = latestTasks.map((candidate) =>
            candidate.id === taskId
              ? {
                  ...candidate,
                  status: "failed" as const,
                  errorMessage: getErrorMessage(error),
                  updatedAt: new Date().toISOString(),
                }
              : candidate,
          );

          return latestState.conversation.id === conversationId
            ? createActiveTaskPatch(latestState, tasks)
            : {
                conversationTasks: {
                  ...latestState.conversationTasks,
                  [conversationId]: tasks,
                },
              };
        });
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
  conversation: mockConversation,
  isConversationSaved: true,
  projects: [mockProject],
  conversations: [mockConversation],
  conversationTasks: {
    [mockConversation.id]: firstTasks,
  },
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
          ...normalizeSnapshot(snapshot, state.locale),
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
  createProject: (input) =>
    set((state) => {
      const project = createTimestampedProject(
        state,
        input?.title ??
          getUntitledProjectName(state.locale, state.projects.length + 1),
        input?.projectDirectory,
      );

      return createPendingWorkspacePatch(state, project);
    }),
  startNewConversation: (projectId) =>
    set((state) => {
      const projectRecord = projectId
        ? state.projects.find((candidate) => candidate.id === projectId)
        : state.project;
      if (!projectRecord) {
        return {};
      }

      return createPendingWorkspacePatch(state, projectRecord);
    }),
  openProject: (projectId) =>
    set((state) => {
      const projectRecord = state.projects.find(
        (candidate) => candidate.id === projectId,
      );
      if (!projectRecord) {
        return {};
      }

      const conversation = getLatestConversationForProject(
        state.conversations,
        projectId,
      );

      if (!conversation) {
        return createPendingWorkspacePatch(state, projectRecord);
      }

      const openedAt = new Date().toISOString();
      const touchedConversation = {
        ...conversation,
        updatedAt: openedAt,
      };
      const project = {
        ...mergeProjectWithConversation(projectRecord, touchedConversation),
        updatedAt: openedAt,
      };
      const tasks =
        state.conversationTasks[touchedConversation.id] ??
        createMockTasks(
          project,
          touchedConversation.originalPrompt,
          1,
          undefined,
          touchedConversation.id,
        );

      return createWorkspacePatch(state, project, touchedConversation, tasks);
    }),
  openConversation: (conversationId) =>
    set((state) => {
      const conversation = state.conversations.find(
        (candidate) => candidate.id === conversationId,
      );
      if (!conversation) {
        return {};
      }

      const projectRecord = state.projects.find(
        (candidate) => candidate.id === conversation.projectId,
      );
      if (!projectRecord) {
        return {};
      }

      const openedAt = new Date().toISOString();
      const touchedConversation = {
        ...conversation,
        updatedAt: openedAt,
      };
      const project = {
        ...mergeProjectWithConversation(projectRecord, touchedConversation),
        updatedAt: openedAt,
      };
      const tasks =
        state.conversationTasks[touchedConversation.id] ??
        createMockTasks(
          project,
          touchedConversation.originalPrompt,
          1,
          undefined,
          touchedConversation.id,
        );

      return createWorkspacePatch(state, project, touchedConversation, tasks);
    }),
  setProjectTitle: (title) =>
    set((state) => {
      const updatedAt = new Date().toISOString();
      const project = {
        ...state.project,
        title,
        updatedAt,
      };

      return {
        project,
        projects: upsertById(state.projects, project),
      };
    }),
  setConversationTitle: (title) =>
    set((state) => {
      const updatedAt = new Date().toISOString();
      const conversation = {
        ...state.conversation,
        title,
        updatedAt,
      };
      const project = {
        ...state.project,
        updatedAt,
      };

      return createActiveMetadataPatch(state, project, conversation);
    }),
  setOriginalPrompt: (originalPrompt) =>
    set((state) => {
      const updatedAt = new Date().toISOString();
      const project = {
        ...state.project,
        originalPrompt,
        updatedAt,
      };
      const conversation = {
        ...state.conversation,
        originalPrompt,
        updatedAt,
      };

      return createActiveMetadataPatch(state, project, conversation);
    }),
  setStyle: (style) =>
    set((state) => {
      const updatedAt = new Date().toISOString();
      const project = { ...state.project, style, updatedAt };
      const conversation = { ...state.conversation, style, updatedAt };

      return createActiveMetadataPatch(state, project, conversation);
    }),
  setAspectRatio: (aspectRatio) =>
    set((state) => {
      const updatedAt = new Date().toISOString();
      const project = {
        ...state.project,
        aspectRatio,
        updatedAt,
      };
      const conversation = {
        ...state.conversation,
        aspectRatio,
        updatedAt,
      };

      return createActiveMetadataPatch(state, project, conversation);
    }),
  setQuality: (quality) =>
    set((state) => {
      const updatedAt = new Date().toISOString();
      const project = {
        ...state.project,
        quality,
        updatedAt,
      };
      const conversation = {
        ...state.conversation,
        quality,
        updatedAt,
      };

      return createActiveMetadataPatch(state, project, conversation);
    }),
  setOutputSize: (outputSize) =>
    set((state) => {
      const updatedAt = new Date().toISOString();
      const project = {
        ...state.project,
        outputSize,
        updatedAt,
      };
      const conversation = {
        ...state.conversation,
        outputSize,
        updatedAt,
      };

      return createActiveMetadataPatch(state, project, conversation);
    }),
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
        undefined,
        state.conversation.id,
      );

      try {
        const analysis = await analyzePromptDirections(
          state.project,
          state.settings,
        );
        const title = createAnalysisConversationTitle(
          analysis.conversationTitle,
          state.project.originalPrompt,
          state.locale,
        );
        const updatedAt = new Date().toISOString();
        const conversation = state.isConversationSaved
          ? {
              ...state.conversation,
              title,
              originalPrompt: state.project.originalPrompt,
              style: state.project.style,
              gridSize: state.project.gridSize,
              aspectRatio: state.project.aspectRatio,
              quality: state.project.quality,
              outputSize: state.project.outputSize,
              updatedAt,
            }
          : {
              ...createTimestampedConversation(
                state.project,
                title,
                state.project.originalPrompt,
              ),
              updatedAt,
            };
        const project = {
          ...mergeProjectWithConversation(state.project, conversation),
          updatedAt,
        };
        const savedTasks = baseTasks.map((task) => ({
          ...task,
          projectId: project.id,
          conversationId: conversation.id,
        }));
        const provider = getConfiguredProviderLabel(state.settings);
        const model = getConfiguredImageModel(state.settings);
        const tasks = savedTasks.map((task, index) => ({
          ...task,
          prompt: analysis.directions[index]?.prompt || task.prompt,
          directionTitle: analysis.directions[index]?.title,
          provider,
          model,
          imagePath: undefined,
          errorMessage: undefined,
          status: "pending" as const,
          updatedAt: new Date().toISOString(),
        }));
        set((latestState) => ({
          ...createWorkspacePatch(latestState, project, conversation, tasks),
          selectedTaskId: tasks[0]?.id,
          isAnalyzing: false,
        }));
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        const tasks = baseTasks.map((task) => ({
          ...task,
          status: "failed" as const,
          errorMessage,
          updatedAt: new Date().toISOString(),
        }));
        set((latestState) => ({
          ...createActiveTaskPatch(latestState, tasks),
          selectedTaskId: tasks[0]?.id,
          isAnalyzing: false,
        }));
      }
    })();
  },
  generateImages: () => {
    const state = get();
    if (state.isAnalyzing || state.isGenerating || !state.isConversationSaved) {
      return;
    }

    const taskIds = state.tasks.map((task) => task.id);
    const conversationId = state.conversation.id;
    set((state) => {
      const tasks = state.tasks.map((task) => ({
        ...task,
        status: "pending" as const,
        errorMessage: undefined,
        updatedAt: new Date().toISOString(),
      }));

      return {
        ...createActiveTaskPatch(state, tasks),
        isGenerating: true,
      };
    });

    void runImageGeneration(get, set, taskIds, conversationId);
  },
  updateTaskPrompt: (taskId, prompt) =>
    set((state) => {
      const tasks = state.tasks.map((task) =>
        task.id === taskId
          ? { ...task, prompt, updatedAt: new Date().toISOString() }
          : task,
      );

      return createActiveTaskPatch(state, tasks);
    }),
  selectTask: (taskId) => set({ selectedTaskId: taskId }),
  previewTask: (taskId) => set({ previewTaskId: taskId }),
  regenerateTask: (taskId) => {
    if (get().isAnalyzing || get().isGenerating || !get().isConversationSaved) {
      return;
    }

    const conversationId = get().conversation.id;
    set((state) => {
      const tasks = state.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              attempt: task.attempt + 1,
              status: "running" as const,
              errorMessage: undefined,
              updatedAt: new Date().toISOString(),
            }
          : task,
      );

      return {
        ...createActiveTaskPatch(state, tasks),
        isGenerating: true,
      };
    });

    void runImageGeneration(get, set, [taskId], conversationId);
  },
  retryTask: (taskId) => {
    if (get().isAnalyzing || get().isGenerating || !get().isConversationSaved) {
      return;
    }

    const conversationId = get().conversation.id;
    set((state) => {
      const tasks = state.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: "running" as const,
              errorMessage: undefined,
              updatedAt: new Date().toISOString(),
            }
          : task,
      );

      return {
        ...createActiveTaskPatch(state, tasks),
        isGenerating: true,
      };
    });

    void runImageGeneration(get, set, [taskId], conversationId);
  },
  expandFromTask: (taskId) => {
    const state = get();
    if (state.isAnalyzing || state.isGenerating || !state.isConversationSaved) {
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
      state.conversation.id,
    ).map((task, index) => ({
      ...task,
      directionTitle: undefined,
      visual: mockVisuals[(index + nextRound) % mockVisuals.length],
    }));

    set((state) => ({
      ...createActiveTaskPatch(state, tasks),
      currentRound: nextRound,
      selectedTaskId: tasks[0]?.id,
      previewTaskId: undefined,
    }));
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

let lastDebugLoggingSignature = "";

usePromptGridStore.subscribe((state) => {
  if (!state.isHydrated || state.isHydrating) {
    return;
  }

  const retentionDays = clampDebugLogRetentionDays(
    state.settings.debugLogRetentionDays,
  );
  const signature = JSON.stringify({
    enabled: state.settings.debugLoggingEnabled,
    retentionDays,
  });
  if (signature === lastDebugLoggingSignature) {
    return;
  }

  lastDebugLoggingSignature = signature;
  void configureDebugLogging({
    enabled: state.settings.debugLoggingEnabled,
    retentionDays,
  }).catch(() => undefined);
});
