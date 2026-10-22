import { create } from "zustand";
import type { PlatformKind } from "../app/platform/profile";
import type { AppError, DownloadProgress, DownloadResult, DownloadTask } from "../types/domain";

interface AppState {
  platformOverride: PlatformKind | null;
  setPlatformOverride: (platform: PlatformKind | null) => void;
  downloadTasks: DownloadTask[];
  removedTaskIds: Record<string, true>;
  downloadProgress: Record<string, DownloadProgress>;
  downloadResults: Record<string, DownloadResult>;
  lastDownloadError: AppError | null;
  upsertDownloadTask: (task: DownloadTask) => void;
  removeDownloadTask: (taskId: string) => void;
  updateDownloadProgress: (progress: DownloadProgress) => void;
  setDownloadResult: (result: DownloadResult) => void;
  setLastDownloadError: (error: AppError | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  platformOverride: null,
  setPlatformOverride: (platformOverride) => set({ platformOverride }),
  downloadTasks: [],
  removedTaskIds: {},
  downloadProgress: {},
  downloadResults: {},
  lastDownloadError: null,
  upsertDownloadTask: (task) =>
    set((state) =>
      state.removedTaskIds[task.id]
        ? state
        : {
            downloadTasks: [task, ...state.downloadTasks.filter((item) => item.id !== task.id)],
          },
    ),
  removeDownloadTask: (taskId) =>
    set((state) => {
      const progress = { ...state.downloadProgress };
      const results = { ...state.downloadResults };
      delete progress[taskId];
      delete results[taskId];
      return {
        downloadTasks: state.downloadTasks.filter((task) => task.id !== taskId),
        removedTaskIds: { ...state.removedTaskIds, [taskId]: true },
        downloadProgress: progress,
        downloadResults: results,
      };
    }),
  updateDownloadProgress: (progress) =>
    set((state) =>
      state.removedTaskIds[progress.taskId]
        ? state
        : {
            downloadProgress: { ...state.downloadProgress, [progress.taskId]: progress },
          },
    ),
  setDownloadResult: (result) =>
    set((state) =>
      state.removedTaskIds[result.taskId]
        ? state
        : {
            downloadResults: { ...state.downloadResults, [result.taskId]: result },
          },
    ),
  setLastDownloadError: (lastDownloadError) => set({ lastDownloadError }),
}));
