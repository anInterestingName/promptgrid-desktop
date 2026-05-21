import {
  Activity,
  AlertCircle,
  Check,
  ChevronDown,
  Cpu,
  Database,
  Eye,
  EyeOff,
  Folder,
  KeyRound,
  Link2,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { aspectRatioOptions } from "../data/mockProject";
import { t, type Locale, type MessageKey } from "../i18n";
import {
  clearProviderApiKey,
  fetchProviderModels,
  saveProviderApiKey,
  testProviderConnection,
} from "../services/modelConfig";
import {
  getStorageInfo,
  pickDataDirectory,
  setDataDirectory,
  type StorageInfo,
} from "../services/localPersistence";
import { usePromptGridStore } from "../state/usePromptGridStore";
import type {
  ApiProvider,
  AppSettings,
  AspectRatio,
  GridSize,
  ModelOption,
  ReasoningEffort,
  ResponseVerbosity,
} from "../types";

const providerOptions: Array<{
  value: ApiProvider;
  labelKey: MessageKey;
}> = [
  { value: "openai", labelKey: "providerOpenAI" },
  { value: "custom", labelKey: "providerCustom" },
];

const gridSizeOptions = [9, 16, 25] as const;

const reasoningEffortOptions: Array<{
  value: ReasoningEffort;
  labelKey: MessageKey;
}> = [
  { value: "low", labelKey: "reasoningLow" },
  { value: "medium", labelKey: "reasoningMedium" },
  { value: "high", labelKey: "reasoningHigh" },
  { value: "xhigh", labelKey: "reasoningXHigh" },
];

const verbosityOptions: Array<{
  value: ResponseVerbosity;
  labelKey: MessageKey;
}> = [
  { value: "low", labelKey: "verbosityLow" },
  { value: "medium", labelKey: "verbosityMedium" },
  { value: "high", labelKey: "verbosityHigh" },
];

const storageStatusKeys = {
  idle: "saveStateIdle",
  loading: "saveStateLoading",
  saving: "saveStateSaving",
  saved: "saveStateSaved",
  error: "saveStateError",
} satisfies Record<string, MessageKey>;

type ModelFetchStatus = "idle" | "loading" | "ready" | "error";
type ModelTestStatus = "idle" | "loading" | "ready" | "error";
type ModelTestKind = "text" | "image";
type ModelTestStatuses = Record<ModelTestKind, ModelTestStatus>;
type StorageActionStatus = "idle" | "loading" | "ready" | "error";
type ModelNotice = {
  message: string;
  tone: "error" | "success";
  titleKey: MessageKey;
};

export function SettingsWorkspace() {
  const locale = usePromptGridStore((state) => state.locale);
  const settings = usePromptGridStore((state) => state.settings);
  const storageStatus = usePromptGridStore((state) => state.storageStatus);
  const updateSettings = usePromptGridStore((state) => state.updateSettings);
  const [showOpenAiKey, setShowOpenAiKey] = useState(false);
  const [showCustomKey, setShowCustomKey] = useState(false);
  const [openAiApiKeyDraft, setOpenAiApiKeyDraft] = useState("");
  const [customApiKeyDraft, setCustomApiKeyDraft] = useState("");
  const [secretActionProvider, setSecretActionProvider] =
    useState<ApiProvider | null>(null);
  const [secretError, setSecretError] = useState<{
    provider: ApiProvider;
    message: string;
  } | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
  const [modelOptionsProvider, setModelOptionsProvider] =
    useState<ApiProvider | null>(null);
  const [modelFetchStatus, setModelFetchStatus] =
    useState<ModelFetchStatus>("idle");
  const [modelTestStatuses, setModelTestStatuses] =
    useState<ModelTestStatuses>({ text: "idle", image: "idle" });
  const [modelNotice, setModelNotice] = useState<ModelNotice | null>(null);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [storageDirectoryDraft, setStorageDirectoryDraft] = useState("");
  const [storageActionStatus, setStorageActionStatus] =
    useState<StorageActionStatus>("idle");
  const [storageNotice, setStorageNotice] = useState<ModelNotice | null>(null);

  const updateSetting = <Key extends keyof AppSettings>(
    key: Key,
    value: AppSettings[Key],
  ) => {
    updateSettings({ [key]: value });
  };

  const buildModelFetchRequest = useCallback(
    (provider: ApiProvider) => ({
      provider,
      baseUrl:
        provider === "openai"
          ? settings.openAiBaseUrl
          : settings.customBaseUrl ?? "",
      customHeaders:
        provider === "custom" ? settings.customHeaders : undefined,
    }),
    [settings.customBaseUrl, settings.customHeaders, settings.openAiBaseUrl],
  );

  useEffect(() => {
    let isMounted = true;

    void getStorageInfo()
      .then((info) => {
        if (!isMounted || !info) {
          return;
        }

        setStorageInfo(info);
        setStorageDirectoryDraft(info.currentDataDir);
      })
      .catch(() => {
        if (isMounted) {
          setStorageActionStatus("error");
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const applyDataDirectory = async (directory?: string) => {
    setStorageActionStatus("loading");
    setStorageNotice(null);

    try {
      const info = await setDataDirectory(directory);
      if (info) {
        setStorageInfo(info);
        setStorageDirectoryDraft(info.currentDataDir);
        updateSettings({
          outputDirectory: info.usesCustomDataDir
            ? info.currentDataDir
            : undefined,
        });
      } else {
        updateSettings({
          outputDirectory: directory?.trim() || undefined,
        });
      }

      setStorageActionStatus("ready");
      setStorageNotice({
        titleKey: "storageFolderSaved",
        tone: "success",
        message: info?.currentDataDir ?? t(locale, "defaultStorageFolder"),
      });
    } catch (error) {
      setStorageActionStatus("error");
      setStorageNotice({
        titleKey: "storageFolderError",
        tone: "error",
        message: getErrorMessage(error),
      });
    }
  };

  const selectDataDirectory = async () => {
    setStorageActionStatus("loading");
    setStorageNotice(null);

    try {
      const selectedDirectory = await pickDataDirectory();
      if (!selectedDirectory) {
        setStorageActionStatus("idle");
        return;
      }

      await applyDataDirectory(selectedDirectory);
    } catch (error) {
      setStorageActionStatus("error");
      setStorageNotice({
        titleKey: "storageFolderError",
        tone: "error",
        message: getErrorMessage(error),
      });
    }
  };

  const setModelTestStatus = (
    kind: ModelTestKind,
    status: ModelTestStatus,
  ) => {
    setModelTestStatuses((statuses) => ({
      ...statuses,
      [kind]: status,
    }));
  };

  const resetModelTestStatuses = () => {
    setModelTestStatuses({ text: "idle", image: "idle" });
  };

  const buildModelTestRequest = useCallback(
    (provider: ApiProvider, kind: ModelTestKind) => ({
      ...buildModelFetchRequest(provider),
      kind,
      reasoningEnabled: settings.reasoningEnabled,
      reasoningEffort: settings.reasoningEffort,
      responseVerbosity: settings.responseVerbosity,
      streamResponses: settings.streamResponses,
      model:
        kind === "text"
          ? provider === "openai"
            ? settings.textModel
            : settings.customTextModel ?? ""
          : provider === "openai"
            ? settings.imageModel
            : settings.customImageModel ?? "",
    }),
    [
      buildModelFetchRequest,
      settings.customImageModel,
      settings.customTextModel,
      settings.imageModel,
      settings.reasoningEffort,
      settings.reasoningEnabled,
      settings.responseVerbosity,
      settings.streamResponses,
      settings.textModel,
    ],
  );

  const fetchModelsForProvider = useCallback(
    async (
      provider: ApiProvider,
      options: { assumeApiKeySaved?: boolean } = {},
    ) => {
      const request = buildModelFetchRequest(provider);
      const isApiKeySaved =
        options.assumeApiKeySaved ||
        (provider === "openai"
          ? settings.openAiApiKeySaved
          : settings.customApiKeySaved);

      if (!request.baseUrl.trim()) {
        const errorMessage = t(locale, "baseUrlRequiredForModelFetch");
        setModelOptions([]);
        setModelOptionsProvider(provider);
        setModelFetchStatus("error");
        setModelNotice({
          titleKey: "modelsFetchError",
          tone: "error",
          message: errorMessage,
        });
        return;
      }

      if (!isApiKeySaved) {
        const errorMessage = t(locale, "apiKeyRequiredForModelFetch");
        setModelOptions([]);
        setModelOptionsProvider(provider);
        setModelFetchStatus("error");
        setModelNotice({
          titleKey: "modelsFetchError",
          tone: "error",
          message: errorMessage,
        });
        return;
      }

      setModelFetchStatus("loading");
      setModelOptionsProvider(provider);
      setModelNotice(null);

      try {
        const models = await fetchProviderModels(request);
        setModelOptions(models);
        setModelOptionsProvider(provider);
        setModelFetchStatus("ready");
        setModelNotice(null);

        if (models[0] && provider === "custom") {
          const settingsUpdate: Partial<AppSettings> = {};

          if (
            !settings.customTextModel ||
            settings.customTextModel === "custom-text-model"
          ) {
            settingsUpdate.customTextModel =
              getSuggestedModelId(models, "text") ?? models[0].id;
          }

          if (
            !settings.customImageModel ||
            settings.customImageModel === "custom-image-model"
          ) {
            settingsUpdate.customImageModel = getSuggestedModelId(
              models,
              "image",
            );
          }

          if (Object.keys(settingsUpdate).length > 0) {
            updateSettings(settingsUpdate);
          }
        }
      } catch (error) {
        const errorMessage = getModelFetchErrorMessage(locale, error);
        setModelOptions([]);
        setModelOptionsProvider(provider);
        setModelFetchStatus("error");
        setModelNotice({
          titleKey: "modelsFetchError",
          tone: "error",
          message: errorMessage,
        });
      }
    },
    [
      buildModelFetchRequest,
      locale,
      settings.customApiKeySaved,
      settings.customImageModel,
      settings.customTextModel,
      settings.openAiApiKeySaved,
      updateSettings,
    ],
  );

  const fetchModels = (provider: ApiProvider) => {
    void fetchModelsForProvider(provider);
  };

  const testConnection = async (provider: ApiProvider, kind: ModelTestKind) => {
    const request = buildModelTestRequest(provider, kind);
    const isApiKeySaved =
      provider === "openai"
        ? settings.openAiApiKeySaved
        : settings.customApiKeySaved;

    if (!request.baseUrl.trim()) {
      setModelTestStatus(kind, "error");
      setModelNotice({
        titleKey: "modelTestError",
        tone: "error",
        message: t(locale, "baseUrlRequiredForModelTest"),
      });
      return;
    }

    if (!isApiKeySaved) {
      setModelTestStatus(kind, "error");
      setModelNotice({
        titleKey: "modelTestError",
        tone: "error",
        message: t(locale, "apiKeyRequiredForModelTest"),
      });
      return;
    }

    if (!request.model.trim()) {
      setModelTestStatus(kind, "error");
      setModelNotice({
        titleKey: "modelTestError",
        tone: "error",
        message: t(
          locale,
          kind === "image"
            ? "imageModelRequiredForModelTest"
            : "textModelRequiredForModelTest",
        ),
      });
      return;
    }

    setModelTestStatus(kind, "loading");
    setModelNotice(null);

    try {
      const result = await testProviderConnection(request);
      setModelTestStatus(kind, "ready");
      setModelNotice({
        titleKey:
          kind === "image" ? "imageModelTestReady" : "textModelTestReady",
        tone: "success",
        message:
          kind === "image"
            ? t(locale, "imageModelTestOutput")
            : t(locale, "modelTestOutput").replace("{output}", result.output),
      });
    } catch (error) {
      setModelTestStatus(kind, "error");
      setModelNotice({
        titleKey: "modelTestError",
        tone: "error",
        message: getModelTestErrorMessage(locale, error, kind),
      });
    }
  };

  const saveApiKey = async (provider: ApiProvider, apiKey: string) => {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) {
      return;
    }

    setSecretActionProvider(provider);
    setSecretError(null);

    try {
      const isSaved = await saveProviderApiKey(provider, trimmedKey);
      updateSettings(
        provider === "openai"
          ? { openAiApiKeySaved: isSaved }
          : { customApiKeySaved: isSaved },
      );

      if (provider === "openai") {
        setOpenAiApiKeyDraft("");
      } else {
        setCustomApiKeyDraft("");
      }
      setModelOptions([]);
      setModelOptionsProvider(null);
      setModelFetchStatus("idle");
      setModelNotice(null);
      resetModelTestStatuses();
    } catch (error) {
      setSecretError({ provider, message: getErrorMessage(error) });
    } finally {
      setSecretActionProvider(null);
    }
  };

  const clearApiKey = async (provider: ApiProvider) => {
    setSecretActionProvider(provider);
    setSecretError(null);

    try {
      const isSaved = await clearProviderApiKey(provider);
      updateSettings(
        provider === "openai"
          ? { openAiApiKeySaved: isSaved }
          : { customApiKeySaved: isSaved },
      );
      setModelOptions([]);
      setModelOptionsProvider(null);
      setModelFetchStatus("idle");
      resetModelTestStatuses();
      setModelNotice(null);
    } catch (error) {
      setSecretError({ provider, message: getErrorMessage(error) });
    } finally {
      setSecretActionProvider(null);
    }
  };

  return (
    <section
      className="settings-workspace"
      aria-label={t(locale, "settingsPageAria")}
    >
      <div className="settings-section">
        <SectionHeader
          icon={Cpu}
          locale={locale}
          titleKey="modelConfiguration"
        />

        <div className="settings-field">
          <span>{t(locale, "activeProvider")}</span>
          <div
            className="provider-switch"
            role="group"
            aria-label={t(locale, "activeProvider")}
          >
            {providerOptions.map((option) => (
              <button
                className={settings.apiProvider === option.value ? "active" : ""}
                key={option.value}
                type="button"
                onClick={() => {
                  updateSetting("apiProvider", option.value);
                  setModelOptions([]);
                  setModelOptionsProvider(null);
                  setModelFetchStatus("idle");
                  resetModelTestStatuses();
                  setModelNotice(null);
                }}
              >
                {t(locale, option.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="model-config-grid">
          {settings.apiProvider === "openai" ? (
            <div className="model-config-panel active">
            <div className="model-config-title-row">
              <div className="model-config-title">
                <SlidersHorizontal size={17} aria-hidden="true" />
                <h3>{t(locale, "openAiConfiguration")}</h3>
              </div>
              <div className="model-config-actions">
                <FetchModelsControl
                  count={
                    modelOptionsProvider === "openai" ? modelOptions.length : 0
                  }
                  locale={locale}
                  status={modelFetchStatus}
                  onFetch={() => fetchModels("openai")}
                />
                <TestConnectionControl
                  labelKey="testTextModel"
                  locale={locale}
                  readyKey="textModelTestReady"
                  status={modelTestStatuses.text}
                  onTest={() => void testConnection("openai", "text")}
                />
                <TestConnectionControl
                  labelKey="testImageModel"
                  locale={locale}
                  readyKey="imageModelTestReady"
                  status={modelTestStatuses.image}
                  onTest={() => void testConnection("openai", "image")}
                />
              </div>
            </div>
            <SettingsNoticeSlot
              locale={locale}
              notice={modelNotice}
              onDismiss={() => setModelNotice(null)}
            />
            <div className="settings-fields two-columns">
              <label className="settings-field">
                <FieldLabel labelKey="baseUrl" locale={locale} required />
                <div className="input-with-icon">
                  <Link2 size={16} aria-hidden="true" />
                  <input
                    aria-required="true"
                    className="settings-input"
                    required
                    value={settings.openAiBaseUrl}
                    onChange={(event) => {
                      updateSetting("openAiBaseUrl", event.target.value);
                      resetModelTestStatuses();
                    }}
                  />
                </div>
              </label>
              <SecretField
                actionPending={secretActionProvider === "openai"}
                error={secretError?.provider === "openai" ? secretError.message : ""}
                isSaved={settings.openAiApiKeySaved}
                isVisible={showOpenAiKey}
                labelKey="apiKey"
                locale={locale}
                value={openAiApiKeyDraft}
                onClear={() => void clearApiKey("openai")}
                onSave={() => void saveApiKey("openai", openAiApiKeyDraft)}
                onToggle={() => setShowOpenAiKey((isVisible) => !isVisible)}
                onChange={setOpenAiApiKeyDraft}
              />
              <ModelField
                fieldId="openai-text-model"
                labelKey="textModel"
                locale={locale}
                options={modelOptionsProvider === "openai" ? modelOptions : []}
                value={settings.textModel}
                onChange={(value) => {
                  updateSetting("textModel", value);
                  setModelTestStatus("text", "idle");
                }}
              />
              <ModelField
                fieldId="openai-image-model"
                labelKey="imageModel"
                locale={locale}
                options={modelOptionsProvider === "openai" ? modelOptions : []}
                value={settings.imageModel}
                onChange={(value) => {
                  updateSetting("imageModel", value);
                  setModelTestStatus("image", "idle");
                }}
              />
              <RuntimeParameters
                locale={locale}
                settings={settings}
                onChange={(settingsUpdate) => {
                  updateSettings(settingsUpdate);
                  resetModelTestStatuses();
                }}
              />
            </div>
            </div>
          ) : (
            <div className="model-config-panel active">
            <div className="model-config-title-row">
              <div className="model-config-title">
                <SlidersHorizontal size={17} aria-hidden="true" />
                <h3>{t(locale, "customProviderConfiguration")}</h3>
              </div>
              <div className="model-config-actions">
                <FetchModelsControl
                  count={
                    modelOptionsProvider === "custom" ? modelOptions.length : 0
                  }
                  locale={locale}
                  status={modelFetchStatus}
                  onFetch={() => fetchModels("custom")}
                />
                <TestConnectionControl
                  labelKey="testTextModel"
                  locale={locale}
                  readyKey="textModelTestReady"
                  status={modelTestStatuses.text}
                  onTest={() => void testConnection("custom", "text")}
                />
                <TestConnectionControl
                  labelKey="testImageModel"
                  locale={locale}
                  readyKey="imageModelTestReady"
                  status={modelTestStatuses.image}
                  onTest={() => void testConnection("custom", "image")}
                />
              </div>
            </div>
            <SettingsNoticeSlot
              locale={locale}
              notice={modelNotice}
              onDismiss={() => setModelNotice(null)}
            />
            <div className="settings-fields two-columns">
              <label className="settings-field wide-field">
                <span>{t(locale, "providerName")}</span>
                <input
                  className="settings-input"
                  placeholder={t(locale, "customProviderNamePlaceholder")}
                  value={settings.customProviderName ?? ""}
                  onChange={(event) =>
                    updateSetting("customProviderName", event.target.value)
                  }
                />
              </label>
              <label className="settings-field">
                <FieldLabel labelKey="baseUrl" locale={locale} required />
                <div className="input-with-icon">
                  <Link2 size={16} aria-hidden="true" />
                  <input
                    aria-required="true"
                    className="settings-input"
                    placeholder={t(locale, "customBaseUrlPlaceholder")}
                    required
                    value={settings.customBaseUrl ?? ""}
                    onChange={(event) => {
                      updateSetting("customBaseUrl", event.target.value);
                      resetModelTestStatuses();
                    }}
                  />
                </div>
              </label>
              <SecretField
                actionPending={secretActionProvider === "custom"}
                error={secretError?.provider === "custom" ? secretError.message : ""}
                isSaved={settings.customApiKeySaved}
                isVisible={showCustomKey}
                labelKey="apiKey"
                locale={locale}
                value={customApiKeyDraft}
                onClear={() => void clearApiKey("custom")}
                onSave={() => void saveApiKey("custom", customApiKeyDraft)}
                onToggle={() => setShowCustomKey((isVisible) => !isVisible)}
                onChange={setCustomApiKeyDraft}
              />
              <ModelField
                fieldId="custom-text-model"
                labelKey="textModel"
                locale={locale}
                options={modelOptionsProvider === "custom" ? modelOptions : []}
                value={settings.customTextModel ?? ""}
                onChange={(value) => {
                  updateSetting("customTextModel", value);
                  setModelTestStatus("text", "idle");
                }}
              />
              <ModelField
                fieldId="custom-image-model"
                labelKey="imageModel"
                locale={locale}
                options={modelOptionsProvider === "custom" ? modelOptions : []}
                value={settings.customImageModel ?? ""}
                onChange={(value) => {
                  updateSetting("customImageModel", value);
                  setModelTestStatus("image", "idle");
                }}
              />
              <RuntimeParameters
                locale={locale}
                settings={settings}
                onChange={(settingsUpdate) => {
                  updateSettings(settingsUpdate);
                  resetModelTestStatuses();
                }}
              />
              <label className="settings-field">
                <span>{t(locale, "customHeaders")}</span>
                <textarea
                  className="settings-textarea"
                  placeholder={t(locale, "customHeadersPlaceholder")}
                  value={settings.customHeaders ?? ""}
                  onChange={(event) => {
                    updateSetting("customHeaders", event.target.value);
                    resetModelTestStatuses();
                  }}
                />
              </label>
            </div>
            </div>
          )}
        </div>

        <div className="settings-field">
          <span>{t(locale, "saveState")}</span>
          <div className={`save-state save-state-${storageStatus}`}>
            <Save size={16} aria-hidden="true" />
            {t(locale, storageStatusKeys[storageStatus])}
          </div>
        </div>
      </div>

      <div className="settings-section">
        <SectionHeader icon={Database} locale={locale} titleKey="queueDefaults" />
        <div className="settings-fields">
          <label className="settings-field concurrency-field">
            <span>{t(locale, "maxConcurrency")}</span>
            <div className="range-row">
              <input
                className="settings-range"
                min={1}
                max={6}
                type="range"
                value={settings.maxConcurrency}
                onChange={(event) =>
                  updateSetting("maxConcurrency", Number(event.target.value))
                }
              />
              <input
                className="number-input"
                min={1}
                max={6}
                type="number"
                value={settings.maxConcurrency}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  updateSetting(
                    "maxConcurrency",
                    Math.min(6, Math.max(1, value || 1)),
                  );
                }}
              />
            </div>
          </label>
          <div className="settings-field">
            <span>{t(locale, "defaultGridSize")}</span>
            <div className="segmented-control settings-segmented">
              {gridSizeOptions.map((gridSize) => (
                <button
                  className={
                    settings.defaultGridSize === gridSize ? "active" : ""
                  }
                  key={gridSize}
                  type="button"
                  onClick={() =>
                    updateSetting("defaultGridSize", gridSize as GridSize)
                  }
                >
                  {Math.sqrt(gridSize)}x{Math.sqrt(gridSize)}
                </button>
              ))}
            </div>
          </div>
          <div className="settings-field">
            <span>{t(locale, "aspectRatio")}</span>
            <div className="segmented-control settings-segmented">
              {aspectRatioOptions.map((aspectRatio) => (
                <button
                  className={
                    settings.defaultAspectRatio === aspectRatio ? "active" : ""
                  }
                  key={aspectRatio}
                  type="button"
                  onClick={() =>
                    updateSetting(
                      "defaultAspectRatio",
                      aspectRatio as AspectRatio,
                    )
                  }
                >
                  {aspectRatio}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="settings-section">
        <SectionHeader icon={Folder} locale={locale} titleKey="storageSettings" />
        <SettingsNoticeSlot
          locale={locale}
          notice={storageNotice}
          onDismiss={() => setStorageNotice(null)}
        />
        <div className="settings-fields">
          <label className="settings-field wide-field">
            <span>{t(locale, "outputFolder")}</span>
            <input
              className="settings-input"
              placeholder={t(locale, "outputFolderPlaceholder")}
              readOnly
              title={storageDirectoryDraft}
              value={storageDirectoryDraft}
            />
          </label>
          <p className="settings-help">{t(locale, "storageFolderHint")}</p>
          {storageInfo ? (
            <p className="settings-help">
              {t(locale, "currentDatabase")}: {storageInfo.databasePath}
            </p>
          ) : null}
          <div className="settings-actions-row">
            <button
              className="secondary-action compact-action"
              disabled={storageActionStatus === "loading"}
              type="button"
              onClick={() => void selectDataDirectory()}
            >
              <Folder size={16} aria-hidden="true" />
              {t(
                locale,
                storageActionStatus === "loading"
                  ? "applyingStorageFolder"
                  : "selectStorageFolder",
              )}
            </button>
            <button
              className="secondary-action compact-action"
              disabled={
                storageActionStatus === "loading" ||
                !storageInfo?.usesCustomDataDir
              }
              type="button"
              onClick={() => void applyDataDirectory()}
            >
              {t(locale, "defaultStorageFolder")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

type SectionHeaderProps = {
  icon: LucideIcon;
  locale: Locale;
  titleKey: MessageKey;
};

function SectionHeader({ icon: Icon, locale, titleKey }: SectionHeaderProps) {
  return (
    <div className="settings-section-title">
      <Icon size={18} aria-hidden="true" />
      <h2>{t(locale, titleKey)}</h2>
    </div>
  );
}

type FieldLabelProps = {
  labelKey: MessageKey;
  locale: Locale;
  required?: boolean;
};

function FieldLabel({ labelKey, locale, required = false }: FieldLabelProps) {
  return (
    <span className="field-label-row">
      {t(locale, labelKey)}
      {required ? (
        <em className="required-marker" title={t(locale, "requiredField")}>
          *
        </em>
      ) : null}
    </span>
  );
}

type SettingsNoticeProps = {
  locale: Locale;
  message: string;
  tone: ModelNotice["tone"];
  titleKey: MessageKey;
  onDismiss: () => void;
};

type SettingsNoticeSlotProps = {
  locale: Locale;
  notice: ModelNotice | null;
  onDismiss: () => void;
};

function SettingsNoticeSlot({
  locale,
  notice,
  onDismiss,
}: SettingsNoticeSlotProps) {
  return (
    <div
      className={
        notice ? "settings-notice-slot active" : "settings-notice-slot"
      }
    >
      {notice ? (
        <SettingsNotice
          locale={locale}
          message={notice.message}
          tone={notice.tone}
          titleKey={notice.titleKey}
          onDismiss={onDismiss}
        />
      ) : null}
    </div>
  );
}

function SettingsNotice({
  locale,
  message,
  tone,
  titleKey,
  onDismiss,
}: SettingsNoticeProps) {
  const NoticeIcon = tone === "success" ? ShieldCheck : AlertCircle;

  return (
    <div
      className={`settings-notice ${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <NoticeIcon size={18} aria-hidden="true" />
      <div>
        <strong>{t(locale, titleKey)}</strong>
        <p>{message}</p>
      </div>
      <button
        className="notice-dismiss"
        type="button"
        title={t(locale, "dismissNotification")}
        onClick={onDismiss}
      >
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

type SecretFieldProps = {
  actionPending: boolean;
  error: string;
  isSaved: boolean;
  isVisible: boolean;
  labelKey: MessageKey;
  locale: Locale;
  value: string;
  onClear: () => void;
  onChange: (value: string) => void;
  onSave: () => void;
  onToggle: () => void;
};

function SecretField({
  actionPending,
  error,
  isSaved,
  isVisible,
  labelKey,
  locale,
  value,
  onClear,
  onChange,
  onSave,
  onToggle,
}: SecretFieldProps) {
  return (
    <div className="settings-field secret-setting">
      <FieldLabel labelKey={labelKey} locale={locale} required />
      <div className="secret-field">
        <KeyRound size={16} aria-hidden="true" />
        <input
          aria-required={!isSaved}
          className="settings-input"
          placeholder={t(
            locale,
            isSaved ? "apiKeySavedPlaceholder" : "apiKeyPlaceholder",
          )}
          required={!isSaved}
          type={isVisible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          className="secret-toggle"
          type="button"
          title={t(locale, isVisible ? "hideApiKey" : "showApiKey")}
          onClick={onToggle}
        >
          {isVisible ? (
            <EyeOff size={16} aria-hidden="true" />
          ) : (
            <Eye size={16} aria-hidden="true" />
          )}
        </button>
      </div>
      <div className="secret-actions">
        <span
          className={isSaved ? "secret-status saved" : "secret-status"}
          title={t(locale, isSaved ? "apiKeySaved" : "apiKeyNotSaved")}
        >
          <ShieldCheck size={15} aria-hidden="true" />
          {t(locale, isSaved ? "apiKeySaved" : "apiKeyNotSaved")}
        </span>
        <button
          className="secondary-action compact-action"
          disabled={actionPending || !value.trim()}
          type="button"
          onClick={onSave}
        >
          <Save size={15} aria-hidden="true" />
          {t(locale, "saveApiKey")}
        </button>
        <button
          className="secondary-action compact-action"
          disabled={actionPending || !isSaved}
          type="button"
          onClick={onClear}
        >
          <Trash2 size={15} aria-hidden="true" />
          {t(locale, "clearApiKey")}
        </button>
      </div>
      {error ? <p className="settings-error">{error}</p> : null}
    </div>
  );
}

type FetchModelsControlProps = {
  count: number;
  locale: Locale;
  status: ModelFetchStatus;
  onFetch: () => void;
};

function FetchModelsControl({
  count,
  locale,
  status,
  onFetch,
}: FetchModelsControlProps) {
  return (
    <div className="model-fetch-control">
      <button
        className="secondary-action compact-action fetch-models-action"
        disabled={status === "loading"}
        type="button"
        onClick={onFetch}
      >
        <RefreshCw size={15} aria-hidden="true" />
        {t(locale, status === "loading" ? "fetchingModels" : "fetchModels")}
      </button>
      {status === "idle" || status === "error" ? null : (
        <span className={`model-fetch-status ${status}`}>
          {getModelFetchMessage(locale, status, count)}
        </span>
      )}
    </div>
  );
}

type TestConnectionControlProps = {
  labelKey: MessageKey;
  locale: Locale;
  readyKey: MessageKey;
  status: ModelTestStatus;
  onTest: () => void;
};

function TestConnectionControl({
  labelKey,
  locale,
  readyKey,
  status,
  onTest,
}: TestConnectionControlProps) {
  return (
    <div className="model-test-control">
      {status === "ready" ? (
        <span className={`model-test-status ${status}`}>
          {t(locale, readyKey)}
        </span>
      ) : null}
      <button
        className="secondary-action compact-action test-connection-action"
        disabled={status === "loading"}
        type="button"
        onClick={onTest}
      >
        <Activity size={15} aria-hidden="true" />
        {t(locale, status === "loading" ? "testingConnection" : labelKey)}
      </button>
    </div>
  );
}

type RuntimeParametersProps = {
  locale: Locale;
  settings: AppSettings;
  onChange: (settings: Partial<AppSettings>) => void;
};

function RuntimeParameters({
  locale,
  settings,
  onChange,
}: RuntimeParametersProps) {
  return (
    <div className="settings-field wide-field runtime-parameters">
      <span>{t(locale, "runtimeParameters")}</span>
      <div className="runtime-parameter-grid">
        <label className="settings-check">
          <input
            checked={settings.reasoningEnabled}
            type="checkbox"
            onChange={(event) =>
              onChange({ reasoningEnabled: event.target.checked })
            }
          />
          <span>{t(locale, "reasoningMode")}</span>
        </label>
        <div className="settings-field">
          <span>{t(locale, "reasoningEffort")}</span>
          <div className="segmented-control settings-segmented runtime-segmented">
            {reasoningEffortOptions.map((option) => (
              <button
                className={
                  settings.reasoningEffort === option.value ? "active" : ""
                }
                disabled={!settings.reasoningEnabled}
                key={option.value}
                type="button"
                onClick={() => onChange({ reasoningEffort: option.value })}
              >
                {t(locale, option.labelKey)}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-field">
          <span>{t(locale, "responseVerbosity")}</span>
          <div className="segmented-control settings-segmented runtime-segmented">
            {verbosityOptions.map((option) => (
              <button
                className={
                  settings.responseVerbosity === option.value ? "active" : ""
                }
                key={option.value}
                type="button"
                onClick={() => onChange({ responseVerbosity: option.value })}
              >
                {t(locale, option.labelKey)}
              </button>
            ))}
          </div>
        </div>
        <label className="settings-check">
          <input
            checked={settings.streamResponses}
            type="checkbox"
            onChange={(event) =>
              onChange({ streamResponses: event.target.checked })
            }
          />
          <span>{t(locale, "streamResponses")}</span>
        </label>
      </div>
    </div>
  );
}

type ModelFieldProps = {
  fieldId: string;
  labelKey: MessageKey;
  locale: Locale;
  options: ModelOption[];
  value: string;
  onChange: (value: string) => void;
};

function ModelField({
  fieldId,
  labelKey,
  locale,
  options,
  value,
  onChange,
}: ModelFieldProps) {
  const fieldRef = useRef<HTMLLabelElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [filterText, setFilterText] = useState("");
  const menuId = `${fieldId}-menu`;
  const normalizedFilter = filterText.trim().toLowerCase();
  const filteredOptions = useMemo(() => {
    if (!normalizedFilter) {
      return options;
    }

    return options.filter((option) => {
      const id = option.id.toLowerCase();
      const ownedBy = option.ownedBy?.toLowerCase() ?? "";
      return id.includes(normalizedFilter) || ownedBy.includes(normalizedFilter);
    });
  }, [normalizedFilter, options]);
  const visibleOptions = filteredOptions.slice(0, 80);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleDocumentMouseDown = (event: MouseEvent) => {
      if (!fieldRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () =>
      document.removeEventListener("mousedown", handleDocumentMouseDown);
  }, [isOpen]);

  const chooseModel = (modelId: string) => {
    onChange(modelId);
    setFilterText("");
    setIsOpen(false);
  };

  return (
    <label className="settings-field model-combobox-field" ref={fieldRef}>
      <span>{t(locale, labelKey)}</span>
      <div className="model-combobox">
        <input
          aria-autocomplete="list"
          aria-controls={menuId}
          aria-expanded={isOpen}
          className="settings-input"
          placeholder={t(locale, "modelInputPlaceholder")}
          role="combobox"
          value={value}
          onChange={(event) => {
            const nextValue = event.target.value;
            onChange(nextValue);
            setFilterText(nextValue);
            setIsOpen(options.length > 0);
          }}
          onFocus={() => {
            setFilterText("");
            setIsOpen(options.length > 0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && options.length > 0) {
              event.preventDefault();
              setIsOpen(true);
              return;
            }

            if (event.key === "Escape") {
              setIsOpen(false);
              return;
            }

            if (
              event.key === "Enter" &&
              isOpen &&
              visibleOptions.length > 0
            ) {
              event.preventDefault();
              chooseModel(visibleOptions[0].id);
            }
          }}
        />
        <button
          aria-label={t(locale, "openModelOptions")}
          className={isOpen ? "model-combobox-toggle open" : "model-combobox-toggle"}
          disabled={options.length === 0}
          type="button"
          title={t(locale, "openModelOptions")}
          onClick={() => {
            setFilterText("");
            setIsOpen((open) => (options.length > 0 ? !open : false));
          }}
        >
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {isOpen ? (
          <div className="model-options-menu" id={menuId} role="listbox">
            {visibleOptions.length > 0 ? (
              visibleOptions.map((option) => {
                const isSelected = option.id === value;

                return (
                  <button
                    aria-selected={isSelected}
                    className={isSelected ? "model-option selected" : "model-option"}
                    key={option.id}
                    role="option"
                    type="button"
                    onClick={() => chooseModel(option.id)}
                  >
                    <span>{option.id}</span>
                    {option.ownedBy ? <small>{option.ownedBy}</small> : null}
                    {isSelected ? <Check size={15} aria-hidden="true" /> : null}
                  </button>
                );
              })
            ) : (
              <div className="model-options-empty">
                {t(locale, "noModelMatches")}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </label>
  );
}

function getSuggestedModelId(models: ModelOption[], kind: "text" | "image") {
  const hints =
    kind === "image"
      ? ["image", "gpt-image", "dall", "flux", "imagen", "sdxl"]
      : ["gpt", "claude", "gemini", "deepseek", "qwen", "llama", "codex"];

  return models.find((model) => {
    const id = model.id.toLowerCase();
    return hints.some((hint) => id.includes(hint));
  })?.id;
}

function getModelFetchMessage(
  locale: Locale,
  status: ModelFetchStatus,
  count: number,
) {
  if (status === "loading") {
    return t(locale, "fetchingModels");
  }

  if (status === "ready") {
    return count > 0
      ? t(locale, "modelsReady").replace("{count}", String(count))
      : t(locale, "modelsEmpty");
  }

  return t(locale, "modelsFetchError");
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getModelFetchErrorMessage(locale: Locale, error: unknown) {
  const message = getErrorMessage(error);

  if (message.includes("API key is not saved")) {
    return t(locale, "apiKeyRequiredForModelFetch");
  }

  if (message.includes("Base URL is required")) {
    return t(locale, "baseUrlRequiredForModelFetch");
  }

  return message;
}

function getModelTestErrorMessage(
  locale: Locale,
  error: unknown,
  kind: ModelTestKind,
) {
  const message = getErrorMessage(error);

  if (message.includes("API key is not saved")) {
    return t(locale, "apiKeyRequiredForModelTest");
  }

  if (message.includes("Base URL is required")) {
    return t(locale, "baseUrlRequiredForModelTest");
  }

  if (message.includes("Text model is required")) {
    return t(locale, "textModelRequiredForModelTest");
  }

  if (message.includes("Image model is required")) {
    return t(locale, "imageModelRequiredForModelTest");
  }

  if (message.includes("no image output")) {
    return t(locale, "imageModelTestEmptyOutput");
  }

  if (message.includes("empty response")) {
    return t(
      locale,
      kind === "image" ? "imageModelTestEmptyOutput" : "modelTestEmptyOutput",
    );
  }

  return message;
}
