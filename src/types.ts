export type GridSize = 6 | 9 | 16 | 25;

export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3";

export type Quality = "draft" | "standard" | "high";

export type OutputSize = "standard" | "large" | "2k" | "4k";

export type ProviderId = "openai" | "deepseek" | "openai-compatible";

export type ModelCapability = "text" | "image";

export type ImageModelQuality = "auto" | "low" | "medium" | "high";

export type ImageModelBackground = "auto" | "transparent" | "opaque";

export type ImageModelOutputFormat = "png" | "jpeg" | "webp";

export type TextModelSettings = {
  model: string;
  reasoningEnabled: boolean;
  reasoningEffort: ReasoningEffort;
  responseVerbosity: ResponseVerbosity;
  streamResponses: boolean;
};

export type ImageModelSettings = TextModelSettings & {
  quality: ImageModelQuality;
  background: ImageModelBackground;
  outputFormat: ImageModelOutputFormat;
  outputCompression: number;
};

export type ProviderConfig = {
  enabled: boolean;
  baseUrl: string;
  apiKeySaved: boolean;
  customHeaders?: string;
  textModel: TextModelSettings;
  imageModel: ImageModelSettings;
};

export type ActiveModelRoute = {
  providerId: ProviderId;
};

export type ActiveModelSelection = Record<ModelCapability, ActiveModelRoute>;

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export type ResponseVerbosity = "low" | "medium" | "high";

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowMode = "text-grid" | "main-detail";

export type WorkflowExecutionStrategy = "matrix_exploration" | "main_detail_set";

export type WorkflowConfig = {
  id: WorkflowMode;
  name: string;
  description: string;
  executionStrategy: WorkflowExecutionStrategy;
  enabled: boolean;
  sortOrder: number;
  analysisTemplate: string;
};

export type ImageAsset = {
  id: string;
  kind: "source" | "main";
  imagePath: string;
  name?: string;
  createdAt: string;
};

export type ImageReference = {
  id: string;
  role: "source" | "main" | "detail" | "custom";
  imagePath: string;
  name?: string;
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
  referenceImages?: ImageReference[];
  dependsOnTaskId?: string;
};

export type AppSettings = {
  providers: Record<ProviderId, ProviderConfig>;
  activeModelSelection: ActiveModelSelection;
  workflowConfigs: Record<WorkflowMode, WorkflowConfig>;
  showWorkflowConfigEditor: boolean;
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
