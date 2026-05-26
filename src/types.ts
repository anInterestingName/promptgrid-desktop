export type GridSize = 6 | 9 | 16 | 25;

export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3";

export type Quality = "draft" | "standard" | "high";

export type OutputSize = "standard" | "large" | "2k" | "4k";

export type ApiProvider = "openai" | "custom";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export type ResponseVerbosity = "low" | "medium" | "high";

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowMode = "text-grid" | "main-detail";

export type ImageAsset = {
  id: string;
  kind: "source" | "main";
  imagePath: string;
  name?: string;
  createdAt: string;
};

export type MainDetailState = {
  sourceImage?: ImageAsset;
  mainTaskId?: string;
  detailTaskIds: string[];
  promptAnalyzedAt?: string;
};

export type GridCellRole = "grid" | "main" | "detail";

export type Project = {
  id: string;
  title: string;
  projectDirectory?: string;
  originalPrompt: string;
  style: string;
  gridSize: GridSize;
  aspectRatio: AspectRatio;
  quality: Quality;
  outputSize: OutputSize;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type Conversation = {
  id: string;
  projectId: string;
  title: string;
  originalPrompt: string;
  style: string;
  gridSize: GridSize;
  aspectRatio: AspectRatio;
  quality: Quality;
  outputSize: OutputSize;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  workflowMode?: WorkflowMode;
  mainDetail?: MainDetailState;
  configurationLocked?: boolean;
};

export type ImageTask = {
  id: string;
  projectId: string;
  conversationId?: string;
  gridSize?: GridSize;
  parentTaskId?: string;
  explorationRound: number;
  index: number;
  prompt: string;
  directionTitle?: string;
  status: TaskStatus;
  imagePath?: string;
  errorMessage?: string;
  provider: string;
  model: string;
  createdAt: string;
  updatedAt: string;
  role?: GridCellRole;
  referenceImagePath?: string;
  dependsOnTaskId?: string;
};

export type AppSettings = {
  apiProvider: ApiProvider;
  textModel: string;
  imageModel: string;
  openAiBaseUrl: string;
  openAiApiKeySaved: boolean;
  customProviderName?: string;
  customBaseUrl?: string;
  customApiKeySaved: boolean;
  customTextModel?: string;
  customImageModel?: string;
  customHeaders?: string;
  reasoningEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  responseVerbosity: ResponseVerbosity;
  streamResponses: boolean;
  debugLoggingEnabled: boolean;
  debugLogRetentionDays: number;
  maxConcurrency: number;
  defaultGridSize: GridSize;
  defaultAspectRatio: AspectRatio;
  outputDirectory?: string;
};

export type MockVisual = {
  title: string;
  palette: [string, string, string];
  texture: "studio" | "editorial" | "cinematic" | "product";
};

export type GridCell = ImageTask & {
  attempt: number;
  visual: MockVisual;
};

export type AppSnapshot = {
  project: Project;
  conversation?: Conversation;
  activeConversationId?: string;
  projects?: Project[];
  conversations?: Conversation[];
  tasks: GridCell[];
  conversationTasks?: Record<string, GridCell[]>;
  settings: AppSettings;
  selectedTaskId?: string;
  currentRound: number;
  workflowMode?: WorkflowMode;
};

export type ModelOption = {
  id: string;
  ownedBy?: string;
};
