export type GridSize = 9 | 16 | 25;

export type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3";

export type Quality = "draft" | "standard" | "high";

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
  status: TaskStatus;
  imagePath?: string;
  errorMessage?: string;
  provider: string;
  model: string;
  createdAt: string;
  updatedAt: string;
};

export type AppSettings = {
  apiProvider: string;
  textModel: string;
  imageModel: string;
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
