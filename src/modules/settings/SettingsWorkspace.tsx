import {
  Cpu,
  Database,
  FileText,
  Folder,
  Link2,
  Save,
  Server,
} from "lucide-react";
import { useEffect, useState } from "react";
import { aspectRatioOptions, gridSizeOptions } from "../../data/mockProject";
import { t, type MessageKey } from "../../i18n";
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
  AppSettings,
  AspectRatio,
  GridSize,
  ModelOption,
  ProviderConfig,
  ProviderId,
  WorkflowConfig,
  WorkflowMode,
} from "../../types";
import {
  createWorkflowTemplateVariables,
  loadExternalWorkflowConfigs,
  renderWorkflowAnalysisTemplate,
  workflowTemplateVariableNames,
} from "../workflows/workflowConfig";
import {
  FetchModelsControl,
  FieldLabel,
  ImageModelParameters,
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
import {
  getProviderAdapter,
  visibleProviderAdapterList,
} from "./providerAdapters";
import type {
  ModelFetchStatus,
  ModelTestKind,
  ModelTestStatus,
  ModelTestStatuses,
  SettingsNoticeModel as ModelNotice,
  StorageActionStatus,
} from "./types";

const storageStatusKeys = {
  idle: "saveStateIdle",
  loading: "saveStateLoading",
  saving: "saveStateSaving",
  saved: "saveStateSaved",
  error: "saveStateError",
} satisfies Record<string, MessageKey>;

export function SettingsWorkspace() {
  const locale = usePromptGridStore((state) => state.locale);
  const project = usePromptGridStore((state) => state.project);
  const mainDetail = usePromptGridStore((state) => state.mainDetail);
  const settings = usePromptGridStore((state) => state.settings);
  const storageStatus = usePromptGridStore((state) => state.storageStatus);
  const updateSettings = usePromptGridStore((state) => state.updateSettings);
  const [apiKeyDrafts, setApiKeyDrafts] = useState<Record<string, string>>({});
  const [visibleApiKeys, setVisibleApiKeys] = useState<Record<string, boolean>>(
    {},
  );
  const [secretActionProvider, setSecretActionProvider] =
    useState<ProviderId | null>(null);
  const [secretError, setSecretError] = useState<{
    provider: ProviderId;
    message: string;
  } | null>(null);
  const [modelOptionsByProvider, setModelOptionsByProvider] = useState<
    Partial<Record<ProviderId, ModelOption[]>>
  >({});
  const [modelFetchStatuses, setModelFetchStatuses] = useState<
    Partial<Record<ProviderId, ModelFetchStatus>>
  >({});
  const [modelTestStatuses, setModelTestStatuses] =
    useState<ModelTestStatuses>({});
  const [modelNotice, setModelNotice] = useState<ModelNotice | null>(null);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [storageDirectoryDraft, setStorageDirectoryDraft] = useState("");
  const [storageActionStatus, setStorageActionStatus] =
    useState<StorageActionStatus>("idle");
  const [storageNotice, setStorageNotice] = useState<ModelNotice | null>(null);
  const [debugLogStatus, setDebugLogStatus] =
    useState<StorageActionStatus>("idle");
  const [debugLogNotice, setDebugLogNotice] = useState<ModelNotice | null>(null);
  const [workflowConfigStatus, setWorkflowConfigStatus] =
    useState<StorageActionStatus>("idle");
  const [workflowConfigNotice, setWorkflowConfigNotice] =
    useState<ModelNotice | null>(null);
  const [selectedWorkflowId, setSelectedWorkflowId] =
    useState<WorkflowMode>("text-grid");
  const [selectedProviderId, setSelectedProviderId] = useState<ProviderId>(
    settings.activeModelSelection.text.providerId,
  );

  const updateSetting = <Key extends keyof AppSettings>(
    key: Key,
    value: AppSettings[Key],
  ) => {
    updateSettings({ [key]: value });
  };

  const updateProvider = (
    providerId: ProviderId,
    update: Partial<ProviderConfig>,
  ) => {
    updateSettings({
      providers: {
        ...settings.providers,
        [providerId]: {
          ...settings.providers[providerId],
          ...update,
        },
      },
    });
  };

  const updateProviderTextModel = (
    providerId: ProviderId,
    update: Partial<ProviderConfig["textModel"]>,
  ) => {
    const provider = settings.providers[providerId];
    updateProvider(providerId, {
      textModel: {
        ...provider.textModel,
        ...update,
      },
    });
    setModelTestStatus(`${providerId}:text`, "idle");
  };

  const updateProviderImageModel = (
    providerId: ProviderId,
    update: Partial<ProviderConfig["imageModel"]>,
  ) => {
    const provider = settings.providers[providerId];
    updateProvider(providerId, {
      imageModel: {
        ...provider.imageModel,
        ...update,
      },
    });
    setModelTestStatus(`${providerId}:image`, "idle");
  };

  const selectedWorkflowConfig = settings.workflowConfigs[selectedWorkflowId];
  const workflowPromptPreview = renderWorkflowAnalysisTemplate(
    selectedWorkflowConfig.analysisTemplate,
    createWorkflowTemplateVariables({
      project,
      hasSourceImage: Boolean(mainDetail.sourceImage),
    }),
  );

  const updateWorkflowConfig = (update: Partial<WorkflowConfig>) => {
    updateSettings({
      workflowConfigs: {
        ...settings.workflowConfigs,
        [selectedWorkflowId]: {
          ...selectedWorkflowConfig,
          ...update,
          id: selectedWorkflowId,
        },
      },
    });
  };

  const reloadWorkflowConfigs = async () => {
    setWorkflowConfigStatus("loading");
    setWorkflowConfigNotice(null);

    try {
      const workflowConfigs = await loadExternalWorkflowConfigs();
      if (!workflowConfigs) {
        throw new Error("Workflow config file returned no workflows");
      }

      updateSettings({ workflowConfigs });
      setWorkflowConfigStatus("ready");
      setWorkflowConfigNotice({
        titleKey: "workflowConfigReloaded",
        tone: "success",
        message: t(locale, "workflowConfigReloadedMessage"),
      });
    } catch (error) {
      setWorkflowConfigStatus("error");
      setWorkflowConfigNotice({
        titleKey: "workflowConfigReloadError",
        tone: "error",
        message: getErrorMessage(error),
      });
    }
  };

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

  useEffect(() => {
    const selectedProviderIsVisible = visibleProviderAdapterList.some(
      (adapter) => adapter.id === selectedProviderId,
    );

    if (settings.providers[selectedProviderId] && selectedProviderIsVisible) {
      return;
    }

    const activeProviderIsVisible = visibleProviderAdapterList.some(
      (adapter) => adapter.id === settings.activeModelSelection.text.providerId,
    );

    setSelectedProviderId(
      activeProviderIsVisible
        ? settings.activeModelSelection.text.providerId
        : visibleProviderAdapterList[0].id,
    );
  }, [
    selectedProviderId,
    settings.activeModelSelection.text.providerId,
    settings.providers,
  ]);

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

  const setModelTestStatus = (key: string, status: ModelTestStatus) => {
    setModelTestStatuses((statuses) => ({
      ...statuses,
      [key]: status,
    }));
  };

  const resetModelTestStatuses = () => {
    setModelTestStatuses({});
  };

  const buildModelFetchRequest = (providerId: ProviderId) => {
    const provider = settings.providers[providerId];
    return {
      channel: "text" as const,
      provider: providerId,
      baseUrl: provider.baseUrl,
      customHeaders: provider.customHeaders,
      debugLoggingEnabled: settings.debugLoggingEnabled,
      debugLogRetentionDays: settings.debugLogRetentionDays,
    };
  };

  const buildModelTestRequest = (
    providerId: ProviderId,
    kind: ModelTestKind,
  ) => {
    const provider = settings.providers[providerId];
    const modelSettings =
      kind === "text" ? provider.textModel : provider.imageModel;
    return {
      channel: kind,
      provider: providerId,
      baseUrl: provider.baseUrl,
      customHeaders: provider.customHeaders,
      kind,
      reasoningEnabled: modelSettings.reasoningEnabled,
      reasoningEffort: modelSettings.reasoningEffort,
      responseVerbosity: modelSettings.responseVerbosity,
      streamResponses: modelSettings.streamResponses,
      model: modelSettings.model,
      debugLoggingEnabled: settings.debugLoggingEnabled,
      debugLogRetentionDays: settings.debugLogRetentionDays,
    };
  };

  const fetchModels = async (providerId: ProviderId) => {
    const provider = settings.providers[providerId];
    const adapter = getProviderAdapter(providerId);

    if (!adapter.supportsModelList) {
      return;
    }

    if (!provider.baseUrl.trim()) {
      setModelFetchStatus(providerId, "error");
      setModelNotice({
        titleKey: "modelsFetchError",
        tone: "error",
        message: t(locale, "baseUrlRequiredForModelFetch"),
      });
      return;
    }

    if (!provider.apiKeySaved) {
      setModelFetchStatus(providerId, "error");
      setModelNotice({
        titleKey: "modelsFetchError",
        tone: "error",
        message: t(locale, "apiKeyRequiredForModelFetch"),
      });
      return;
    }

    setModelFetchStatus(providerId, "loading");
    setModelNotice(null);

    try {
      const models = await fetchProviderModels(buildModelFetchRequest(providerId));
      setModelOptionsByProvider((options) => ({
        ...options,
        [providerId]: models,
      }));
      setModelFetchStatus(providerId, "ready");
      setModelNotice(null);

      const providerUpdate: Partial<ProviderConfig> = {};
      for (const capability of adapter.capabilities) {
        const modelSettings =
          capability === "text" ? provider.textModel : provider.imageModel;
        if (modelSettings.model.trim()) {
          continue;
        }

        const suggestedModel =
          getSuggestedModelId(models, capability) ?? models[0]?.id;
        if (!suggestedModel) {
          continue;
        }

        if (capability === "text") {
          providerUpdate.textModel = {
            ...provider.textModel,
            model: suggestedModel,
          };
        } else {
          providerUpdate.imageModel = {
            ...provider.imageModel,
            model: suggestedModel,
          };
        }
      }

      if (providerUpdate.textModel || providerUpdate.imageModel) {
        updateProvider(providerId, providerUpdate);
        resetModelTestStatuses();
      }
    } catch (error) {
      setModelOptionsByProvider((options) => ({
        ...options,
        [providerId]: [],
      }));
      setModelFetchStatus(providerId, "error");
      setModelNotice({
        titleKey: "modelsFetchError",
        tone: "error",
        message: getModelFetchErrorMessage(locale, error),
      });
    }
  };

  const testConnection = async (
    providerId: ProviderId,
    kind: ModelTestKind,
  ) => {
    const request = buildModelTestRequest(providerId, kind);
    const provider = settings.providers[request.provider];
    const statusKey = `${providerId}:${kind}`;

    if (!request.baseUrl.trim()) {
      setModelTestStatus(statusKey, "error");
      setModelNotice({
        titleKey: "modelTestError",
        tone: "error",
        message: t(locale, "baseUrlRequiredForModelTest"),
      });
      return;
    }

    if (!provider.apiKeySaved) {
      setModelTestStatus(statusKey, "error");
      setModelNotice({
        titleKey: "modelTestError",
        tone: "error",
        message: t(locale, "apiKeyRequiredForModelTest"),
      });
      return;
    }

    if (!request.model.trim()) {
      setModelTestStatus(statusKey, "error");
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

    setModelTestStatus(statusKey, "loading");
    setModelNotice(null);

    try {
      const result = await testProviderConnection(request);
      setModelTestStatus(statusKey, "ready");
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
      setModelTestStatus(statusKey, "error");
      setModelNotice({
        titleKey: "modelTestError",
        tone: "error",
        message: getModelTestErrorMessage(locale, error, kind),
      });
    }
  };

  const saveApiKey = async (providerId: ProviderId) => {
    const trimmedKey = (apiKeyDrafts[providerId] ?? "").trim();
    if (!trimmedKey) {
      return;
    }

    setSecretActionProvider(providerId);
    setSecretError(null);

    try {
      const isSaved = await saveProviderApiKey(providerId, trimmedKey);
      updateProvider(providerId, {
        apiKeySaved: isSaved,
        enabled: true,
      });
      setApiKeyDrafts((drafts) => ({
        ...drafts,
        [providerId]: "",
      }));
      setModelOptionsByProvider((options) => ({
        ...options,
        [providerId]: [],
      }));
      setModelFetchStatus(providerId, "idle");
      setModelNotice(null);
      resetModelTestStatuses();
    } catch (error) {
      setSecretError({ provider: providerId, message: getErrorMessage(error) });
    } finally {
      setSecretActionProvider(null);
    }
  };

  const clearApiKey = async (providerId: ProviderId) => {
    setSecretActionProvider(providerId);
    setSecretError(null);

    try {
      const isSaved = await clearProviderApiKey(providerId);
      updateProvider(providerId, { apiKeySaved: isSaved });
      setModelOptionsByProvider((options) => ({
        ...options,
        [providerId]: [],
      }));
      setModelFetchStatus(providerId, "idle");
      resetModelTestStatuses();
      setModelNotice(null);
    } catch (error) {
      setSecretError({ provider: providerId, message: getErrorMessage(error) });
    } finally {
      setSecretActionProvider(null);
    }
  };

  const setModelFetchStatus = (
    providerId: ProviderId,
    status: ModelFetchStatus,
  ) => {
    setModelFetchStatuses((statuses) => ({
      ...statuses,
      [providerId]: status,
    }));
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

  const selectedAdapter = getProviderAdapter(selectedProviderId);
  const selectedProvider = settings.providers[selectedProviderId];
  const selectedModels = modelOptionsByProvider[selectedProviderId] ?? [];
  const selectedFetchStatus =
    modelFetchStatuses[selectedProviderId] ?? "idle";
  const selectedDraft = apiKeyDrafts[selectedProviderId] ?? "";
  const selectedTextStatus =
    modelTestStatuses[`${selectedProviderId}:text`] ?? "idle";
  const selectedImageStatus =
    modelTestStatuses[`${selectedProviderId}:image`] ?? "idle";

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
        <SettingsNoticeSlot
          locale={locale}
          notice={modelNotice}
          onDismiss={() => setModelNotice(null)}
        />
        <div
          className="provider-picker"
          role="tablist"
          aria-label={t(locale, "selectProvider")}
        >
          {visibleProviderAdapterList.map((adapter) => {
            const provider = settings.providers[adapter.id];
            const isSelected = selectedProviderId === adapter.id;

            return (
              <button
                aria-selected={isSelected}
                className={
                  isSelected
                    ? "provider-picker-button active"
                    : "provider-picker-button"
                }
                key={adapter.id}
                role="tab"
                type="button"
                onClick={() => setSelectedProviderId(adapter.id)}
              >
                <span className="provider-picker-name">
                  <Server size={16} aria-hidden="true" />
                  <strong>{t(locale, adapter.labelKey)}</strong>
                </span>
                <span className="provider-picker-meta">
                  <span
                    className={
                      provider.apiKeySaved
                        ? "provider-status-dot active"
                        : "provider-status-dot"
                    }
                    aria-hidden="true"
                  />
                  {t(
                    locale,
                    provider.apiKeySaved
                      ? "providerConfigured"
                      : "providerNotConfigured",
                  )}
                </span>
              </button>
            );
          })}
        </div>
        <div className="model-config-grid">
          <div
            className={
              selectedProvider.enabled
                ? "model-config-panel active"
                : "model-config-panel"
            }
            role="tabpanel"
          >
            <div className="model-config-title-row">
              <div className="model-config-title">
                <Server size={17} aria-hidden="true" />
                <h3>{t(locale, selectedAdapter.labelKey)}</h3>
                <span className="provider-capability-tags">
                  {selectedAdapter.capabilities.map((capability) => (
                    <small key={capability}>
                      {t(
                        locale,
                        capability === "text"
                          ? "textCapability"
                          : "imageCapability",
                      )}
                    </small>
                  ))}
                </span>
              </div>
              <div className="model-config-actions">
                <FetchModelsControl
                  count={selectedModels.length}
                  locale={locale}
                  status={selectedFetchStatus}
                  onFetch={() => void fetchModels(selectedProviderId)}
                />
              </div>
            </div>
            <div className="settings-fields two-columns">
              <label className="settings-check provider-enabled-check">
                <input
                  checked={selectedProvider.enabled}
                  type="checkbox"
                  onChange={(event) =>
                    updateProvider(selectedProviderId, {
                      enabled: event.target.checked,
                    })
                  }
                />
                <span>{t(locale, "providerEnabled")}</span>
              </label>
              <label className="settings-field">
                <FieldLabel labelKey="baseUrl" locale={locale} required />
                <div className="input-with-icon">
                  <Link2 size={16} aria-hidden="true" />
                  <input
                    aria-required="true"
                    className="settings-input"
                    required
                    value={selectedProvider.baseUrl}
                    onChange={(event) => {
                      updateProvider(selectedProviderId, {
                        baseUrl: event.target.value,
                      });
                      resetModelTestStatuses();
                    }}
                  />
                </div>
              </label>
              <SecretField
                actionPending={secretActionProvider === selectedProviderId}
                error={
                  secretError?.provider === selectedProviderId
                    ? secretError.message
                    : ""
                }
                isSaved={selectedProvider.apiKeySaved}
                isVisible={visibleApiKeys[selectedProviderId] === true}
                labelKey="apiKey"
                locale={locale}
                value={selectedDraft}
                onClear={() => void clearApiKey(selectedProviderId)}
                onSave={() => void saveApiKey(selectedProviderId)}
                onToggle={() =>
                  setVisibleApiKeys((visible) => ({
                    ...visible,
                    [selectedProviderId]: !visible[selectedProviderId],
                  }))
                }
                onChange={(value) =>
                  setApiKeyDrafts((drafts) => ({
                    ...drafts,
                    [selectedProviderId]: value,
                  }))
                }
              />
              {selectedAdapter.supportsCustomHeaders ? (
                <label className="settings-field">
                  <span>{t(locale, "customHeaders")}</span>
                  <textarea
                    className="settings-textarea"
                    placeholder={t(locale, "customHeadersPlaceholder")}
                    value={selectedProvider.customHeaders ?? ""}
                    onChange={(event) => {
                      updateProvider(selectedProviderId, {
                        customHeaders: event.target.value,
                      });
                      resetModelTestStatuses();
                    }}
                  />
                </label>
              ) : null}
            </div>
            {selectedAdapter.capabilities.includes("text") ? (
              <div className="provider-model-card">
                <div className="provider-model-card-title">
                  <strong>{t(locale, "textModel")}</strong>
                  <TestConnectionControl
                    labelKey="testTextModel"
                    locale={locale}
                    readyKey="textModelTestReady"
                    status={selectedTextStatus}
                    onTest={() => void testConnection(selectedProviderId, "text")}
                  />
                </div>
                <ModelField
                  fieldId={`${selectedProviderId}-text-model`}
                  labelKey="modelName"
                  locale={locale}
                  options={selectedModels}
                  value={selectedProvider.textModel.model}
                  onChange={(model) =>
                    updateProviderTextModel(selectedProviderId, { model })
                  }
                />
                <RuntimeParameters
                  locale={locale}
                  runtime={selectedProvider.textModel}
                  titleKey="textRuntimeParameters"
                  onChange={(textModelUpdate) =>
                    updateProviderTextModel(selectedProviderId, textModelUpdate)
                  }
                />
              </div>
            ) : null}
            {selectedAdapter.capabilities.includes("image") ? (
              <div className="provider-model-card">
                <div className="provider-model-card-title">
                  <strong>{t(locale, "imageModel")}</strong>
                  <TestConnectionControl
                    labelKey="testImageModel"
                    locale={locale}
                    readyKey="imageModelTestReady"
                    status={selectedImageStatus}
                    onTest={() => void testConnection(selectedProviderId, "image")}
                  />
                </div>
                <ModelField
                  fieldId={`${selectedProviderId}-image-model`}
                  labelKey="modelName"
                  locale={locale}
                  options={selectedModels}
                  value={selectedProvider.imageModel.model}
                  onChange={(model) =>
                    updateProviderImageModel(selectedProviderId, { model })
                  }
                />
                <RuntimeParameters
                  locale={locale}
                  runtime={selectedProvider.imageModel}
                  titleKey="imageRuntimeParameters"
                  onChange={(imageModelUpdate) =>
                    updateProviderImageModel(selectedProviderId, imageModelUpdate)
                  }
                />
                <ImageModelParameters
                  locale={locale}
                  value={selectedProvider.imageModel}
                  onChange={(imageModelUpdate) =>
                    updateProviderImageModel(selectedProviderId, imageModelUpdate)
                  }
                />
              </div>
            ) : null}
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
        <SectionHeader
          icon={FileText}
          locale={locale}
          titleKey="developerWorkflowConfig"
        />
        <div className="settings-fields">
          <label className="settings-check">
            <input
              checked={settings.showWorkflowConfigEditor}
              type="checkbox"
              onChange={(event) =>
                updateSetting("showWorkflowConfigEditor", event.target.checked)
              }
            />
            <span>{t(locale, "showWorkflowConfigEditor")}</span>
          </label>
          <p className="settings-help">{t(locale, "workflowConfigHint")}</p>
        </div>
        {settings.showWorkflowConfigEditor ? (
          <>
            <SettingsNoticeSlot
              locale={locale}
              notice={workflowConfigNotice}
              onDismiss={() => setWorkflowConfigNotice(null)}
            />
            <div className="workflow-template-editor">
              <div
                className="provider-picker"
                role="tablist"
                aria-label={t(locale, "workflowConfigSelect")}
              >
                {Object.values(settings.workflowConfigs)
                  .sort((left, right) => left.sortOrder - right.sortOrder)
                  .map((workflow) => (
                    <button
                      aria-selected={selectedWorkflowId === workflow.id}
                      className={
                        selectedWorkflowId === workflow.id
                          ? "provider-picker-button active"
                          : "provider-picker-button"
                      }
                      key={workflow.id}
                      role="tab"
                      type="button"
                      onClick={() => setSelectedWorkflowId(workflow.id)}
                    >
                      <span className="provider-picker-name">
                        <FileText size={16} aria-hidden="true" />
                        <strong>{workflow.name}</strong>
                      </span>
                      <span className="provider-picker-meta">
                        {workflow.executionStrategy}
                      </span>
                    </button>
                  ))}
              </div>

              <div className="settings-fields two-columns">
                <label className="settings-field">
                  <span>{t(locale, "workflowConfigName")}</span>
                  <input
                    className="settings-input"
                    value={selectedWorkflowConfig.name}
                    onChange={(event) =>
                      updateWorkflowConfig({ name: event.target.value })
                    }
                  />
                </label>
                <label className="settings-field">
                  <span>{t(locale, "workflowConfigSortOrder")}</span>
                  <input
                    className="number-input"
                    type="number"
                    value={selectedWorkflowConfig.sortOrder}
                    onChange={(event) =>
                      updateWorkflowConfig({
                        sortOrder: Number(event.target.value) || 0,
                      })
                    }
                  />
                </label>
                <label className="settings-check">
                  <input
                    checked={selectedWorkflowConfig.enabled}
                    type="checkbox"
                    onChange={(event) =>
                      updateWorkflowConfig({ enabled: event.target.checked })
                    }
                  />
                  <span>{t(locale, "workflowConfigEnabled")}</span>
                </label>
                <label className="settings-field">
                  <span>{t(locale, "workflowConfigStrategy")}</span>
                  <input
                    className="settings-input"
                    readOnly
                    value={selectedWorkflowConfig.executionStrategy}
                  />
                </label>
              </div>

              <label className="settings-field wide-field">
                <span>{t(locale, "workflowConfigDescription")}</span>
                <textarea
                  className="settings-textarea"
                  value={selectedWorkflowConfig.description}
                  onChange={(event) =>
                    updateWorkflowConfig({ description: event.target.value })
                  }
                />
              </label>

              <label className="settings-field wide-field">
                <span>{t(locale, "workflowConfigTemplate")}</span>
                <textarea
                  className="settings-textarea workflow-template-textarea"
                  spellCheck={false}
                  value={selectedWorkflowConfig.analysisTemplate}
                  onChange={(event) =>
                    updateWorkflowConfig({
                      analysisTemplate: event.target.value,
                    })
                  }
                />
              </label>

              <div
                className="workflow-variable-list"
                aria-label={t(locale, "workflowConfigVariables")}
              >
                {workflowTemplateVariableNames.map((variable) => (
                  <code key={variable}>{`{{${variable}}}`}</code>
                ))}
              </div>

              <label className="settings-field wide-field">
                <span>{t(locale, "workflowConfigPreview")}</span>
                <textarea
                  className="settings-textarea workflow-template-preview"
                  readOnly
                  value={workflowPromptPreview}
                />
              </label>

              <div className="settings-actions-row">
                <button
                  className="secondary-action compact-action"
                  disabled={workflowConfigStatus === "loading"}
                  type="button"
                  onClick={() => void reloadWorkflowConfigs()}
                >
                  <FileText size={16} aria-hidden="true" />
                  {t(
                    locale,
                    workflowConfigStatus === "loading"
                      ? "workflowConfigReloading"
                      : "workflowConfigReload",
                  )}
                </button>
              </div>
            </div>
          </>
        ) : null}
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

      <div className="settings-field">
        <span>{t(locale, "saveState")}</span>
        <div className={`save-state save-state-${storageStatus}`}>
          <Save size={16} aria-hidden="true" />
          {t(locale, storageStatusKeys[storageStatus])}
        </div>
      </div>
    </section>
  );
}
