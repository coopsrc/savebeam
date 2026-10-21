import type { CSSProperties, PropsWithChildren } from "react";
import { MantineProvider } from "@mantine/core";
import { createAppTheme } from "./theme";
import { usePlatformProfile } from "./platform/profile";
import { DevPlatformSwitcher } from "./platform/DevPlatformSwitcher";

type ProfileVariables = CSSProperties & {
  "--sb-sidebar-width": string;
  "--sb-sidebar-compact-width": string;
  "--sb-navigation-item-height": string;
};

export function AppProviders({ children }: PropsWithChildren) {
  const profile = usePlatformProfile();
  const profileVariables: ProfileVariables = {
    "--sb-sidebar-width": `${profile.sidebarWidth}px`,
    "--sb-sidebar-compact-width": `${profile.compactSidebarWidth}px`,
    "--sb-navigation-item-height": `${profile.navigationItemHeight}px`,
  };

  return (
    <MantineProvider theme={createAppTheme(profile)} defaultColorScheme="auto">
      <div
        className="app-root"
        data-platform={profile.platform}
        data-selection-style={profile.selectionStyle}
        style={profileVariables}
      >
        {children}
        <DevPlatformSwitcher />
      </div>
    </MantineProvider>
  );
}
