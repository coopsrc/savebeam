import { invokeCommand, IpcError } from "../../ipc/client";
import type { DownloadTask } from "../../types/domain";

export interface SubscriptionEntry {
  id: string;
  index: number;
  title: string;
  downloaded: boolean;
  isNew: boolean;
  available: boolean;
  taskStatus: string | null;
}
export interface SeriesSubscription {
  id: number;
  url: string;
  sourceId: string;
  title: string;
  lastCheckedUnixMs: number;
  truncated: boolean;
  entries: SubscriptionEntry[];
}
export interface SeriesCandidate {
  url: string;
  title: string;
}
export interface QueuedItems {
  tasks: DownloadTask[];
  error: string | null;
}

// This Chinese-only feature needs actionable selection/check details, not a generic URL error.
// Rust messages contain app-authored context; diagnostics and process stderr stay excluded.
async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invokeCommand<T>(command, args);
  } catch (error: unknown) {
    if (error instanceof IpcError) error.message = error.contextMessage;
    throw error;
  }
}

export const subscriptionApi = {
  list: () => invoke<SeriesSubscription[]>("list_subscriptions"),
  candidates: () => invoke<SeriesCandidate[]>("get_subscription_candidates"),
  subscribe: (url: string) => invoke<number>("subscribe_series", { url }),
  check: (id: number) => invoke<void>("check_subscription", { id }),
  remove: (id: number) => invoke<void>("unsubscribe_series", { id }),
  download: (id: number, mediaIds: string[], useProxy = false) =>
    invoke<QueuedItems>("download_subscription_items", { id, mediaIds, useProxy }),
};
