import { create } from "zustand";
import type { PlatformKind } from "../app/platform/profile";

export interface MockDownloadTask {
  id: string;
  title: string;
  url: string;
  formatLabel: string;
  status: "queued";
  createdAt: number;
}

interface AppState {
  platformOverride: PlatformKind | null;
  setPlatformOverride: (platform: PlatformKind | null) => void;
  mockTasks: MockDownloadTask[];
  addMockTask: (task: MockDownloadTask) => void;
}

export const useAppStore = create<AppState>((set) => ({
  platformOverride: null,
  setPlatformOverride: (platformOverride) => set({ platformOverride }),
  mockTasks: [],
  addMockTask: (task) => set((state) => ({ mockTasks: [task, ...state.mockTasks] })),
}));
