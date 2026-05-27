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
import {
  createWorkflowTemplateVariables,
  getWorkflowConfig,
  loadExternalWorkflowConfigs,
  renderWorkflowAnalysisTemplate,
} from "../modules/workflows/workflowConfig";
import type {
  AppSettings,
  AppSnapshot,
  AspectRatio,
  Conversation,
  GridCell,
  ImageAsset,
  ImageReference,
  MainDetailState,
  GridSize,
  OutputSize,
  Project,
  Quality,
  WorkflowMode,
} from "../types";

type ActiveSection = "projects" | "settings";
type StorageStatus = "idle" | "loading" | "saving" | "saved" | "error";
type LegacyConversation = Partial<Conversation> & {
  parentConversationId?: string;
};
type LegacyGridRunConversation = {
  conversationId: string;
  parentConversationId: string;
  gridSize: GridSize;
};

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
  workflowMode: WorkflowMode;
  mainDetail: MainDetailState;
  hydrate: () => Promise<void>;
  setActiveSection: (section: ActiveSection) => void;
  setWorkflowMode: (mode: WorkflowMode) => void;
  setLocale: (locale: Locale) => void;
  setColorTheme: (colorTheme: ColorTheme) => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
  setSourceImage: (asset?: ImageAsset) => void;
  createProject: (input?: { title?: string; projectDirectory?: string }) => void;
  startNewConversation: (projectId?: string) => void;
  openProject: (projectId: string) => void;
  openConversation: (conversationId: string) => void;
  setProjectTitle: (title: string) => void;
  renameProject: (projectId: string, title: string) => void;
  removeProject: (projectId: string) => void;
  setConversationTitle: (title: string) => void;
  setOriginalPrompt: (prompt: string) => void;
  setStyle: (style: string) => void;
  setGridSize: (gridSize: GridSize) => void;
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
  analyzeMainDetailPrompt: () => void;
  generateMainImage: () => void;
  generateDetailImages: () => void;
};

const firstTasks = createMockTasks(
  mockProject,
  mockProject.originalPrompt,
  1,
  undefined,
  mockConversation.id,
);
const firstSelectedTaskId = firstTasks[0]?.id;

const emptyMainDetailState: MainDetailState = {
  detailTaskIds: [],
};

function getGridRunKey(conversationId: string, gridSize: GridSize) {
  return `${conversationId}::grid-${gridSize}`;
}

function getConversationIdFromTaskKey(taskKey: string) {
  return taskKey.split("::grid-")[0];
}

function getGridSizeFromTaskKey(taskKey: string): GridSize | undefined {
  const rawGridSize = Number(taskKey.split("::grid-")[1]);
  return isGridSize(rawGridSize) ? rawGridSize : undefined;
}

function isGridSize(value: unknown): value is GridSize {
  return value === 6 || value === 9 || value === 16 || value === 25;
}

function createSnapshot(state: PromptGridState): AppSnapshot {
  const projects = upsertById(state.projects, state.project);
  const conversations = state.isConversationSaved
    ? upsertById(state.conversations, state.conversation)
    : state.conversations;
  const conversationTasks = state.isConversationSaved
    ? {
        ...state.conversationTasks,
        [getGridRunKey(state.conversation.id, state.project.gridSize)]: state.tasks,
      }
    : state.conversationTasks;
  const snapshotConversation = state.isConversationSaved
    ? state.conversation
    : getLatestConversationForProject(conversations, state.project.id);
  const snapshotTasks = snapshotConversation
    ? conversationTasks[
        getGridRunKey(snapshotConversation.id, snapshotConversation.gridSize)
      ] ?? []
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
    workflowMode: state.workflowMode,
  };
}

function createSnapshotSignature(state: PromptGridState) {
  const conversationTasks = state.isConversationSaved
    ? {
        ...state.conversationTasks,
        [getGridRunKey(state.conversation.id, state.project.gridSize)]: state.tasks,
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
    workflowMode: state.workflowMode,
    mainDetail: state.mainDetail,
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
        task.gridSize ?? "",
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
        task.role ?? "",
        getReferenceImagesSignature(task.referenceImages),
        task.dependsOnTaskId ?? "",
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

function getReferenceImagesSignature(referenceImages?: ImageReference[]) {
  return (referenceImages ?? [])
    .map((reference) =>
      [
        reference.id,
        reference.role,
        getImagePathSignature(reference.imagePath),
        reference.name ?? "",
      ].join("\u001f"),
    )
    .join("\u001e");
}

function normalizeSnapshot(snapshot: AppSnapshot, locale: Locale) {
  const baseProject = normalizeProject(snapshot.project);
  const rawSnapshotConversation = snapshot.conversation as
    | LegacyConversation
    | undefined;
  const rawConversations = (
    snapshot.conversations?.length ? snapshot.conversations : []
  ) as LegacyConversation[];
  const legacyGridRuns = getLegacyGridRunConversations([
    ...rawConversations,
    ...(rawSnapshotConversation ? [rawSnapshotConversation] : []),
  ]);
  const legacyGridRunLookup = Object.fromEntries(
    legacyGridRuns.map((legacy) => [legacy.conversationId, legacy]),
  );
  const snapshotConversation =
    rawSnapshotConversation && !isLegacyGridRunConversation(rawSnapshotConversation)
      ? normalizeConversation(rawSnapshotConversation, baseProject)
    : undefined;
  const conversations = rawConversations.length
    ? rawConversations
        .filter((conversation) => !isLegacyGridRunConversation(conversation))
        .map((conversation) =>
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

  const rawActiveConversationId =
    snapshot.activeConversationId ?? snapshotConversation?.id;
  const activeLegacyGridRun = rawActiveConversationId
    ? legacyGridRunLookup[rawActiveConversationId]
    : undefined;
  const activeConversationId =
    activeLegacyGridRun?.parentConversationId ?? rawActiveConversationId;
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
    ? {
        ...mergeProjectWithConversation(projectRecord, savedConversation),
        gridSize: activeLegacyGridRun?.gridSize ?? savedConversation.gridSize,
      }
    : projectRecord;
  const conversation =
    savedConversation ?? createPendingConversation(project, locale);
  const conversationTasks = normalizeConversationTasks(
    snapshot.conversationTasks,
    normalizedConversations,
    projects,
    legacyGridRunLookup,
  );

  const activeGridRunKey = getGridRunKey(conversation.id, project.gridSize);
  if (savedConversation && !conversationTasks[activeGridRunKey] && snapshot.tasks.length > 0) {
    conversationTasks[activeGridRunKey] = normalizeTaskReferences(
      snapshot.tasks,
      project.id,
      conversation.id,
      project.gridSize,
    );
  }

  const tasks = savedConversation
    ? conversationTasks[activeGridRunKey] ??
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
  const workflowMode =
    snapshot.workflowMode ?? conversation.workflowMode ?? "text-grid";
  const mainDetail = normalizeMainDetailState(conversation.mainDetail);

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
          [getGridRunKey(conversation.id, project.gridSize)]: tasks,
        }
      : conversationTasks,
    tasks,
    settings: normalizeSettings(snapshot.settings),
    selectedTaskId,
    previewTaskId: undefined,
    currentRound: savedConversation ? Math.max(snapshot.currentRound, highestRound) : 1,
    workflowMode,
    mainDetail,
  };
}

function normalizeConversationTasks(
  conversationTasks: AppSnapshot["conversationTasks"],
  conversations: Conversation[],
  projects: Project[],
  legacyGridRunLookup: Record<string, LegacyGridRunConversation> = {},
) {
  const normalized: Record<string, GridCell[]> = {};

  for (const [taskKey, tasks] of Object.entries(conversationTasks ?? {})) {
    const taskConversationId = getConversationIdFromTaskKey(taskKey);
    const legacyGridRun = legacyGridRunLookup[taskConversationId];
    const conversationId = legacyGridRun?.parentConversationId ?? taskConversationId;
    const conversation = conversations.find(
      (candidate) => candidate.id === conversationId,
    );
    const projectId = conversation?.projectId ?? projects[0]?.id ?? mockProject.id;
    const taskGridSize = normalizeTaskGridSize(
      tasks,
      conversation?.gridSize ?? projects[0]?.gridSize,
    );
    const gridSize =
      legacyGridRun?.gridSize ??
      taskGridSize ??
      getGridSizeFromTaskKey(taskKey) ??
      conversation?.gridSize ??
      projects[0]?.gridSize ??
      mockProject.gridSize;
    const normalizedKey = getGridRunKey(conversationId, gridSize);
    normalized[normalizedKey] = normalizeTaskReferences(
      tasks,
      projectId,
      conversationId,
      gridSize,
    );
  }

  return normalized;
}

function getLegacyGridRunConversations(
  conversations: LegacyConversation[],
): LegacyGridRunConversation[] {
  const seen = new Set<string>();
  const legacy: LegacyGridRunConversation[] = [];
  const rootConversations = conversations
    .filter((conversation) => !getLegacyConversationGridSize(conversation))
    .sort((left, right) =>
      (left.createdAt ?? "").localeCompare(right.createdAt ?? ""),
    );

  for (const conversation of conversations) {
    const gridSize = getLegacyConversationGridSize(conversation);
    if (!conversation.id || !gridSize) {
      continue;
    }
    if (seen.has(conversation.id)) {
      continue;
    }
    const parentConversationId =
      conversation.parentConversationId ??
      getNearestRootConversationId(conversation, rootConversations);
    if (!parentConversationId) {
      continue;
    }
    seen.add(conversation.id);
    legacy.push({
      conversationId: conversation.id,
      parentConversationId,
      gridSize,
    });
  }
  return legacy;
}

function isLegacyGridRunConversation(
  conversation: LegacyConversation,
): boolean {
  return Boolean(getLegacyConversationGridSize(conversation));
}

function getLegacyConversationGridSize(
  conversation: LegacyConversation,
): GridSize | undefined {
  if (conversation.parentConversationId && isGridSize(conversation.gridSize)) {
    return conversation.gridSize;
  }

  const title = conversation.title?.trim();
  if (!title) {
    return undefined;
  }

  const match = title.match(/^(6|9|16|25)(?:\s*宫格|-Cell Grid)$/);
  if (!match) {
    return undefined;
  }

  const gridSize = Number(match[1]);
  return isGridSize(gridSize) ? gridSize : undefined;
}

function getNearestRootConversationId(
  conversation: LegacyConversation,
  rootConversations: LegacyConversation[],
) {
  const sameProjectRoots = rootConversations.filter(
    (candidate) => candidate.projectId === conversation.projectId && candidate.id,
  );
  if (sameProjectRoots.length === 0) {
    return undefined;
  }

  const createdAt = conversation.createdAt ?? "";
  return (
    [...sameProjectRoots]
      .filter((candidate) => !createdAt || (candidate.createdAt ?? "") <= createdAt)
      .sort((left, right) =>
        (right.createdAt ?? "").localeCompare(left.createdAt ?? ""),
      )[0]?.id ?? sameProjectRoots[0].id
  );
}

function normalizeTaskGridSize(
  tasks: GridCell[],
  fallbackGridSize: GridSize | undefined,
): GridSize | undefined {
  if (isGridSize(tasks.length)) {
    return tasks.length;
  }

  const taskGridSize = tasks.find((task) => isGridSize(task.gridSize))?.gridSize;
  return taskGridSize ?? fallbackGridSize;
}

function normalizeTaskReferences(
  tasks: GridCell[],
  projectId: string,
  conversationId: string,
  gridSize: GridSize,
) {
  return tasks.map((task) => ({
    ...task,
    projectId: task.projectId || projectId,
    conversationId: task.conversationId || conversationId,
    gridSize: task.gridSize ?? gridSize,
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
    workflowMode: conversation.workflowMode ?? "text-grid",
    mainDetail: normalizeMainDetailState(conversation.mainDetail),
    configurationLocked: conversation.configurationLocked ?? false,
  };
}

function normalizeMainDetailState(
  mainDetail: Partial<MainDetailState> | undefined,
): MainDetailState {
  return {
    sourceImage: mainDetail?.sourceImage,
    mainTaskId: mainDetail?.mainTaskId,
    detailTaskIds: mainDetail?.detailTaskIds ?? [],
    promptAnalyzedAt: mainDetail?.promptAnalyzedAt,
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
    configurationLocked: false,
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

function lockConversationConfiguration(
  conversation: Conversation,
  updatedAt: string,
): Conversation {
  return {
    ...conversation,
    configurationLocked: true,
    updatedAt,
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

function sortByUpdatedAt<T extends { updatedAt: string }>(items: T[]) {
  return [...items].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
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
      [getGridRunKey(conversation.id, project.gridSize)]: tasks,
    },
    tasks,
    selectedTaskId: tasks[0]?.id,
    previewTaskId: undefined,
    currentRound: getHighestRound(tasks),
    activeSection: "projects" as const,
    isConversationSaved: true,
    workflowMode: conversation.workflowMode ?? state.workflowMode,
    mainDetail: normalizeMainDetailState(conversation.mainDetail),
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
    workflowMode: conversation.workflowMode ?? "text-grid",
    mainDetail: normalizeMainDetailState(conversation.mainDetail),
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

function createConfigurationLockPatch(
  state: PromptGridState,
  workflowMode: WorkflowMode,
  mainDetail: MainDetailState,
) {
  const updatedAt = new Date().toISOString();
  const baseConversation = state.isConversationSaved
    ? state.conversation
    : createTimestampedConversation(
        state.project,
        state.conversation.title || getUntitledConversationName(state.locale, 1),
        state.project.originalPrompt,
      );
  const conversation = lockConversationConfiguration(
    {
      ...baseConversation,
      originalPrompt: state.project.originalPrompt,
      style: state.project.style,
      gridSize: state.project.gridSize,
      aspectRatio: state.project.aspectRatio,
      quality: state.project.quality,
      outputSize: state.project.outputSize,
      workflowMode,
      mainDetail,
    },
    updatedAt,
  );
  const project = {
    ...mergeProjectWithConversation(state.project, conversation),
    updatedAt,
  };
  const tasks = state.tasks.map((task) => ({
    ...task,
    projectId: project.id,
    conversationId: conversation.id,
    gridSize: project.gridSize,
    updatedAt,
  }));

  return {
    ...createWorkspacePatch(state, project, conversation, tasks),
    workflowMode,
    mainDetail,
  };
}

function createEmptyGridTasks(
  state: PromptGridState,
  project: Project,
  conversation: Conversation,
) {
  const createdAt = new Date().toISOString();
  const provider = getConfiguredProviderLabel(state.settings);
  const model = getConfiguredImageModel(state.settings);
  const mainTaskId = `grid-main-${Date.now()}`;

  return Array.from({ length: project.gridSize }, (_, index): GridCell => ({
    id:
      state.workflowMode === "main-detail" && index === 0
        ? mainTaskId
        : `conversation-${conversation.id}-cell-${index + 1}-${Date.now()}`,
    projectId: project.id,
    conversationId: conversation.id,
    gridSize: project.gridSize,
    explorationRound: 1,
    index,
    prompt: "",
    directionTitle: undefined,
    status: "pending",
    imagePath: undefined,
    errorMessage: undefined,
    provider,
    model,
    createdAt,
    updatedAt: createdAt,
    attempt: 1,
    visual: mockVisuals[index % mockVisuals.length],
    role:
      state.workflowMode === "main-detail"
        ? index === 0
          ? "main"
          : "detail"
        : "grid",
    dependsOnTaskId:
      state.workflowMode === "main-detail" && index > 0 ? mainTaskId : undefined,
  }));
}

function createEmptyMainDetailState(tasks: GridCell[]): MainDetailState {
  return {
    mainTaskId: tasks.find((task) => task.role === "main")?.id,
    detailTaskIds: tasks
      .filter((task) => task.role === "detail")
      .map((task) => task.id),
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
      [getGridRunKey(conversation.id, project.gridSize)]: tasks,
    },
  };
}

function createMainDetailTasks(state: PromptGridState) {
  const createdAt = new Date().toISOString();
  const sourceImage = state.mainDetail.sourceImage;
  const sourceReference = sourceImage
    ? [createImageReference(sourceImage, "source" as const)]
    : [];
  const mainTaskId =
    state.mainDetail.mainTaskId ?? `main-detail-main-${Date.now()}`;
  const detailPrompts = createDetailPrompts(
    state.project.originalPrompt,
    Math.max(0, state.project.gridSize - 1),
  );
  const provider = getConfiguredProviderLabel(state.settings);
  const model = getConfiguredImageModel(state.settings);
  const mainTask: GridCell = {
    id: mainTaskId,
    projectId: state.project.id,
    conversationId: state.conversation.id,
    gridSize: state.project.gridSize,
    explorationRound: state.currentRound,
    index: 0,
    prompt: createMainImagePrompt(state.project.originalPrompt, state.project.style),
    directionTitle: "Main Image",
    status: "pending",
    provider,
    model,
    createdAt,
    updatedAt: createdAt,
    attempt: 1,
    visual: mockVisuals[0],
    role: "main",
    referenceImages: sourceReference,
  };
  const detailTasks = detailPrompts.map((prompt, index) => ({
    id: `main-detail-detail-${index + 1}-${Date.now()}`,
    projectId: state.project.id,
    conversationId: state.conversation.id,
    gridSize: state.project.gridSize,
    explorationRound: state.currentRound,
    index: index + 1,
    prompt,
    directionTitle: getDetailDirectionTitle(index),
    status: "pending" as const,
    provider,
    model,
    createdAt,
    updatedAt: createdAt,
    attempt: 1,
    visual: mockVisuals[(index + 1) % mockVisuals.length],
    role: "detail" as const,
    referenceImages: [],
    dependsOnTaskId: mainTask.id,
  }));
  const tasks = [mainTask, ...detailTasks];
  const mainDetail = {
    ...state.mainDetail,
    mainTaskId: mainTask.id,
    detailTaskIds: detailTasks.map((task) => task.id),
  };

  return { tasks, mainDetail };
}

function createImageReference(
  asset: ImageAsset,
  role: ImageReference["role"],
): ImageReference {
  return {
    id: asset.id,
    role,
    imagePath: asset.imagePath,
    name: asset.name,
  };
}

function createMainImageReference(mainTask: GridCell): ImageReference[] {
  if (!mainTask.imagePath) {
    return [];
  }

  return [
    {
      id: `main-reference-${mainTask.id}`,
      role: "main",
      imagePath: mainTask.imagePath,
      name: mainTask.directionTitle ?? "Main image",
    },
  ];
}

function createAnalyzedMainDetailTasks(
  state: PromptGridState,
  analysis?: { conversationTitle?: string; directions?: Array<{ prompt: string; title: string }> },
) {
  const { tasks, mainDetail } = createMainDetailTasks(state);
  const mainDirection = analysis?.directions?.[0];
  const detailDirections = analysis?.directions?.slice(1) ?? [];
  const analyzedTasks = tasks.map((task) => {
    if (task.role === "main") {
      return {
        ...task,
        prompt: mainDirection?.prompt || task.prompt,
        directionTitle: mainDirection?.title || task.directionTitle,
        status: "pending" as const,
        imagePath: undefined,
        errorMessage: undefined,
      };
    }

    const detailDirection = detailDirections[task.index - 1];
    return {
      ...task,
      prompt: detailDirection?.prompt || task.prompt,
      directionTitle: detailDirection?.title || task.directionTitle,
      status: "pending" as const,
      imagePath: undefined,
      errorMessage: undefined,
    };
  });

  return {
    tasks: analyzedTasks,
    mainDetail: {
      ...mainDetail,
      promptAnalyzedAt: new Date().toISOString(),
    },
  };
}

function createMainDetailAnalysisProject(state: PromptGridState): Project {
  return {
    ...state.project,
  };
}

function createWorkflowAnalysisPrompt(
  state: PromptGridState,
  workflowMode: WorkflowMode,
  project: Project,
) {
  const workflow = getWorkflowConfig(state.settings.workflowConfigs, workflowMode);
  if (!workflow.analysisTemplate.trim()) {
    throw new Error(`Workflow analysis template is not configured: ${workflow.name}`);
  }

  return renderWorkflowAnalysisTemplate(
    workflow.analysisTemplate,
    createWorkflowTemplateVariables({
      project,
      hasSourceImage: Boolean(state.mainDetail.sourceImage),
    }),
  );
}

function mergeExternalWorkflowConfigs(
  state: PromptGridState,
  workflowConfigs: AppSettings["workflowConfigs"] | undefined,
) {
  if (!workflowConfigs) {
    return {};
  }

  const currentSignature = JSON.stringify(state.settings.workflowConfigs);
  const defaultSignature = JSON.stringify(mockSettings.workflowConfigs);
  if (currentSignature !== defaultSignature) {
    return {};
  }

  return {
    settings: {
      ...state.settings,
      workflowConfigs,
    },
  };
}

function createMainImagePrompt(originalPrompt: string, style: string) {
  const subject = originalPrompt.trim() || "the uploaded product";
  return [
    subject,
    "Create one polished ecommerce hero main image based on the uploaded source image.",
    `Visual style: ${style}.`,
    "Keep the product identity, shape, material, and key visual traits consistent.",
    "Use a clean commercial composition with clear focal hierarchy and premium lighting.",
  ].join(" ");
}

function createDetailPrompts(originalPrompt: string, detailCount: number) {
  const subject = originalPrompt.trim() || "the product from the source image";
  const directions = [
    "material close-up detail image with texture and finish clearly visible",
    "functional feature detail image that explains the strongest selling point",
    "in-use lifestyle detail scene with the product naturally placed",
    "packaging and accessory detail image arranged cleanly for ecommerce",
    "scale and structure detail image showing proportions and key parts",
    "comparison or before-after detail image that clarifies product value",
    "premium atmosphere detail image for a product detail page banner",
    "minimal isolated detail image with crisp shadows and high readability",
  ];

  return Array.from({ length: detailCount }, (_, index) => {
    const direction = directions[index % directions.length];
    const variation =
      index < directions.length
        ? ""
        : ` Alternative detail angle ${Math.floor(index / directions.length) + 1}.`;

    return `${subject}. Generate a ${direction}. Maintain product consistency with the uploaded source image and main image.${variation}`;
  });
}

function getDetailDirectionTitle(index: number) {
  const titles = [
    "Material Detail",
    "Feature Detail",
    "Lifestyle Detail",
    "Packaging Detail",
    "Scale Detail",
    "Value Detail",
    "Atmosphere Detail",
    "Isolated Detail",
  ];

  return titles[index] ?? `Detail ${index + 1}`;
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
  const gridSize = get().project.gridSize;
  const taskKey = getGridRunKey(conversationId, gridSize);
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
          state.conversationTasks[taskKey] ??
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
                [taskKey]: tasks,
              },
            };
      });

      const state = get();
      const sourceTasks =
        state.conversationTasks[taskKey] ??
        (state.conversation.id === conversationId ? state.tasks : []);
      const task = sourceTasks.find((candidate) => candidate.id === taskId);
      if (!task) {
        continue;
      }

      try {
        const image = await generatePromptImage({
          prompt: task.prompt,
          project: state.project,
          settings: state.settings,
          referenceImages: task.referenceImages,
        });
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
            latestState.conversationTasks[taskKey] ??
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
                  [taskKey]: tasks,
                },
              };
        });
      } catch (error) {
        set((latestState) => {
          const latestTasks =
            latestState.conversationTasks[taskKey] ??
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
                  [taskKey]: tasks,
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
    [getGridRunKey(mockConversation.id, mockProject.gridSize)]: firstTasks,
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
  workflowMode: "text-grid",
  mainDetail: emptyMainDetailState,
  hydrate: async () => {
    const state = get();
    if (state.isHydrated || state.isHydrating) {
      return;
    }

    set({ isHydrating: true, storageStatus: "loading" });

    try {
      const [snapshot, externalWorkflowConfigs] = await Promise.all([
        loadWorkspaceSnapshot(),
        loadExternalWorkflowConfigs().catch(() => undefined),
      ]);
      if (snapshot) {
        const normalizedState = normalizeSnapshot(snapshot, state.locale);
        set((state) => ({
          ...normalizedState,
          ...mergeExternalWorkflowConfigs(
            {
              ...state,
              ...normalizedState,
            },
            externalWorkflowConfigs,
          ),
          isHydrated: true,
          isHydrating: false,
          storageStatus: "saved",
        }));
        return;
      }

      set((state) => ({
        ...mergeExternalWorkflowConfigs(state, externalWorkflowConfigs),
        isHydrated: true,
        isHydrating: false,
        storageStatus: "saved",
      }));
    } catch {
      set({
        isHydrated: true,
        isHydrating: false,
        storageStatus: "error",
      });
    }
  },
  setActiveSection: (activeSection) => set({ activeSection }),
  setWorkflowMode: (workflowMode) =>
    set((state) => {
      if (
        state.conversation.configurationLocked ||
        state.isAnalyzing ||
        state.isGenerating ||
        state.workflowMode === workflowMode
      ) {
        return {};
      }

      const updatedAt = new Date().toISOString();
      const conversation = {
        ...state.conversation,
        workflowMode,
        mainDetail: state.mainDetail,
        updatedAt,
      };
      const project = {
        ...state.project,
        updatedAt,
      };

      return {
        ...createActiveMetadataPatch(state, project, conversation),
        workflowMode,
      };
    }),
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
  setSourceImage: (asset) =>
    set((state) => {
      if (state.conversation.configurationLocked) {
        return {};
      }

      const updatedAt = new Date().toISOString();
      const mainDetail = {
        ...state.mainDetail,
        sourceImage: asset,
        promptAnalyzedAt: undefined,
      };
      const conversation = {
        ...state.conversation,
        mainDetail,
        workflowMode: "main-detail" as const,
        updatedAt,
      };
      const project = {
        ...state.project,
        updatedAt,
      };

      return {
        ...createActiveMetadataPatch(state, project, conversation),
        workflowMode: "main-detail" as const,
        mainDetail,
      };
    }),
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

      const project = mergeProjectWithConversation(projectRecord, conversation);
      const taskKey = getGridRunKey(conversation.id, project.gridSize);
      const tasks =
        state.conversationTasks[taskKey] ??
        createMockTasks(
          project,
          conversation.originalPrompt,
          1,
          undefined,
          conversation.id,
        );

      return createWorkspacePatch(state, project, conversation, tasks);
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

      const project = mergeProjectWithConversation(projectRecord, conversation);
      const taskKey = getGridRunKey(conversation.id, project.gridSize);
      const tasks =
        state.conversationTasks[taskKey] ??
        createMockTasks(
          project,
          conversation.originalPrompt,
          1,
          undefined,
          conversation.id,
        );

      return createWorkspacePatch(state, project, conversation, tasks);
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
  renameProject: (projectId, title) =>
    set((state) => {
      const projectRecord = state.projects.find(
        (candidate) => candidate.id === projectId,
      );
      const trimmedTitle = title.trim();
      if (
        !projectRecord ||
        !trimmedTitle ||
        state.projects.some(
          (candidate) =>
            candidate.id !== projectId &&
            candidate.title.trim().toLocaleLowerCase() ===
              trimmedTitle.toLocaleLowerCase(),
        )
      ) {
        return {};
      }

      const updatedAt = new Date().toISOString();
      const renamedProject = {
        ...projectRecord,
        title: trimmedTitle,
        updatedAt,
      };

      return {
        project:
          state.project.id === projectId
            ? {
                ...state.project,
                title: trimmedTitle,
                updatedAt,
              }
            : state.project,
        projects: upsertById(state.projects, renamedProject),
      };
    }),
  removeProject: (projectId) =>
    set((state) => {
      const remainingProjects = state.projects.filter(
        (candidate) => candidate.id !== projectId,
      );
      const remainingConversations = state.conversations.filter(
        (candidate) => candidate.projectId !== projectId,
      );
      const conversationTasks = Object.fromEntries(
        Object.entries(state.conversationTasks).filter(([taskKey]) =>
          remainingConversations.some(
            (conversation) => conversation.id === getConversationIdFromTaskKey(taskKey),
          ),
        ),
      );

      if (state.project.id !== projectId) {
        return {
          projects: remainingProjects,
          conversations: remainingConversations,
          conversationTasks,
        };
      }

      const nextProject =
        sortByUpdatedAt(remainingProjects)[0] ??
        createTimestampedProject(
          {
            ...state,
            projects: remainingProjects,
          },
          getUntitledProjectName(state.locale, 1),
        );
      const nextConversation = getLatestConversationForProject(
        remainingConversations,
        nextProject.id,
      );

      if (!nextConversation) {
        const pendingPatch = createPendingWorkspacePatch(
          {
            ...state,
            projects: remainingProjects,
            conversations: remainingConversations,
            conversationTasks,
          },
          nextProject,
        );

        return {
          ...pendingPatch,
          projects: upsertById(remainingProjects, pendingPatch.project),
          conversations: remainingConversations,
          conversationTasks: {
            ...conversationTasks,
            [getGridRunKey(
              pendingPatch.conversation.id,
              pendingPatch.project.gridSize,
            )]: pendingPatch.tasks,
          },
        };
      }

      const project = mergeProjectWithConversation(nextProject, nextConversation);
      const taskKey = getGridRunKey(nextConversation.id, project.gridSize);
      const tasks =
        conversationTasks[taskKey] ??
        createMockTasks(
          project,
          nextConversation.originalPrompt,
          1,
          undefined,
          nextConversation.id,
        );

      return {
        ...createWorkspacePatch(
          {
            ...state,
            projects: remainingProjects,
            conversations: remainingConversations,
            conversationTasks,
          },
          project,
          nextConversation,
          tasks,
        ),
        projects: remainingProjects,
        conversations: remainingConversations,
        conversationTasks: {
          ...conversationTasks,
          [taskKey]: tasks,
        },
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
      if (state.conversation.configurationLocked) {
        return {};
      }

      const updatedAt = new Date().toISOString();
      const mainDetail =
        state.workflowMode === "main-detail"
          ? {
              ...state.mainDetail,
              promptAnalyzedAt: undefined,
            }
          : state.mainDetail;
      const project = {
        ...state.project,
        originalPrompt,
        updatedAt,
      };
      const conversation = {
        ...state.conversation,
        originalPrompt,
        mainDetail,
        updatedAt,
      };

      return {
        ...createActiveMetadataPatch(state, project, conversation),
        mainDetail,
      };
    }),
  setStyle: (style) =>
    set((state) => {
      if (state.conversation.configurationLocked) {
        return {};
      }

      const updatedAt = new Date().toISOString();
      const project = { ...state.project, style, updatedAt };
      const conversation = { ...state.conversation, style, updatedAt };

      return createActiveMetadataPatch(state, project, conversation);
    }),
  setGridSize: (gridSize) =>
    set((state) => {
      if (
        state.conversation.configurationLocked ||
        state.isAnalyzing ||
        state.isGenerating ||
        state.project.gridSize === gridSize
      ) {
        return {};
      }

      const updatedAt = new Date().toISOString();
      const currentTaskKey = getGridRunKey(
        state.conversation.id,
        state.project.gridSize,
      );
      const conversation = {
        ...state.conversation,
        gridSize,
        workflowMode: state.workflowMode,
        updatedAt,
      };
      const project = {
        ...state.project,
        gridSize,
        updatedAt,
      };
      const nextTaskKey = getGridRunKey(conversation.id, gridSize);
      const nextTasks =
        state.conversationTasks[nextTaskKey] ??
        createEmptyGridTasks(state, project, conversation);
      const mainDetail =
        state.workflowMode === "main-detail"
          ? createEmptyMainDetailState(nextTasks)
          : emptyMainDetailState;
      const nextConversation = {
        ...conversation,
        mainDetail,
      };

      if (state.isConversationSaved) {
        const preservedConversationTasks = {
          ...state.conversationTasks,
          [currentTaskKey]: state.tasks,
          [nextTaskKey]: nextTasks,
        };

        return {
          project,
          conversation: nextConversation,
          projects: upsertById(state.projects, project),
          conversations: upsertById(state.conversations, nextConversation),
          conversationTasks: preservedConversationTasks,
          tasks: nextTasks,
          workflowMode: state.workflowMode,
          mainDetail,
          selectedTaskId: nextTasks[0]?.id,
          previewTaskId: undefined,
          currentRound: getHighestRound(nextTasks),
          activeSection: "projects" as const,
          isConversationSaved: true,
        };
      }

      return createWorkspacePatch(
        state,
        project,
        nextConversation,
        nextTasks,
      );
    }),
  setAspectRatio: (aspectRatio) =>
    set((state) => {
      if (state.conversation.configurationLocked) {
        return {};
      }

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
      if (state.conversation.configurationLocked) {
        return {};
      }

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
      if (state.conversation.configurationLocked) {
        return {};
      }

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

    set((state) => ({
      ...createConfigurationLockPatch(
        state,
        "text-grid",
        emptyMainDetailState,
      ),
      isAnalyzing: true,
    }));
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
          createWorkflowAnalysisPrompt(state, "text-grid", state.project),
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
              configurationLocked: true,
              updatedAt,
            }
          : {
              ...createTimestampedConversation(
                state.project,
                title,
                state.project.originalPrompt,
              ),
              configurationLocked: true,
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
  analyzeMainDetailPrompt: () => {
    if (get().isAnalyzing || get().isGenerating) {
      return;
    }

    set((state) => ({
      ...createConfigurationLockPatch(
        state,
        "main-detail",
        state.mainDetail,
      ),
      isAnalyzing: true,
    }));
    void (async () => {
      const state = get();

      try {
        const analysisProject = createMainDetailAnalysisProject(state);
        const analysis = await analyzePromptDirections(
          analysisProject,
          state.settings,
          createWorkflowAnalysisPrompt(state, "main-detail", analysisProject),
        );
        const { tasks, mainDetail } = createAnalyzedMainDetailTasks(
          state,
          analysis,
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
              workflowMode: "main-detail" as const,
              mainDetail,
              configurationLocked: true,
              updatedAt,
            }
          : {
              ...createTimestampedConversation(
                state.project,
                title,
                state.project.originalPrompt,
              ),
              workflowMode: "main-detail" as const,
              mainDetail,
              configurationLocked: true,
              updatedAt,
            };
        const project = {
          ...mergeProjectWithConversation(state.project, conversation),
          updatedAt,
        };

        set((latestState) => ({
          ...createActiveTaskPatch(
            {
              ...latestState,
              project,
              conversation,
              isConversationSaved: true,
            },
            tasks,
            updatedAt,
          ),
          conversations: upsertById(latestState.conversations, conversation),
          workflowMode: "main-detail" as const,
          mainDetail,
          selectedTaskId: tasks[0]?.id,
          previewTaskId: undefined,
          isConversationSaved: true,
          isAnalyzing: false,
        }));
      } catch (error) {
        const { tasks, mainDetail } = createAnalyzedMainDetailTasks(state);
        const errorMessage = getErrorMessage(error);
        const failedTasks = tasks.map((task) => ({
          ...task,
          status: "failed" as const,
          errorMessage,
          updatedAt: new Date().toISOString(),
        }));

        set((latestState) => ({
          ...createActiveTaskPatch(latestState, failedTasks),
          workflowMode: "main-detail" as const,
          mainDetail,
          selectedTaskId: failedTasks[0]?.id,
          previewTaskId: undefined,
          isAnalyzing: false,
        }));
      }
    })();
  },
  generateMainImage: () => {
    const state = get();
    if (state.isAnalyzing || state.isGenerating) {
      return;
    }

    if (state.workflowMode !== "main-detail" || !state.mainDetail.promptAnalyzedAt) {
      return;
    }

    let mainTask = state.tasks.find((task) => task.role === "main");
    if (!mainTask) {
      const { tasks, mainDetail } = createMainDetailTasks(state);
      const updatedAt = new Date().toISOString();
      const conversation = {
        ...state.conversation,
        workflowMode: "main-detail" as const,
        mainDetail,
        updatedAt,
      };
      const project = {
        ...state.project,
        updatedAt,
      };

      set({
        ...createActiveTaskPatch(
          {
            ...state,
            project,
            conversation,
            tasks,
            workflowMode: "main-detail",
            mainDetail,
            isConversationSaved: true,
          },
          tasks,
          updatedAt,
        ),
        conversations: upsertById(state.conversations, conversation),
        workflowMode: "main-detail",
        mainDetail,
        selectedTaskId: tasks[0]?.id,
        previewTaskId: undefined,
        isConversationSaved: true,
      });
      mainTask = tasks.find((task) => task.role === "main");
    }

    const latestState = get();
    const taskId =
      latestState.tasks.find((task) => task.role === "main")?.id ?? mainTask?.id;
    if (!taskId) {
      return;
    }

    const conversationId = latestState.conversation.id;
    set((state) => {
      const tasks = state.tasks.map((task) =>
        task.id === taskId
          ? {
              ...task,
              status: "pending" as const,
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
  generateDetailImages: () => {
    const state = get();
    if (state.isAnalyzing || state.isGenerating || state.workflowMode !== "main-detail") {
      return;
    }

    const mainTask = state.tasks.find((task) => task.role === "main");
    if (!mainTask || mainTask.status !== "completed" || !mainTask.imagePath) {
      return;
    }

    const taskIds = state.tasks
      .filter((task) => task.role === "detail")
      .map((task) => task.id);
    if (taskIds.length === 0) {
      return;
    }

    const conversationId = state.conversation.id;
    set((state) => {
      const tasks = state.tasks.map((task) =>
        taskIds.includes(task.id)
          ? {
              ...task,
              referenceImages: createMainImageReference(mainTask),
              dependsOnTaskId: mainTask.id,
              status: "pending" as const,
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

    void runImageGeneration(get, set, taskIds, conversationId);
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
