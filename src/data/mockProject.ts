import type {
  AppSettings,
  Conversation,
  GridCell,
  GridSize,
  MockVisual,
  Project,
} from "../types";
import { fallbackWorkflowConfigs } from "../modules/workflows/workflowConfig";

const now = new Date().toISOString();

export const mockProject: Project = {
  id: "project-local-001",
  title: "Launch Cover Directions",
  originalPrompt:
    "A desktop workspace for comparing nine AI image directions for a new product launch.",
  style: "Editorial product study",
  gridSize: 9,
  aspectRatio: "1:1",
  quality: "draft",
  outputSize: "standard",
  schemaVersion: 1,
  createdAt: now,
  updatedAt: now,
};

export const mockConversation: Conversation = {
  id: "conversation-local-001",
  projectId: mockProject.id,
  title: "Initial Exploration",
  originalPrompt: mockProject.originalPrompt,
  style: mockProject.style,
  gridSize: mockProject.gridSize,
  aspectRatio: mockProject.aspectRatio,
  quality: mockProject.quality,
  outputSize: mockProject.outputSize,
  schemaVersion: mockProject.schemaVersion,
  createdAt: mockProject.createdAt,
  updatedAt: mockProject.updatedAt,
  configurationLocked: false,
};

export const mockSettings: AppSettings = {
  providers: {
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
  },
  activeModelSelection: {
    text: {
      providerId: "openai",
    },
    image: {
      providerId: "openai",
    },
  },
  workflowConfigs: fallbackWorkflowConfigs,
  showWorkflowConfigEditor: true,
  debugLoggingEnabled: false,
  debugLogRetentionDays: 7,
  maxConcurrency: 3,
  defaultGridSize: 9,
  defaultAspectRatio: "1:1",
};

export const styleOptions = [
  "Editorial product study",
  "Quiet cinematic still",
  "Premium ecommerce scene",
  "Magazine cover concept",
];

export const aspectRatioOptions = ["1:1", "16:9", "9:16", "4:3"] as const;

export const qualityOptions = ["draft", "standard", "high"] as const;

export const outputSizeOptions = ["standard", "large", "2k", "4k"] as const;

export const gridSizeOptions = [6, 9, 16, 25] as const satisfies readonly GridSize[];

export const mockVisuals: MockVisual[] = [
  {
    title: "Soft Studio",
    palette: ["#7fb4ff", "#eaf2ff", "#4a8cff"],
    texture: "studio",
  },
  {
    title: "Glass Desk",
    palette: ["#dff5ff", "#8fd8ff", "#0a59f7"],
    texture: "product",
  },
  {
    title: "Warm Editorial",
    palette: ["#f2f6ff", "#b8c7ff", "#6f8cff"],
    texture: "editorial",
  },
  {
    title: "Night Console",
    palette: ["#16233f", "#0a59f7", "#16b8d9"],
    texture: "cinematic",
  },
  {
    title: "Paper Prototype",
    palette: ["#f7fbff", "#d7e8ff", "#9abfff"],
    texture: "studio",
  },
  {
    title: "Signal Board",
    palette: ["#eaf2ff", "#9fe7ff", "#0b6eff"],
    texture: "product",
  },
  {
    title: "Gallery Light",
    palette: ["#ffffff", "#cfe1ff", "#7fa8ff"],
    texture: "editorial",
  },
  {
    title: "Workshop Table",
    palette: ["#edf7ff", "#a8e5f6", "#45a3ff"],
    texture: "studio",
  },
  {
    title: "Launch Motion",
    palette: ["#143c9a", "#6aa8ff", "#e8f2ff"],
    texture: "cinematic",
  },
];

export function createMockTasks(
  project: Project,
  seedPrompt = project.originalPrompt,
  explorationRound = 1,
  parentTaskId?: string,
  conversationId = "conversation-local-001",
): GridCell[] {
  const createdAt = new Date().toISOString();
  const directions = [
    "hero composition with one dominant focal point",
    "top-down planning desk with layered artifacts",
    "premium material close-up with crisp shadows",
    "wide workspace scene with clear comparison grid",
    "centered product UI moment with calm depth",
    "campaign cover image with confident negative space",
    "hands-on creative review table with marked favorites",
    "minimal studio scene for ecommerce clarity",
    "cinematic expansion concept with motion cues",
  ];

  const targetCount = Math.max(1, project.gridSize);
  const taskDirections = Array.from({ length: targetCount }, (_, index) => {
    const direction = directions[index % directions.length];
    if (index < directions.length) {
      return direction;
    }

    return `${direction}, variation ${Math.floor(index / directions.length) + 1}`;
  });

  return taskDirections.map((direction, index) => ({
    id: `round-${explorationRound}-cell-${index + 1}-${Date.now()}`,
    projectId: project.id,
    conversationId,
    gridSize: project.gridSize,
    parentTaskId,
    explorationRound,
    index,
    prompt: `${seedPrompt} - ${direction}. Style: ${project.style}.`,
    status: "pending",
    provider: "mock-local",
    model: "mock-image-v1",
    createdAt,
    updatedAt: createdAt,
    attempt: 1,
    visual: mockVisuals[index % mockVisuals.length],
  }));
}
