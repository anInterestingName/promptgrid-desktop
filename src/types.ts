export type GridSize = 9 | 16 | 25;

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

export type Project = {
  id: string;
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
};

export type ImageTask = {
  id: string;
  projectId: string;
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
  tasks: GridCell[];
  settings: AppSettings;
  selectedTaskId?: string;
  currentRound: number;
};

export type ModelOption = {
  id: string;
  ownedBy?: string;
};
