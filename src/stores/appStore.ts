import { create } from "zustand";
import type { PlatformKind } from "../app/platform/profile";
import type { AppError, DownloadProgress, DownloadTask } from "../types/domain";

interface AppState {
  platformOverride: PlatformKind | null;
  setPlatformOverride: (platform: PlatformKind | null) => void;
  downloadTasks: DownloadTask[];
  downloadProgress: Record<string, DownloadProgress>;
  lastDownloadError: AppError | null;
  upsertDownloadTask: (task: DownloadTask) => void;
  updateDownloadProgress: (progress: DownloadProgress) => void;
  setLastDownloadError: (error: AppError | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  platformOverride: null,
  setPlatformOverride: (platformOverride) => set({ platformOverride }),
  downloadTasks: [],
  downloadProgress: {},
  lastDownloadError: null,
  upsertDownloadTask: (task) =>
    set((state) => ({
      downloadTasks: [task, ...state.downloadTasks.filter((item) => item.id !== task.id)],
    })),
  updateDownloadProgress: (progress) =>
    set((state) => ({
      downloadProgress: { ...state.downloadProgress, [progress.taskId]: progress },
    })),
  setLastDownloadError: (lastDownloadError) => set({ lastDownloadError }),
}));
