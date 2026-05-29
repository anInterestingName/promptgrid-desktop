import type {
  Project,
  WorkflowConfig,
  WorkflowExecutionStrategy,
  WorkflowMode,
} from "../../types";
import {
  defaultStyleId,
  ensureStyleForWorkflow,
  fallbackProductStyleId,
  getStylePrompt,
  normalizeStyleGroupIds,
} from "../styles/styleCatalog";

const workflowModes = ["text-grid", "main-detail"] as const satisfies readonly WorkflowMode[];
const executionStrategies = [
  "matrix_exploration",
  "main_detail_set",
] as const satisfies readonly WorkflowExecutionStrategy[];

export const fallbackWorkflowConfigs = {
  "text-grid": {
    id: "text-grid",
    name: "灵感矩阵",
    description:
      "从一个创意出发，生成多种差异化视觉方向，适合前期探索、风格比较与快速筛选。",
    executionStrategy: "matrix_exploration",
    enabled: true,
    sortOrder: 10,
    styleGroupIds: ["aesthetic-visual", "material-light"],
    defaultStyleId,
    analysisTemplate: "",
  },
  "main-detail": {
    id: "main-detail",
    name: "览物成图",
    description:
      "围绕商品想法或参考图生成一张主视觉和一组详情图，适合电商商品页、卖点展示和成套素材制作。",
    executionStrategy: "main_detail_set",
    enabled: true,
    sortOrder: 20,
    styleGroupIds: ["product-visual-system", "material-light"],
    defaultStyleId: fallbackProductStyleId,
    analysisTemplate: "",
  },
} satisfies Record<WorkflowMode, WorkflowConfig>;

export type WorkflowTemplateVariables = {
  originalPrompt: string;
  gridSize: string;
  detailCount: string;
  style: string;
  aspectRatio: string;
  quality: string;
  outputSize: string;
  sourceImageInstruction: string;
  imageReferencePolicy: string;
  languageInstruction: string;
};

export const workflowTemplateVariableNames = [
  "originalPrompt",
  "gridSize",
  "detailCount",
  "style",
  "aspectRatio",
  "quality",
  "outputSize",
  "sourceImageInstruction",
  "imageReferencePolicy",
  "languageInstruction",
] as const satisfies readonly (keyof WorkflowTemplateVariables)[];

export type ExternalWorkflowConfigFile = {
  workflows?: Partial<WorkflowConfig>[];
};

export async function loadExternalWorkflowConfigs(): Promise<
  Record<WorkflowMode, WorkflowConfig> | undefined
> {
  const response = await fetch("/workflows.json", { cache: "no-store" });
  if (!response.ok) {
    return undefined;
  }

  return normalizeWorkflowConfigs((await response.json()) as ExternalWorkflowConfigFile);
}

export function normalizeWorkflowConfigs(
  input?: Partial<Record<WorkflowMode, Partial<WorkflowConfig>>> | ExternalWorkflowConfigFile,
): Record<WorkflowMode, WorkflowConfig> {
  const configuredWorkflows: Partial<Record<WorkflowMode, Partial<WorkflowConfig>>> =
    Array.isArray((input as ExternalWorkflowConfigFile)?.workflows)
      ? Object.fromEntries(
          ((input as ExternalWorkflowConfigFile).workflows ?? [])
            .filter((workflow): workflow is Partial<WorkflowConfig> & { id: WorkflowMode } =>
              isWorkflowMode(workflow.id),
            )
            .map((workflow) => [workflow.id, workflow]),
        )
      : (input as Partial<Record<WorkflowMode, Partial<WorkflowConfig>>> | undefined) ?? {};

  return workflowModes.reduce(
    (configs, mode) => ({
      ...configs,
      [mode]: normalizeWorkflowConfig(mode, configuredWorkflows[mode]),
    }),
    {} as Record<WorkflowMode, WorkflowConfig>,
  );
}

export function getEnabledWorkflowConfigs(
  workflowConfigs: Record<WorkflowMode, WorkflowConfig>,
) {
  return workflowModes
    .map((mode) => workflowConfigs[mode])
    .filter((workflow) => workflow.enabled)
    .sort((left, right) => left.sortOrder - right.sortOrder);
}

export function getWorkflowConfig(
  workflowConfigs: Record<WorkflowMode, WorkflowConfig>,
  mode: WorkflowMode,
) {
  return workflowConfigs[mode] ?? fallbackWorkflowConfigs[mode];
}

export function createWorkflowTemplateVariables({
  project,
  hasSourceImage,
}: {
  project: Project;
  hasSourceImage: boolean;
}): WorkflowTemplateVariables {
  const detailCount = Math.max(0, project.gridSize - 1);

  return {
    originalPrompt: project.originalPrompt.trim(),
    gridSize: String(project.gridSize),
    detailCount: String(detailCount),
    style: getStylePrompt(project.style).trim(),
    aspectRatio: project.aspectRatio,
    quality: project.quality,
    outputSize: project.outputSize,
    sourceImageInstruction: hasSourceImage
      ? "A source/reference image is attached. Treat it as the authoritative product reference for shape, material, color, and key visual traits."
      : "No source image is attached. Infer the product identity only from the written idea and keep all images internally consistent.",
    imageReferencePolicy: hasSourceImage
      ? "The hero image generation will receive the uploaded source image as a visual reference. Detail image generation will receive the generated hero image as a visual reference."
      : "The hero image will be generated from text only. Detail image generation will receive the generated hero image as a visual reference.",
    languageInstruction:
      "Use the same language as the user's idea for conversationTitle and direction titles.",
  };
}

export function renderWorkflowAnalysisTemplate(
  template: string,
  variables: WorkflowTemplateVariables,
) {
  return template.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9]*)\s*\}\}/g, (match, key) => {
    if (key in variables) {
      return variables[key as keyof WorkflowTemplateVariables];
    }

    return match;
  });
}

function normalizeWorkflowConfig(
  mode: WorkflowMode,
  input?: Partial<WorkflowConfig>,
): WorkflowConfig {
  const fallback = fallbackWorkflowConfigs[mode];
  const executionStrategy = isExecutionStrategy(input?.executionStrategy)
    ? input.executionStrategy
    : fallback.executionStrategy;
  const styleGroupIds = normalizeStyleGroupIds(
    input?.styleGroupIds ?? fallback.styleGroupIds,
  );
  const defaultStyleId = ensureStyleForWorkflow(
    normalizeText(input?.defaultStyleId, fallback.defaultStyleId),
    {
      styleGroupIds,
      defaultStyleId: fallback.defaultStyleId,
    },
  );

  return {
    id: mode,
    name: normalizeText(input?.name, fallback.name),
    description: normalizeText(input?.description, fallback.description),
    executionStrategy,
    enabled: input?.enabled ?? fallback.enabled,
    sortOrder:
      typeof input?.sortOrder === "number" && Number.isFinite(input.sortOrder)
        ? input.sortOrder
        : fallback.sortOrder,
    styleGroupIds,
    defaultStyleId,
    analysisTemplate: normalizeText(input?.analysisTemplate, fallback.analysisTemplate),
  };
}

function normalizeText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function isWorkflowMode(value: unknown): value is WorkflowMode {
  return workflowModes.includes(value as WorkflowMode);
}

function isExecutionStrategy(value: unknown): value is WorkflowExecutionStrategy {
  return executionStrategies.includes(value as WorkflowExecutionStrategy);
}
