import {
  AlertCircle,
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
import { useCallback, useEffect, useRef, useState } from "react";
import { aspectRatioOptions } from "../data/mockProject";
import { t, type Locale, type MessageKey } from "../i18n";
import {
  clearProviderApiKey,
  fetchProviderModels,
  saveProviderApiKey,
} from "../services/modelConfig";
import { usePromptGridStore } from "../state/usePromptGridStore";
import type {
  ApiProvider,
  AppSettings,
  AspectRatio,
  GridSize,
  ModelOption,
} from "../types";

const providerOptions: Array<{
  value: ApiProvider;
  labelKey: MessageKey;
}> = [
  { value: "openai", labelKey: "providerOpenAI" },
  { value: "custom", labelKey: "providerCustom" },
];

const gridSizeOptions = [9, 16, 25] as const;

const storageStatusKeys = {
  idle: "saveStateIdle",
  loading: "saveStateLoading",
  saving: "saveStateSaving",
  saved: "saveStateSaved",
  error: "saveStateError",
} satisfies Record<string, MessageKey>;

type ModelFetchStatus = "idle" | "loading" | "ready" | "error";
type ModelNotice = {
  message: string;
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
  const [modelNotice, setModelNotice] = useState<ModelNotice | null>(null);
  const lastAutoFetchKeyRef = useRef("");

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

        if (models[0] && provider === "custom" && !settings.customTextModel) {
          updateSettings({ customTextModel: models[0].id });
        }
      } catch (error) {
        const errorMessage = getModelFetchErrorMessage(locale, error);
        setModelOptions([]);
        setModelOptionsProvider(provider);
        setModelFetchStatus("error");
        setModelNotice({
          titleKey: "modelsFetchError",
          message: errorMessage,
        });
      }
    },
    [
      buildModelFetchRequest,
      locale,
      settings.customApiKeySaved,
      settings.customTextModel,
      settings.openAiApiKeySaved,
      updateSettings,
    ],
  );

  useEffect(() => {
    const provider = settings.apiProvider;
    const keySaved =
      provider === "openai"
        ? settings.openAiApiKeySaved
        : settings.customApiKeySaved;
    const request = buildModelFetchRequest(provider);

    if (!keySaved || !request.baseUrl.trim()) {
      return;
    }

    const requestKey = [
      request.provider,
      request.baseUrl,
      request.customHeaders ?? "",
    ].join("|");
    if (lastAutoFetchKeyRef.current === requestKey) {
      return;
    }

    const fetchTimer = window.setTimeout(() => {
      lastAutoFetchKeyRef.current = requestKey;
      void fetchModelsForProvider(provider);
    }, 360);

    return () => window.clearTimeout(fetchTimer);
  }, [
    buildModelFetchRequest,
    fetchModelsForProvider,
    settings.apiProvider,
    settings.customApiKeySaved,
    settings.openAiApiKeySaved,
  ]);

  const fetchModels = (provider: ApiProvider) => {
    const request = buildModelFetchRequest(provider);
    lastAutoFetchKeyRef.current = [
      request.provider,
      request.baseUrl,
      request.customHeaders ?? "",
    ].join("|");
    void fetchModelsForProvider(provider);
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

      const request = buildModelFetchRequest(provider);
      lastAutoFetchKeyRef.current = [
        request.provider,
        request.baseUrl,
        request.customHeaders ?? "",
      ].join("|");
      await fetchModelsForProvider(provider, { assumeApiKeySaved: true });
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
              {settings.apiProvider === "openai" ? (
                <FetchModelsControl
                  count={
                    modelOptionsProvider === "openai" ? modelOptions.length : 0
                  }
                  locale={locale}
                  status={modelFetchStatus}
                  onFetch={() => fetchModels("openai")}
                />
              ) : null}
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
                    onChange={(event) =>
                      updateSetting("openAiBaseUrl", event.target.value)
                    }
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
                onChange={(value) => updateSetting("textModel", value)}
              />
              <ModelField
                fieldId="openai-image-model"
                labelKey="imageModel"
                locale={locale}
                options={modelOptionsProvider === "openai" ? modelOptions : []}
                value={settings.imageModel}
                onChange={(value) => updateSetting("imageModel", value)}
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
              {settings.apiProvider === "custom" ? (
                <FetchModelsControl
                  count={
                    modelOptionsProvider === "custom" ? modelOptions.length : 0
                  }
                  locale={locale}
                  status={modelFetchStatus}
                  onFetch={() => fetchModels("custom")}
                />
              ) : null}
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
                    onChange={(event) =>
                      updateSetting("customBaseUrl", event.target.value)
                    }
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
                onChange={(value) => updateSetting("customTextModel", value)}
              />
              <ModelField
                fieldId="custom-image-model"
                labelKey="imageModel"
                locale={locale}
                options={modelOptionsProvider === "custom" ? modelOptions : []}
                value={settings.customImageModel ?? ""}
                onChange={(value) => updateSetting("customImageModel", value)}
              />
              <label className="settings-field">
                <span>{t(locale, "customHeaders")}</span>
                <textarea
                  className="settings-textarea"
                  placeholder={t(locale, "customHeadersPlaceholder")}
                  value={settings.customHeaders ?? ""}
                  onChange={(event) =>
                    updateSetting("customHeaders", event.target.value)
                  }
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
        <div className="settings-fields">
          <label className="settings-field">
            <span>{t(locale, "outputFolder")}</span>
            <input
              className="settings-input"
              placeholder={t(locale, "outputFolderPlaceholder")}
              value={settings.outputDirectory ?? ""}
              onChange={(event) =>
                updateSetting(
                  "outputDirectory",
                  event.target.value.trim() || undefined,
                )
              }
            />
          </label>
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
  titleKey,
  onDismiss,
}: SettingsNoticeProps) {
  return (
    <div className="settings-notice error" role="alert">
      <AlertCircle size={18} aria-hidden="true" />
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
  const listId = `${fieldId}-options`;

  return (
    <label className="settings-field">
      <span>{t(locale, labelKey)}</span>
      <input
        className="settings-input"
        list={options.length > 0 ? listId : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {options.length > 0 ? (
        <datalist id={listId}>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.ownedBy ?? option.id}
            </option>
          ))}
        </datalist>
      ) : null}
    </label>
  );
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
