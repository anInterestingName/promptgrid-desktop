import {
  aspectRatioOptions,
  outputSizeOptions,
  qualityOptions,
} from "../data/mockProject";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";
import { outputSizeLabels, qualityLabels, t } from "../i18n";
import { getConfiguredImageProvider } from "../modules/settings/settingsDomain";
import {
  getGroupIdForStyleInWorkflow,
  getStyleById,
  getStyleGroupsByIds,
  getStyleLabel,
  getStylesForGroup,
} from "../modules/styles/styleCatalog";
import {
  getEnabledWorkflowConfigs,
  getWorkflowConfig,
} from "../modules/workflows/workflowConfig";
import { visibleProviderAdapterList } from "../modules/settings/providerAdapters";
import { saveReferenceImage } from "../services/localPersistence";
import { usePromptGridStore } from "../state/usePromptGridStore";
import type {
  AspectRatio,
  ModelCapability,
  OutputSize,
  ProviderId,
  Quality,
} from "../types";
import {
  Check,
  ChevronDown,
  Image,
  ImagePlus,
  Play,
  Plus,
  Sparkles,
  Type,
  Wand2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function PromptPanel() {
  const locale = usePromptGridStore((state) => state.locale);
  const project = usePromptGridStore((state) => state.project);
  const conversation = usePromptGridStore((state) => state.conversation);
  const isConversationSaved = usePromptGridStore(
    (state) => state.isConversationSaved,
  );
  const settings = usePromptGridStore((state) => state.settings);
  const updateSettings = usePromptGridStore((state) => state.updateSettings);
  const isAnalyzing = usePromptGridStore((state) => state.isAnalyzing);
  const isGenerating = usePromptGridStore((state) => state.isGenerating);
  const workflowMode = usePromptGridStore((state) => state.workflowMode);
  const mainDetail = usePromptGridStore((state) => state.mainDetail);
  const setWorkflowMode = usePromptGridStore((state) => state.setWorkflowMode);
  const setOriginalPrompt = usePromptGridStore(
    (state) => state.setOriginalPrompt,
  );
  const setSourceImage = usePromptGridStore((state) => state.setSourceImage);
  const setStyle = usePromptGridStore((state) => state.setStyle);
  const setAspectRatio = usePromptGridStore((state) => state.setAspectRatio);
  const setQuality = usePromptGridStore((state) => state.setQuality);
  const setOutputSize = usePromptGridStore((state) => state.setOutputSize);
  const analyzePrompt = usePromptGridStore((state) => state.analyzePrompt);
  const generateImages = usePromptGridStore((state) => state.generateImages);
  const tasks = usePromptGridStore((state) => state.tasks);
  const analyzeMainDetailPrompt = usePromptGridStore(
    (state) => state.analyzeMainDetailPrompt,
  );
  const generateMainImage = usePromptGridStore(
    (state) => state.generateMainImage,
  );
  const generateDetailImages = usePromptGridStore(
    (state) => state.generateDetailImages,
  );
  const [isStyleOpen, setIsStyleOpen] = useState(false);
  const [isStyleGroupOpen, setIsStyleGroupOpen] = useState(false);
  const [isWorkflowOpen, setIsWorkflowOpen] = useState(false);
  const [isIdeaMenuOpen, setIsIdeaMenuOpen] = useState(false);
  const workflowFieldRef = useRef<HTMLDivElement>(null);
  const styleGroupFieldRef = useRef<HTMLDivElement>(null);
  const styleFieldRef = useRef<HTMLDivElement>(null);
  const ideaFieldRef = useRef<HTMLDivElement>(null);
  const sourceImageInputRef = useRef<HTMLInputElement>(null);
  const workflowOptions = getEnabledWorkflowConfigs(settings.workflowConfigs);
  const activeWorkflowConfig = getWorkflowConfig(
    settings.workflowConfigs,
    workflowMode,
  );
  const availableStyleGroups = getStyleGroupsByIds(
    activeWorkflowConfig.styleGroupIds,
  );
  const selectedStyleGroupId = getGroupIdForStyleInWorkflow(
    project.style,
    activeWorkflowConfig,
  );
  const selectedStyleGroup = availableStyleGroups.find(
    (group) => group.id === selectedStyleGroupId,
  );
  const styleOptions = getStylesForGroup(selectedStyleGroupId);
  const selectedStyle = getStyleById(project.style);
  const selectedStyleLabel = getStyleLabel(project.style, locale);
  const shouldShowStyleGroupSelect = availableStyleGroups.length > 1;
  const configuredImageProvider = getConfiguredImageProvider(settings);
  const configuredImageModel = configuredImageProvider.model;
  const supportsFlexibleOutputSize =
    configuredImageModel.toLowerCase().includes("gpt-image-2");
  const mainTask = tasks.find((task) => task.role === "main");
  const isConfigurationLocked = Boolean(conversation.configurationLocked);
  const hasMainDetailPrompts = tasks.some(
    (task) => task.role === "main" || task.role === "detail",
  );
  const canGenerateMainImage =
    Boolean(mainDetail.promptAnalyzedAt) &&
    hasMainDetailPrompts &&
    !isAnalyzing &&
    !isGenerating;
  const canGenerateDetailImages =
    mainTask?.status === "completed" &&
    Boolean(mainTask.imagePath) &&
    !isAnalyzing &&
    !isGenerating;
  const modelChoices = visibleProviderAdapterList
    .filter((adapter) => {
      const provider = settings.providers[adapter.id];
      return provider.enabled && provider.apiKeySaved;
    })
    .map((adapter) => ({
      adapter,
      provider: settings.providers[adapter.id],
    }));

  const updateActiveModelProvider = (
    capability: ModelCapability,
    providerId: ProviderId,
  ) => {
    updateSettings({
      activeModelSelection: {
        ...settings.activeModelSelection,
        [capability]: {
          providerId,
        },
      },
    });
  };
  const textModelChoices = modelChoices.filter(({ adapter }) =>
    adapter.capabilities.includes("text"),
  );
  const imageModelChoices = modelChoices.filter(({ adapter }) =>
    adapter.capabilities.includes("image"),
  );
  const activeTextProviderId = textModelChoices.some(
    ({ adapter }) => adapter.id === settings.activeModelSelection.text.providerId,
  )
    ? settings.activeModelSelection.text.providerId
    : (textModelChoices[0]?.adapter.id ?? settings.activeModelSelection.text.providerId);
  const activeImageProviderId = imageModelChoices.some(
    ({ adapter }) => adapter.id === settings.activeModelSelection.image.providerId,
  )
    ? settings.activeModelSelection.image.providerId
    : (imageModelChoices[0]?.adapter.id ??
      settings.activeModelSelection.image.providerId);

  const handleSourceImageChange = (file?: File) => {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result !== "string") {
        return;
      }

      if (!isConversationSaved) {
        setSourceImage({
          id: `source-${Date.now()}`,
          kind: "source",
          imagePath: reader.result,
          name: file.name,
          createdAt: new Date().toISOString(),
        });
        return;
      }

      void saveReferenceImage({
        imageDataUrl: reader.result,
        project,
        conversation,
        name: file.name,
      })
        .then(setSourceImage)
        .catch((error) => {
          console.error("Could not save source image", error);
        });
    });
    reader.readAsDataURL(file);
  };

  useEffect(() => {
    function closeFloatingFields(event: PointerEvent) {
      if (!workflowFieldRef.current?.contains(event.target as Node)) {
        setIsWorkflowOpen(false);
      }
      if (!styleFieldRef.current?.contains(event.target as Node)) {
        setIsStyleOpen(false);
      }
      if (!styleGroupFieldRef.current?.contains(event.target as Node)) {
        setIsStyleGroupOpen(false);
      }
      if (
        isIdeaMenuOpen &&
        !ideaFieldRef.current?.contains(event.target as Node)
      ) {
        setIsIdeaMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", closeFloatingFields, true);
    return () =>
      document.removeEventListener("pointerdown", closeFloatingFields, true);
  }, [isIdeaMenuOpen]);

  useEffect(() => {
    if (!isConfigurationLocked) {
      return;
    }

    setIsWorkflowOpen(false);
    setIsStyleGroupOpen(false);
    setIsStyleOpen(false);
    setIsIdeaMenuOpen(false);
  }, [isConfigurationLocked]);

  return (
    <aside className="prompt-panel" aria-label={t(locale, "promptControls")}>
      <section className="panel-section model-selection-section">
        <label className="field-label icon-label" htmlFor="active-text-model">
          <Type size={15} aria-hidden="true" />
          {t(locale, "activeTextModel")}
        </label>
        <select
          id="active-text-model"
          className="settings-input"
          value={activeTextProviderId}
          disabled={isAnalyzing || isGenerating || textModelChoices.length === 0}
          onChange={(event) =>
            updateActiveModelProvider("text", event.target.value as ProviderId)
          }
        >
          {textModelChoices.length === 0 ? (
            <option value={settings.activeModelSelection.text.providerId}>
              {t(locale, "noConfiguredProvider")}
            </option>
          ) : (
            textModelChoices.map(({ adapter, provider }) => (
              <option key={adapter.id} value={adapter.id}>
                {formatModelChoice(
                  t(locale, adapter.labelKey),
                  provider.textModel.model,
                  t(locale, "modelNotSelected"),
                )}
              </option>
            ))
          )}
        </select>
        <label className="field-label icon-label" htmlFor="active-image-model">
          <Image size={15} aria-hidden="true" />
          {t(locale, "activeImageModel")}
        </label>
        <select
          id="active-image-model"
          className="settings-input"
          value={activeImageProviderId}
          disabled={isAnalyzing || isGenerating || imageModelChoices.length === 0}
          onChange={(event) =>
            updateActiveModelProvider("image", event.target.value as ProviderId)
          }
        >
          {imageModelChoices.length === 0 ? (
            <option value={settings.activeModelSelection.image.providerId}>
              {t(locale, "noConfiguredProvider")}
            </option>
          ) : (
            imageModelChoices.map(({ adapter, provider }) => (
              <option key={adapter.id} value={adapter.id}>
                {formatModelChoice(
                  t(locale, adapter.labelKey),
                  provider.imageModel.model,
                  t(locale, "modelNotSelected"),
                )}
              </option>
            ))
          )}
        </select>
      </section>

      <section className="panel-section">
        <label className="field-label" htmlFor="workflow-select">
          {t(locale, "workflowMode")}
        </label>
        <div className="select-field" ref={workflowFieldRef}>
          <button
            id="workflow-select"
            className="select-trigger"
            type="button"
            aria-controls="workflow-select-options"
            aria-expanded={isWorkflowOpen}
            aria-haspopup="listbox"
            disabled={isConfigurationLocked || isAnalyzing || isGenerating}
            onClick={() => setIsWorkflowOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setIsWorkflowOpen(false);
              }
            }}
          >
            <span>
              {activeWorkflowConfig.name}
            </span>
            <ChevronDown
              className={isWorkflowOpen ? "select-arrow open" : "select-arrow"}
              size={18}
              aria-hidden="true"
            />
          </button>

          {isWorkflowOpen ? (
            <div
              className="select-menu"
              id="workflow-select-options"
              role="listbox"
              aria-labelledby="workflow-select"
            >
              {workflowOptions.map((option) => {
                const isSelected = workflowMode === option.id;

                return (
                  <button
                    className={
                      isSelected ? "select-option selected" : "select-option"
                    }
                    key={option.id}
                    role="option"
                    aria-selected={isSelected}
                    type="button"
                    onClick={() => {
                      setWorkflowMode(option.id);
                      setIsWorkflowOpen(false);
                      setIsStyleGroupOpen(false);
                      setIsStyleOpen(false);
                    }}
                  >
                    <span>{option.name}</span>
                    {isSelected ? <Check size={16} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel-section">
        <div className="section-title">
          <Sparkles size={17} aria-hidden="true" />
          <h2>{t(locale, "sourceIdea")}</h2>
        </div>
        <div
          className="idea-input-shell"
          ref={ideaFieldRef}
          onPointerDownCapture={(event) => {
            if (
              isIdeaMenuOpen &&
              !(event.target as Element).closest(".idea-add-menu")
            ) {
              setIsIdeaMenuOpen(false);
            }
          }}
        >
          <textarea
            aria-label={t(locale, "originalPrompt")}
            className="prompt-input idea-prompt-input"
            disabled={isConfigurationLocked}
            value={project.originalPrompt}
            onFocus={() => setIsIdeaMenuOpen(false)}
            onChange={(event) => setOriginalPrompt(event.target.value)}
          />
          {workflowMode === "main-detail" && mainDetail.sourceImage ? (
            <div className="idea-attachment">
              <img
                alt={mainDetail.sourceImage.name ?? t(locale, "sourceImage")}
                src={getImageSource(mainDetail.sourceImage.imagePath)}
              />
              <div>
                <strong title={mainDetail.sourceImage.name}>
                  {mainDetail.sourceImage.name ?? t(locale, "sourceImageReady")}
                </strong>
              </div>
              <button
                type="button"
                disabled={isConfigurationLocked}
                onClick={() => setSourceImage(undefined)}
              >
                {t(locale, "clearSourceImage")}
              </button>
            </div>
          ) : null}
          <div className="idea-input-toolbar">
            {workflowMode === "main-detail" ? (
              <div className="idea-add-menu">
                <button
                  className="idea-add-button"
                  type="button"
                  title={t(locale, "addIdeaAsset")}
                  aria-haspopup="menu"
                  aria-expanded={isIdeaMenuOpen}
                  disabled={isConfigurationLocked}
                  onClick={() => setIsIdeaMenuOpen((open) => !open)}
                >
                  <Plus size={14} aria-hidden="true" />
                </button>
                {isIdeaMenuOpen && !isConfigurationLocked ? (
                  <div className="idea-menu" role="menu">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        sourceImageInputRef.current?.click();
                        setIsIdeaMenuOpen(false);
                      }}
                    >
                      <ImagePlus size={15} aria-hidden="true" />
                      {t(locale, "uploadSourceImage")}
                    </button>
                  </div>
                ) : null}
                <input
                  accept="image/*"
                  ref={sourceImageInputRef}
                  type="file"
                  disabled={isConfigurationLocked}
                  onChange={(event) => {
                    handleSourceImageChange(event.target.files?.[0]);
                    event.currentTarget.value = "";
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="panel-section">
        {shouldShowStyleGroupSelect ? (
          <>
            <label className="field-label" htmlFor="style-group-select">
              {t(locale, "styleGroup")}
            </label>
            <div className="select-field" ref={styleGroupFieldRef}>
              <button
                id="style-group-select"
                className="select-trigger"
                type="button"
                aria-controls="style-group-select-options"
                aria-expanded={isStyleGroupOpen}
                aria-haspopup="listbox"
                disabled={isConfigurationLocked}
                onClick={() => setIsStyleGroupOpen((open) => !open)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setIsStyleGroupOpen(false);
                  }
                }}
              >
                <span>{selectedStyleGroup?.label[locale] ?? ""}</span>
                <ChevronDown
                  className={
                    isStyleGroupOpen ? "select-arrow open" : "select-arrow"
                  }
                  size={18}
                  aria-hidden="true"
                />
              </button>

              {isStyleGroupOpen ? (
                <div
                  className="select-menu"
                  id="style-group-select-options"
                  role="listbox"
                  aria-labelledby="style-group-select"
                >
                  {availableStyleGroups.map((group) => {
                    const isSelected = selectedStyleGroupId === group.id;
                    const defaultGroupStyle = getStylesForGroup(group.id)[0];

                    return (
                      <button
                        className={
                          isSelected
                            ? "select-option selected"
                            : "select-option"
                        }
                        key={group.id}
                        role="option"
                        aria-selected={isSelected}
                        type="button"
                        onClick={() => {
                          if (defaultGroupStyle) {
                            setStyle(defaultGroupStyle.id);
                          }
                          setIsStyleGroupOpen(false);
                          setIsStyleOpen(false);
                        }}
                      >
                        <span>{group.label[locale]}</span>
                        {isSelected ? (
                          <Check size={16} aria-hidden="true" />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
        <label className="field-label" htmlFor="style-select">
          {t(locale, "style")}
        </label>
        <div className="select-field" ref={styleFieldRef}>
          <button
            id="style-select"
            className="select-trigger"
            type="button"
            aria-controls="style-select-options"
            aria-expanded={isStyleOpen}
            aria-haspopup="listbox"
            disabled={isConfigurationLocked}
            onClick={() => setIsStyleOpen((open) => !open)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setIsStyleOpen(false);
              }
            }}
          >
            <span>{selectedStyleLabel}</span>
            <ChevronDown
              className={isStyleOpen ? "select-arrow open" : "select-arrow"}
              size={18}
              aria-hidden="true"
            />
          </button>

          {isStyleOpen ? (
            <div
              className="select-menu"
              id="style-select-options"
              role="listbox"
              aria-labelledby="style-select"
            >
              {styleOptions.map((style) => {
                const isSelected = selectedStyle?.id === style.id;

                return (
                  <button
                    className={
                      isSelected ? "select-option selected" : "select-option"
                    }
                    key={style.id}
                    role="option"
                    aria-selected={isSelected}
                    type="button"
                    onClick={() => {
                      setStyle(style.id);
                      setIsStyleOpen(false);
                    }}
                  >
                    <span className="style-option-copy">
                      <strong>{style.label[locale]}</strong>
                      <small>{style.usage[locale]}</small>
                      <span className="style-option-tags">
                        {style.tags[locale].map((tag) => (
                          <em key={tag}>{tag}</em>
                        ))}
                      </span>
                    </span>
                    {isSelected ? <Check size={16} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
        {selectedStyle ? (
          <p className="style-usage-hint">{selectedStyle.usage[locale]}</p>
        ) : null}
      </section>

      <section className="panel-section">
        <span className="field-label">{t(locale, "aspectRatio")}</span>
        <div className="segmented-control">
          {aspectRatioOptions.map((ratio) => (
            <button
              className={project.aspectRatio === ratio ? "active" : ""}
              disabled={isConfigurationLocked}
              key={ratio}
              type="button"
              onClick={() => setAspectRatio(ratio as AspectRatio)}
            >
              {ratio}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <span className="field-label">{t(locale, "quality")}</span>
        <div className="segmented-control">
          {qualityOptions.map((quality) => (
            <button
              className={project.quality === quality ? "active" : ""}
              disabled={isConfigurationLocked}
              key={quality}
              type="button"
              onClick={() => setQuality(quality as Quality)}
            >
              {qualityLabels[locale][quality]}
            </button>
          ))}
        </div>
      </section>

      <section className="panel-section">
        <span className="field-label">{t(locale, "outputSize")}</span>
        <div className="segmented-control">
          {outputSizeOptions.map((outputSize) => {
            const requiresFlexibleSize =
              outputSize === "2k" || outputSize === "4k";
            const isDisabled =
              isConfigurationLocked ||
              (requiresFlexibleSize && !supportsFlexibleOutputSize);

            return (
              <button
                className={project.outputSize === outputSize ? "active" : ""}
                disabled={isDisabled}
                key={outputSize}
                title={
                  requiresFlexibleSize && !supportsFlexibleOutputSize
                    ? t(locale, "outputSizeRequiresGptImage2")
                    : ""
                }
                type="button"
                onClick={() => setOutputSize(outputSize as OutputSize)}
              >
                {outputSizeLabels[locale][outputSize]}
              </button>
            );
          })}
        </div>
      </section>

      {workflowMode === "text-grid" ? (
        <div className="action-stack">
          <button
            className="primary-action"
            type="button"
            onClick={analyzePrompt}
            disabled={isAnalyzing || isGenerating}
          >
            <Wand2 size={18} aria-hidden="true" />
            {isAnalyzing ? t(locale, "analyzing") : t(locale, "analyzePrompts")}
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={generateImages}
            disabled={isGenerating || isAnalyzing || !isConversationSaved}
            title={!isConversationSaved ? t(locale, "analyzeBeforeGenerate") : ""}
          >
            <Play size={18} aria-hidden="true" />
            {isGenerating ? t(locale, "generating") : t(locale, "generateImages")}
          </button>
        </div>
      ) : (
        <div className="action-stack">
          <button
            className="primary-action"
            type="button"
            onClick={analyzeMainDetailPrompt}
            disabled={isAnalyzing || isGenerating}
          >
            <Wand2 size={18} aria-hidden="true" />
            {isAnalyzing
              ? t(locale, "analyzing")
              : t(locale, "analyzeMainDetailPrompts")}
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={generateMainImage}
            disabled={!canGenerateMainImage}
            title={
              !mainDetail.promptAnalyzedAt ? t(locale, "analyzeBeforeGenerate") : ""
            }
          >
            <Play size={18} aria-hidden="true" />
            {isGenerating ? t(locale, "generating") : t(locale, "generateMainImage")}
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={generateDetailImages}
            disabled={!canGenerateDetailImages}
            title={
              !canGenerateDetailImages ? t(locale, "generateMainBeforeDetails") : ""
            }
          >
            <Play size={18} aria-hidden="true" />
            {t(locale, "generateDetailImages")}
          </button>
        </div>
      )}
    </aside>
  );
}

function getImageSource(imagePath: string) {
  if (imagePath.startsWith("data:image/")) {
    return imagePath;
  }

  return isTauri() ? convertFileSrc(imagePath) : imagePath;
}

function formatModelChoice(
  providerLabel: string,
  model: string,
  fallback: string,
) {
  const selectedModel = model.trim() || fallback;
  return `${providerLabel} / ${selectedModel}`;
}
