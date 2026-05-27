import {
  Activity,
  AlertCircle,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { t, type Locale, type MessageKey } from "../../i18n";
import type {
  ImageModelBackground,
  ImageModelOutputFormat,
  ImageModelQuality,
  TextModelSettings,
  ModelOption,
  ReasoningEffort,
  ResponseVerbosity,
} from "../../types";
import { getModelFetchMessage } from "./modelSettingsUtils";
import type {
  ModelFetchStatus,
  ModelTestStatus,
  SettingsNoticeModel,
} from "./types";

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

type SectionHeaderProps = {
  icon: LucideIcon;
  locale: Locale;
  titleKey: MessageKey;
};

export function SectionHeader({
  icon: Icon,
  locale,
  titleKey,
}: SectionHeaderProps) {
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

export function FieldLabel({
  labelKey,
  locale,
  required = false,
}: FieldLabelProps) {
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
  tone: SettingsNoticeModel["tone"];
  titleKey: MessageKey;
  onDismiss: () => void;
};

type SettingsNoticeSlotProps = {
  locale: Locale;
  notice: SettingsNoticeModel | null;
  onDismiss: () => void;
};

export function SettingsNoticeSlot({
  locale,
  notice,
  onDismiss,
}: SettingsNoticeSlotProps) {
  return (
    <div
      className={notice ? "settings-notice-slot active" : "settings-notice-slot"}
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

export function SecretField({
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

export function FetchModelsControl({
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

export function TestConnectionControl({
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
  runtime: TextModelSettings;
  titleKey: MessageKey;
  onChange: (runtime: Partial<TextModelSettings>) => void;
};

export function RuntimeParameters({
  locale,
  runtime,
  titleKey,
  onChange,
}: RuntimeParametersProps) {
  return (
    <div className="settings-field wide-field runtime-parameters">
      <span>{t(locale, titleKey)}</span>
      <div className="runtime-parameter-grid">
        <label className="settings-check">
          <input
            checked={runtime.reasoningEnabled}
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
                  runtime.reasoningEffort === option.value ? "active" : ""
                }
                disabled={!runtime.reasoningEnabled}
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
                  runtime.responseVerbosity === option.value ? "active" : ""
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
            checked={runtime.streamResponses}
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

const imageQualityOptions: Array<{
  value: ImageModelQuality;
  labelKey: MessageKey;
}> = [
  { value: "auto", labelKey: "imageParamAuto" },
  { value: "low", labelKey: "reasoningLow" },
  { value: "medium", labelKey: "reasoningMedium" },
  { value: "high", labelKey: "reasoningHigh" },
];

const imageBackgroundOptions: Array<{
  value: ImageModelBackground;
  labelKey: MessageKey;
}> = [
  { value: "auto", labelKey: "imageParamAuto" },
  { value: "transparent", labelKey: "imageBackgroundTransparent" },
  { value: "opaque", labelKey: "imageBackgroundOpaque" },
];

const imageFormatOptions: Array<{
  value: ImageModelOutputFormat;
  labelKey: MessageKey;
}> = [
  { value: "png", labelKey: "imageFormatPng" },
  { value: "jpeg", labelKey: "imageFormatJpeg" },
  { value: "webp", labelKey: "imageFormatWebp" },
];

type ImageModelParametersProps = {
  locale: Locale;
  value: {
    quality: ImageModelQuality;
    background: ImageModelBackground;
    outputFormat: ImageModelOutputFormat;
    outputCompression: number;
  };
  onChange: (value: Partial<ImageModelParametersProps["value"]>) => void;
};

export function ImageModelParameters({
  locale,
  value,
  onChange,
}: ImageModelParametersProps) {
  return (
    <div className="settings-field wide-field image-model-parameters">
      <span>{t(locale, "imageModelParameters")}</span>
      <div className="runtime-parameter-grid image-parameter-grid">
        <div className="settings-field">
          <span>{t(locale, "imageQuality")}</span>
          <div className="segmented-control settings-segmented runtime-segmented">
            {imageQualityOptions.map((option) => (
              <button
                className={value.quality === option.value ? "active" : ""}
                key={option.value}
                type="button"
                onClick={() => onChange({ quality: option.value })}
              >
                {t(locale, option.labelKey)}
              </button>
            ))}
          </div>
        </div>
        <label className="settings-field">
          <span>{t(locale, "imageBackground")}</span>
          <select
            className="settings-input"
            value={value.background}
            onChange={(event) =>
              onChange({
                background: event.target.value as ImageModelBackground,
              })
            }
          >
            {imageBackgroundOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {t(locale, option.labelKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-field">
          <span>{t(locale, "imageOutputFormat")}</span>
          <select
            className="settings-input"
            value={value.outputFormat}
            onChange={(event) =>
              onChange({
                outputFormat: event.target.value as ImageModelOutputFormat,
              })
            }
          >
            {imageFormatOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {t(locale, option.labelKey)}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-field">
          <span>{t(locale, "imageOutputCompression")}</span>
          <div className="range-row">
            <input
              className="settings-range"
              min={0}
              max={100}
              type="range"
              value={value.outputCompression}
              onChange={(event) =>
                onChange({ outputCompression: Number(event.target.value) })
              }
            />
            <input
              className="number-input"
              min={0}
              max={100}
              type="number"
              value={value.outputCompression}
              onChange={(event) => {
                const compression = Number(event.target.value);
                onChange({
                  outputCompression: Math.min(
                    100,
                    Math.max(0, compression || 0),
                  ),
                });
              }}
            />
          </div>
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

export function ModelField({
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

            if (event.key === "Enter" && isOpen && visibleOptions.length > 0) {
              event.preventDefault();
              chooseModel(visibleOptions[0].id);
            }
          }}
        />
        <button
          aria-label={t(locale, "openModelOptions")}
          className={
            isOpen ? "model-combobox-toggle open" : "model-combobox-toggle"
          }
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
                    className={
                      isSelected ? "model-option selected" : "model-option"
                    }
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
