import { create } from "zustand";
import type { PlatformKind } from "../app/platform/profile";

interface AppState {
  platformOverride: PlatformKind | null;
  setPlatformOverride: (platform: PlatformKind | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
  platformOverride: null,
  setPlatformOverride: (platformOverride) => set({ platformOverride }),
}));
