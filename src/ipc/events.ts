import { isTauri } from "@tauri-apps/api/core";
import { listen, type Event, type UnlistenFn } from "@tauri-apps/api/event";
import type { EventEnvelope } from "../types/domain";

export const IPC_EVENT_SCHEMA_VERSION = 1;

export const IPC_EVENTS = {
  componentStateChanged: "component://state-changed",
  componentInstallProgress: "component://install-progress",
  downloadStateChanged: "download://state-changed",
  downloadProgress: "download://progress",
  downloadLog: "download://log",
  downloadError: "download://error",
  downloadResult: "download://result",
  downloadRemoved: "download://removed",
} as const;

function unwrapEvent<T>(event: Event<EventEnvelope<T>>): T {
  const envelope: unknown = event.payload;
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    !("schemaVersion" in envelope) ||
    !Number.isInteger(envelope.schemaVersion) ||
    envelope.schemaVersion !== IPC_EVENT_SCHEMA_VERSION ||
    !("payload" in envelope)
  ) {
    throw new Error("收到不兼容的应用事件格式。");
  }
  return envelope.payload as T;
}

/** Listen for a versioned domain event and expose only its typed payload. */
export async function listenToEvent<T>(
  eventName: string,
  handler: (payload: T) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) {
    throw new Error("当前预览环境不支持桌面端事件。");
  }

  return listen<EventEnvelope<T>>(eventName, (event) => {
    handler(unwrapEvent(event));
  });
}
