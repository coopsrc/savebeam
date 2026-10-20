import { useAppStore } from "../../stores/appStore";

export type PlatformKind = "macos" | "windows" | "linux";

export interface PlatformProfile {
  platform: PlatformKind;
  label: string;
  sidebarWidth: number;
  compactSidebarWidth: number;
  navigationItemHeight: number;
  selectionStyle: "rounded-fill" | "accent-indicator" | "neutral-fill";
  systemFont: string;
  revealFileLabel: string;
  modifierKey: "Meta" | "Control";
}

const profiles: Record<PlatformKind, PlatformProfile> = {
  macos: {
    platform: "macos",
    label: "macOS",
    sidebarWidth: 216,
    compactSidebarWidth: 56,
    navigationItemHeight: 34,
    selectionStyle: "rounded-fill",
    systemFont: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
    revealFileLabel: "在 Finder 中显示",
    modifierKey: "Meta",
  },
  windows: {
    platform: "windows",
    label: "Windows",
    sidebarWidth: 232,
    compactSidebarWidth: 56,
    navigationItemHeight: 42,
    selectionStyle: "accent-indicator",
    systemFont: '"Segoe UI Variable", "Segoe UI", sans-serif',
    revealFileLabel: "在文件资源管理器中显示",
    modifierKey: "Control",
  },
  linux: {
    platform: "linux",
    label: "Linux",
    sidebarWidth: 224,
    compactSidebarWidth: 56,
    navigationItemHeight: 40,
    selectionStyle: "neutral-fill",
    systemFont: 'system-ui, "Noto Sans", sans-serif',
    revealFileLabel: "在文件管理器中显示",
    modifierKey: "Control",
  },
};

function detectPlatform(): PlatformKind {
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("windows")) return "windows";
  if (userAgent.includes("macintosh") || userAgent.includes("mac os")) return "macos";
  return "linux";
}

export function getPlatformProfile(platform: PlatformKind): PlatformProfile {
  return profiles[platform];
}

export function usePlatformProfile(): PlatformProfile {
  const override = useAppStore((state) => state.platformOverride);
  return profiles[override ?? detectPlatform()];
}
