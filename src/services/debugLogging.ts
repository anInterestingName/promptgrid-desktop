import { invoke, isTauri } from "@tauri-apps/api/core";

export type DebugLoggingConfig = {
  enabled: boolean;
  retentionDays: number;
};

export async function configureDebugLogging({
  enabled,
  retentionDays,
}: DebugLoggingConfig): Promise<void> {
  if (!isTauri()) {
    window.localStorage.setItem(
      "promptgrid.debugLogging.config",
      JSON.stringify({ enabled, retentionDays }),
    );
    return;
  }

  await invoke("configure_debug_logging", {
    enabled,
    retentionDays: Math.max(1, Math.round(retentionDays)),
  });
}

export async function openDebugLogFolder(): Promise<void> {
  if (!isTauri()) {
    return;
  }

  await invoke("open_debug_log_folder");
}
