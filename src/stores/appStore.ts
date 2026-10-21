import { create } from "zustand";
import type { PlatformKind } from "../app/platform/profile";
import type { AppError, DownloadProgress, DownloadResult, DownloadTask } from "../types/domain";

interface AppState {
  platformOverride: PlatformKind | null;
  setPlatformOverride: (platform: PlatformKind | null) => void;
  downloadTasks: DownloadTask[];
  downloadProgress: Record<string, DownloadProgress>;
  downloadResults: Record<string, DownloadResult>;
  lastDownloadError: AppError | null;
  upsertDownloadTask: (task: DownloadTask) => void;
  updateDownloadProgress: (progress: DownloadProgress) => void;
  setDownloadResult: (result: DownloadResult) => void;
  setLastDownloadError: (error: AppError | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  platformOverride: null,
  setPlatformOverride: (platformOverride) => set({ platformOverride }),
  downloadTasks: [],
  downloadProgress: {},
  downloadResults: {},
  lastDownloadError: null,
  upsertDownloadTask: (task) =>
    set((state) => ({
      downloadTasks: [task, ...state.downloadTasks.filter((item) => item.id !== task.id)],
    })),
  updateDownloadProgress: (progress) =>
    set((state) => ({
      downloadProgress: { ...state.downloadProgress, [progress.taskId]: progress },
    })),
  setDownloadResult: (result) =>
    set((state) => ({
      downloadResults: { ...state.downloadResults, [result.taskId]: result },
    })),
  setLastDownloadError: (lastDownloadError) => set({ lastDownloadError }),
}));
