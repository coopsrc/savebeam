export type PlatformKind = "macos" | "windows" | "linux";

export interface PlatformProfile {
  platform: PlatformKind;
  label: string;
  sidebarWidth: number;
  compactSidebarWidth: number;
  navigationItemHeight: number;
  selectionStyle: "rounded-fill";
  systemFont: string;
  revealFileLabel: string;
  modifierKey: "Meta" | "Control";
}

/** Desktop navigation geometry is shared; only platform conventions differ. */
const desktopNavigation = {
  sidebarWidth: 216,
  compactSidebarWidth: 56,
  navigationItemHeight: 34,
  selectionStyle: "rounded-fill" as const,
};

const profiles: Record<PlatformKind, PlatformProfile> = {
  macos: {
    ...desktopNavigation,
    platform: "macos",
    label: "macOS",
    systemFont: '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
    revealFileLabel: "在 Finder 中显示",
    modifierKey: "Meta",
  },
  windows: {
    ...desktopNavigation,
    platform: "windows",
    label: "Windows",
    systemFont: '"Segoe UI Variable", "Segoe UI", sans-serif',
    revealFileLabel: "在文件资源管理器中显示",
    modifierKey: "Control",
  },
  linux: {
    ...desktopNavigation,
    platform: "linux",
    label: "Linux",
    systemFont: 'system-ui, "Noto Sans", sans-serif',
    revealFileLabel: "在文件管理器中显示",
    modifierKey: "Control",
  },
};

export function getPlatformProfile(platform: PlatformKind): PlatformProfile {
  return profiles[platform];
}
