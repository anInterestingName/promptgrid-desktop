import type { MessageKey } from "../../i18n";

export type ModelFetchStatus = "idle" | "loading" | "ready" | "error";
export type ModelTestStatus = "idle" | "loading" | "ready" | "error";
export type ModelTestKind = "text" | "image";
export type ModelTestStatuses = Record<string, ModelTestStatus>;
export type StorageActionStatus = "idle" | "loading" | "ready" | "error";

export type SettingsNoticeModel = {
  message: string;
  tone: "error" | "success";
  titleKey: MessageKey;
};
