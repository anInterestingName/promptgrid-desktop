import {
  Cpu,
  Database,
  FileText,
  Folder,
  Link2,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { aspectRatioOptions, gridSizeOptions } from "../../data/mockProject";
import { t, type Locale, type MessageKey } from "../../i18n";
import {
  clearProviderApiKey,
  fetchProviderModels,
  saveProviderApiKey,
  testProviderConnection,
} from "../../services/modelConfig";
import { openDebugLogFolder } from "../../services/debugLogging";
import {
  getStorageInfo,
  pickDataDirectory,
  setDataDirectory,
  type StorageInfo,
} from "../../services/localPersistence";
import { usePromptGridStore } from "../../state/usePromptGridStore";
import { getErrorMessage } from "../../shared/utils/error";
import type {
  ApiProvider,
  AppSettings,
  AspectRatio,
  GridSize,
  ModelOption,
} from "../../types";
import {
  FetchModelsControl,
  FieldLabel,
  ModelField,
  RuntimeParameters,
  SecretField,
  SectionHeader,
  SettingsNoticeSlot,
  TestConnectionControl,
} from "./components";
import {
  getModelFetchErrorMessage,
  getModelTestErrorMessage,
  getSuggestedModelId,
} from "./modelSettingsUtils";
import type {
  ModelFetchStatus,
  ModelTestKind,
  ModelTestStatus,
  ModelTestStatuses,
  SettingsNoticeModel as ModelNotice,
  StorageActionStatus,
} from "./types";

const providerOptions: Array<{
  value: ApiProvider;
  labelKey: MessageKey;
}> = [
  { value: "openai", labelKey: "providerOpenAI" },
  { value: "custom", labelKey: "providerCustom" },
];

const storageStatusKeys = {
  idle: "saveStateIdle",
  loading: "saveStateLoading",
  saving: "saveStateSaving",
  saved: "saveStateSaved",
  error: "saveStateError",
} satisfies Record<string, MessageKey>;

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
  const [debugLogStatus, setDebugLogStatus] =
    useState<StorageActionStatus>("idle");
  const [debugLogNotice, setDebugLogNotice] = useState<ModelNotice | null>(null);

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
      debugLoggingEnabled: settings.debugLoggingEnabled,
      debugLogRetentionDays: settings.debugLogRetentionDays,
    }),
    [
      settings.customBaseUrl,
      settings.customHeaders,
      settings.debugLogRetentionDays,
      settings.debugLoggingEnabled,
      settings.openAiBaseUrl,
    ],
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

  const viewDebugLogs = async () => {
    setDebugLogStatus("loading");
    setDebugLogNotice(null);

    try {
      await openDebugLogFolder();
      setDebugLogStatus("ready");
    } catch (error) {
      setDebugLogStatus("error");
      setDebugLogNotice({
        titleKey: "debugLogOpenError",
        tone: "error",
        message: getErrorMessage(error),
      });
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
                  {gridSize}
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
        <SectionHeader icon={FileText} locale={locale} titleKey="debugLogSettings" />
        <SettingsNoticeSlot
          locale={locale}
          notice={debugLogNotice}
          onDismiss={() => setDebugLogNotice(null)}
        />
        <div className="settings-fields">
          <label className="settings-check">
            <input
              checked={settings.debugLoggingEnabled}
              type="checkbox"
              onChange={(event) =>
                updateSetting("debugLoggingEnabled", event.target.checked)
              }
            />
            <span>{t(locale, "debugLoggingEnabled")}</span>
          </label>
          <label className="settings-field">
            <span>{t(locale, "debugLogRetentionDays")}</span>
            <input
              className="number-input"
              min={1}
              max={365}
              type="number"
              value={settings.debugLogRetentionDays}
              onChange={(event) => {
                const value = Number(event.target.value);
                updateSetting(
                  "debugLogRetentionDays",
                  Math.min(365, Math.max(1, value || 1)),
                );
              }}
            />
          </label>
          <p className="settings-help">{t(locale, "debugLogSettingsHint")}</p>
          <div className="settings-actions-row">
            <button
              className="secondary-action compact-action"
              disabled={debugLogStatus === "loading"}
              type="button"
              onClick={() => void viewDebugLogs()}
            >
              <Folder size={16} aria-hidden="true" />
              {t(
                locale,
                debugLogStatus === "loading"
                  ? "openingDebugLogs"
                  : "viewDebugLogs",
              )}
            </button>
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

