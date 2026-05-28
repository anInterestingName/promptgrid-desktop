import * as Dialog from "@radix-ui/react-dialog";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import {
  Check,
  Copy,
  FolderOpen,
  HelpCircle,
  Maximize2,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
import { ContextMenu } from "./ContextMenu";
import {
  getContextMenuPosition,
  type ContextMenuItem,
} from "./contextMenuUtils";
import { gridSizeOptions } from "../data/mockProject";
import { statusLabels, t, type Locale } from "../i18n";
import {
  copyImageFile,
  openImageInFileManager,
} from "../services/localPersistence";
import { getErrorMessage } from "../shared/utils/error";
import { usePromptGridStore } from "../state/usePromptGridStore";
import { getWorkflowConfig } from "../modules/workflows/workflowConfig";
import type { GridCell, GridSize } from "../types";

const cellContextMenuWidth = 196;
const cellContextMenuHeight = 92;
const cellContextMenuGap = 8;

export function GridWorkspace() {
  const locale = usePromptGridStore((state) => state.locale);
  const project = usePromptGridStore((state) => state.project);
  const conversation = usePromptGridStore((state) => state.conversation);
  const tasks = usePromptGridStore((state) => state.tasks);
  const settings = usePromptGridStore((state) => state.settings);
  const workflowMode = usePromptGridStore((state) => state.workflowMode);
  const isAnalyzing = usePromptGridStore((state) => state.isAnalyzing);
  const isGenerating = usePromptGridStore((state) => state.isGenerating);
  const selectedTaskId = usePromptGridStore((state) => state.selectedTaskId);
  const previewTaskId = usePromptGridStore((state) => state.previewTaskId);
  const setGridSize = usePromptGridStore((state) => state.setGridSize);
  const selectTask = usePromptGridStore((state) => state.selectTask);
  const previewTask = usePromptGridStore((state) => state.previewTask);
  const updateTaskPrompt = usePromptGridStore(
    (state) => state.updateTaskPrompt,
  );
  const regenerateTask = usePromptGridStore((state) => state.regenerateTask);
  const retryTask = usePromptGridStore((state) => state.retryTask);
  const [cellContextMenu, setCellContextMenu] = useState<{
    taskId: string;
    x: number;
    y: number;
  }>();
  const [imageActionMessage, setImageActionMessage] = useState<{
    taskId: string;
    tone: "success" | "error";
    message: string;
  }>();

  const previewTaskValue = useMemo(
    () => tasks.find((task) => task.id === previewTaskId),
    [previewTaskId, tasks],
  );
  const contextMenuTask = useMemo(
    () => tasks.find((task) => task.id === cellContextMenu?.taskId),
    [cellContextMenu?.taskId, tasks],
  );
  const imageGridStyle = {
    "--grid-columns": getGridColumns(project.gridSize),
  } as CSSProperties;
  const isConfigurationLocked = Boolean(conversation.configurationLocked);
  const activeWorkflowConfig = getWorkflowConfig(
    settings.workflowConfigs,
    workflowMode,
  );

  useEffect(() => {
    if (!imageActionMessage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setImageActionMessage((current) =>
        current?.taskId === imageActionMessage.taskId ? undefined : current,
      );
    }, 3200);

    return () => window.clearTimeout(timeoutId);
  }, [imageActionMessage]);

  const openContextMenuForTask = useCallback(
    (task: GridCell, x: number, y: number) => {
      selectTask(task.id);
      if (!canUseImageFileActions(task)) {
        setImageActionMessage({
          taskId: task.id,
          tone: "error",
          message: t(locale, "imageFileUnavailable"),
        });
      }

      setCellContextMenu({
        taskId: task.id,
        ...getContextMenuPosition({
          preferredX: x,
          preferredY: y,
          width: cellContextMenuWidth,
          height: cellContextMenuHeight,
          gap: cellContextMenuGap,
        }),
      });
    },
    [locale, selectTask],
  );

  useEffect(() => {
    function getGridImageTarget(event: MouseEvent | PointerEvent) {
      const eventTarget =
        event.target instanceof Element
          ? event.target
          : document.elementFromPoint(event.clientX, event.clientY);
      const target = eventTarget?.closest<HTMLElement>(
        "[data-grid-image-task-id]",
      );
      if (!target) {
        return undefined;
      }

      return target.dataset.gridImageTaskId;
    }

    function openGridImageContextMenu(event: MouseEvent | PointerEvent) {
      if (
        event.type !== "contextmenu" &&
        event.type !== "auxclick" &&
        event.button !== 2
      ) {
        return;
      }

      const taskId = getGridImageTarget(event);
      const task = taskId
        ? tasks.find((candidate) => candidate.id === taskId)
        : undefined;
      if (!task) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      openContextMenuForTask(task, event.clientX, event.clientY);
    }

    document.addEventListener("contextmenu", openGridImageContextMenu, true);
    document.addEventListener("pointerdown", openGridImageContextMenu, true);
    document.addEventListener("mousedown", openGridImageContextMenu, true);
    document.addEventListener("auxclick", openGridImageContextMenu, true);
    return () => {
      document.removeEventListener("contextmenu", openGridImageContextMenu, true);
      document.removeEventListener("pointerdown", openGridImageContextMenu, true);
      document.removeEventListener("mousedown", openGridImageContextMenu, true);
      document.removeEventListener("auxclick", openGridImageContextMenu, true);
    };
  }, [openContextMenuForTask, tasks]);

  async function handleOpenImageLocation(task: GridCell) {
    setCellContextMenu(undefined);
    if (!task.imagePath) {
      return;
    }

    try {
      await openImageInFileManager(task.imagePath);
      setImageActionMessage(undefined);
    } catch (error) {
      setImageActionMessage({
        taskId: task.id,
        tone: "error",
        message: getImageActionErrorMessage(locale, error, "open"),
      });
      console.error("Could not open image location", error);
    }
  }

  async function handleCopyImage(task: GridCell) {
    setCellContextMenu(undefined);
    if (!task.imagePath) {
      return;
    }

    try {
      await copyImageFile(task.imagePath);
      setImageActionMessage({
        taskId: task.id,
        tone: "success",
        message: t(locale, "imageFileCopied"),
      });
    } catch (error) {
      setImageActionMessage({
        taskId: task.id,
        tone: "error",
        message: getImageActionErrorMessage(locale, error, "copy"),
      });
      console.error("Could not copy image file", error);
    }
  }

  return (
    <section
      className="grid-workspace"
      aria-label={t(locale, "imageGridAria")}
    >
      <div className="workspace-header">
        <div>
          <p className="eyebrow">
            {workflowMode === "main-detail"
              ? activeWorkflowConfig.name
              : formatGridEyebrow(project.gridSize, locale)}
          </p>
          <div className="workspace-title-row">
            <h2>
              {activeWorkflowConfig.name}
            </h2>
            <WorkflowHelp description={activeWorkflowConfig.description} />
          </div>
        </div>
        <div className="grid-size-switch" aria-label={t(locale, "gridSize")}>
          {gridSizeOptions.map((gridSize) => (
            <button
              className={project.gridSize === gridSize ? "active" : ""}
              disabled={isConfigurationLocked || isAnalyzing || isGenerating}
              key={gridSize}
              type="button"
              onClick={() => setGridSize(gridSize)}
            >
              {gridSize}
            </button>
          ))}
        </div>
      </div>

      <div className="image-grid" style={imageGridStyle}>
        {tasks.map((task) => (
          <GridCellCard
            isSelected={task.id === selectedTaskId}
            key={task.id}
            locale={locale}
            task={task}
            onPreview={() => previewTask(task.id)}
            onRegenerate={() => regenerateTask(task.id)}
            onRetry={() => retryTask(task.id)}
            onSelect={() => selectTask(task.id)}
            onUpdatePrompt={(prompt) => updateTaskPrompt(task.id, prompt)}
            statusMessage={
              imageActionMessage?.taskId === task.id ? imageActionMessage : undefined
            }
          />
        ))}
      </div>

      {contextMenuTask && cellContextMenu
        ? (
            <ContextMenu
              ariaLabel={t(locale, "imageActions")}
              items={getImageContextMenuItems({
                task: contextMenuTask,
                locale,
                onCopyImage: () => void handleCopyImage(contextMenuTask),
                onOpenLocation: () => void handleOpenImageLocation(contextMenuTask),
              })}
              position={cellContextMenu}
              onClose={() => setCellContextMenu(undefined)}
            />
          )
        : null}

      <Dialog.Root
        open={Boolean(previewTaskValue)}
        onOpenChange={(open) => {
          if (!open) {
            previewTask(undefined);
          }
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="preview-dialog">
            <div className="dialog-topline">
              <Dialog.Title>
                {previewTaskValue
                  ? getTaskDirectionTitle(previewTaskValue, locale)
                  : t(locale, "preview")}
              </Dialog.Title>
              <Dialog.Close
                className="icon-button preview-close-button"
                title={t(locale, "closePreview")}
              >
                <X size={18} aria-hidden="true" />
              </Dialog.Close>
            </div>
            {previewTaskValue ? (
              <>
                <MockImage task={previewTaskValue} large />
                <p>{previewTaskValue.prompt}</p>
              </>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </section>
  );
}

function WorkflowHelp({ description }: { description: string }) {
  if (!description.trim()) {
    return null;
  }

  return (
    <span className="workflow-help">
      <HelpCircle size={15} aria-hidden="true" />
      <span className="workflow-help-tooltip" role="tooltip">
        {description}
      </span>
    </span>
  );
}

type GridCellCardProps = {
  task: GridCell;
  locale: Locale;
  isSelected: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onRegenerate: () => void;
  onRetry: () => void;
  onUpdatePrompt: (prompt: string) => void;
  statusMessage?: {
    tone: "success" | "error";
    message: string;
  };
};

function GridCellCard({
  task,
  locale,
  isSelected,
  onSelect,
  onPreview,
  onRegenerate,
  onRetry,
  onUpdatePrompt,
  statusMessage,
}: GridCellCardProps) {
  const canPreview = task.status === "completed";
  const directionTitle = getTaskDirectionTitle(task, locale);

  return (
    <article
      className={isSelected ? "grid-cell selected" : "grid-cell"}
      data-task-id={task.id}
      onClick={onSelect}
    >
      <div className="cell-image-wrap" data-grid-image-task-id={task.id}>
        <MockImage task={task} />
        {task.status !== "completed" ? (
          <div className={`status-scrim status-${task.status}`}>
            {statusLabels[locale][task.status]}
          </div>
        ) : null}
      </div>

      <div className="cell-body">
        <div className="cell-meta">
          <span>
            {task.role === "main"
              ? t(locale, "mainImage")
              : task.role === "detail"
                ? `${t(locale, "detailImage")} ${task.index}`
                : `${t(locale, "cell")} ${task.index + 1}`}
          </span>
          <strong>{directionTitle}</strong>
        </div>
        <textarea
          aria-label={`${t(locale, "promptForCell")} ${task.index + 1}`}
          value={task.prompt}
          onChange={(event) => onUpdatePrompt(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.stopPropagation()}
        />
        {task.errorMessage ? (
          <p className="cell-error">
            {task.errorMessage === "Mock provider timeout"
              ? t(locale, "mockProviderTimeout")
              : task.errorMessage}
          </p>
        ) : null}
        {statusMessage ? (
          <p
            className={`cell-file-status ${statusMessage.tone}`}
            role={statusMessage.tone === "error" ? "alert" : "status"}
          >
            {statusMessage.tone === "success" ? (
              <Check size={14} aria-hidden="true" />
            ) : null}
            <span>{statusMessage.message}</span>
          </p>
        ) : null}
      </div>

      <footer className="cell-actions">
        <button
          type="button"
          title={t(locale, "previewImage")}
          onClick={(event) => {
            event.stopPropagation();
            if (canPreview) {
              onPreview();
            }
          }}
          onContextMenu={(event) => event.stopPropagation()}
          disabled={!canPreview}
        >
          <Maximize2 size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          title={
            task.status === "failed"
              ? t(locale, "retryCell")
              : t(locale, "regenerateCell")
          }
          onClick={(event) => {
            event.stopPropagation();
            if (task.status === "failed") {
              onRetry();
              return;
            }
            onRegenerate();
          }}
          onContextMenu={(event) => event.stopPropagation()}
        >
          {task.status === "failed" ? (
            <RotateCcw size={16} aria-hidden="true" />
          ) : (
            <RefreshCw size={16} aria-hidden="true" />
          )}
        </button>
      </footer>
    </article>
  );
}

function getImageContextMenuItems({
  task,
  locale,
  onOpenLocation,
  onCopyImage,
}: {
  task: GridCell;
  locale: Locale;
  onOpenLocation: () => void;
  onCopyImage: () => void;
}): ContextMenuItem[] {
  const canUseFileActions = canUseImageFileActions(task);

  return [
    {
      key: "open-location",
      label: t(locale, "openImageInFileManager"),
      icon: <FolderOpen size={15} aria-hidden="true" />,
      disabled: !canUseFileActions,
      onSelect: onOpenLocation,
    },
    {
      key: "copy-image",
      label: t(locale, "copyImage"),
      icon: <Copy size={15} aria-hidden="true" />,
      disabled: !canUseFileActions,
      onSelect: onCopyImage,
    },
  ];
}

function getTaskDirectionTitle(task: GridCell, locale: Locale) {
  return task.directionTitle?.trim() || `${t(locale, "direction")} ${task.index + 1}`;
}

function getGridColumns(gridSize: GridSize) {
  if (gridSize >= 25) {
    return 5;
  }

  if (gridSize >= 16) {
    return 4;
  }

  return 3;
}

function formatGridEyebrow(gridSize: GridSize, locale: Locale) {
  return locale === "zh" ? `${gridSize} 宫格` : `${gridSize}-Cell Grid`;
}

function canUseImageFileActions(task: GridCell) {
  return (
    task.status === "completed" &&
    Boolean(task.imagePath?.trim()) &&
    !task.imagePath?.startsWith("data:image/")
  );
}

function getImageActionErrorMessage(
  locale: Locale,
  error: unknown,
  action: "open" | "copy",
) {
  const message = getErrorMessage(error);
  if (message.includes("desktop app")) {
    return t(locale, "imageFileDesktopOnly");
  }

  if (message.includes("not found") || message.includes("not a file")) {
    return t(locale, "imageFileMissing");
  }

  if (message.includes("local source file")) {
    return t(locale, "imageFileUnavailable");
  }

  return `${t(
    locale,
    action === "open" ? "openImageFileError" : "copyImageFileError",
  )}: ${message}`;
}

function MockImage({
  task,
  large = false,
}: {
  task: GridCell;
  large?: boolean;
}) {
  const imageSource = getImageSource(task.imagePath);
  if (imageSource) {
    return (
      <img
        alt={task.prompt}
        className={`generated-image${large ? " large" : ""}`}
        src={imageSource}
      />
    );
  }

  const [toneA, toneB, toneC] = task.visual.palette;
  const style = {
    "--tone-a": toneA,
    "--tone-b": toneB,
    "--tone-c": toneC,
  } as CSSProperties;

  return (
    <div
      aria-label={task.visual.title}
      className={`mock-image texture-${task.visual.texture}${large ? " large" : ""}`}
      role="img"
      style={style}
    >
      <div className="mock-plane primary" />
      <div className="mock-plane secondary" />
      <div className="mock-plane accent" />
    </div>
  );
}

function getImageSource(imagePath?: string) {
  if (!imagePath) {
    return undefined;
  }

  if (imagePath.startsWith("data:image/")) {
    return imagePath;
  }

  return isTauri() ? convertFileSrc(imagePath) : imagePath;
}
