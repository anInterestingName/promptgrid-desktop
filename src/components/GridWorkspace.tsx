import * as Dialog from "@radix-ui/react-dialog";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import {
  Download,
  Maximize2,
  RefreshCw,
  RotateCcw,
  SplitSquareVertical,
  X,
} from "lucide-react";
import { useMemo, type CSSProperties } from "react";
import { statusLabels, t, type Locale } from "../i18n";
import { usePromptGridStore } from "../state/usePromptGridStore";
import type { GridCell } from "../types";

export function GridWorkspace() {
  const locale = usePromptGridStore((state) => state.locale);
  const tasks = usePromptGridStore((state) => state.tasks);
  const workflowMode = usePromptGridStore((state) => state.workflowMode);
  const selectedTaskId = usePromptGridStore((state) => state.selectedTaskId);
  const previewTaskId = usePromptGridStore((state) => state.previewTaskId);
  const selectTask = usePromptGridStore((state) => state.selectTask);
  const previewTask = usePromptGridStore((state) => state.previewTask);
  const updateTaskPrompt = usePromptGridStore(
    (state) => state.updateTaskPrompt,
  );
  const regenerateTask = usePromptGridStore((state) => state.regenerateTask);
  const retryTask = usePromptGridStore((state) => state.retryTask);
  const expandFromTask = usePromptGridStore((state) => state.expandFromTask);

  const previewTaskValue = useMemo(
    () => tasks.find((task) => task.id === previewTaskId),
    [previewTaskId, tasks],
  );

  return (
    <section className="grid-workspace" aria-label={t(locale, "imageGridAria")}>
      <div className="workspace-header">
        <div>
          <p className="eyebrow">
            {workflowMode === "main-detail"
              ? t(locale, "mainDetailEyebrow")
              : t(locale, "gridEyebrow")}
          </p>
          <h2>
            {workflowMode === "main-detail"
              ? t(locale, "mainDetailDirections")
              : t(locale, "promptDirections")}
          </h2>
        </div>
        <div className="export-actions">
          <button type="button" title={t(locale, "exportSelectedImage")}>
            <Download size={17} aria-hidden="true" />
            {t(locale, "image")}
          </button>
          <button type="button" title={t(locale, "exportComposedGrid")}>
            <Download size={17} aria-hidden="true" />
            {t(locale, "grid")}
          </button>
        </div>
      </div>

      <div className="image-grid">
        {tasks.map((task) => (
          <GridCellCard
            isSelected={task.id === selectedTaskId}
            key={task.id}
            locale={locale}
            task={task}
            onExpand={() => expandFromTask(task.id)}
            onPreview={() => previewTask(task.id)}
            onRegenerate={() => regenerateTask(task.id)}
            onRetry={() => retryTask(task.id)}
            onSelect={() => selectTask(task.id)}
            onUpdatePrompt={(prompt) => updateTaskPrompt(task.id, prompt)}
          />
        ))}
      </div>

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
                className="icon-button"
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

type GridCellCardProps = {
  task: GridCell;
  locale: Locale;
  isSelected: boolean;
  onSelect: () => void;
  onPreview: () => void;
  onRegenerate: () => void;
  onRetry: () => void;
  onExpand: () => void;
  onUpdatePrompt: (prompt: string) => void;
};

function GridCellCard({
  task,
  locale,
  isSelected,
  onSelect,
  onPreview,
  onRegenerate,
  onRetry,
  onExpand,
  onUpdatePrompt,
}: GridCellCardProps) {
  const canPreview = task.status === "completed";
  const directionTitle = getTaskDirectionTitle(task, locale);

  return (
    <article
      className={isSelected ? "grid-cell selected" : "grid-cell"}
      onClick={onSelect}
    >
      <div className="cell-image-wrap">
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
        />
        {task.errorMessage ? (
          <p className="cell-error">
            {task.errorMessage === "Mock provider timeout"
              ? t(locale, "mockProviderTimeout")
              : task.errorMessage}
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
        >
          {task.status === "failed" ? (
            <RotateCcw size={16} aria-hidden="true" />
          ) : (
            <RefreshCw size={16} aria-hidden="true" />
          )}
        </button>
        <button
          type="button"
          title={t(locale, "expandFromCell")}
          onClick={(event) => {
            event.stopPropagation();
            onExpand();
          }}
        >
          <SplitSquareVertical size={16} aria-hidden="true" />
        </button>
      </footer>
    </article>
  );
}

function getTaskDirectionTitle(task: GridCell, locale: Locale) {
  return task.directionTitle?.trim() || `${t(locale, "direction")} ${task.index + 1}`;
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
