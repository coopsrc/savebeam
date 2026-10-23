import { useEffect, useLayoutEffect, type CSSProperties, type PropsWithChildren } from "react";
import { useMediaQuery } from "@mantine/hooks";
import { useUiPreferences } from "../stores/uiPreferencesStore";
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
  const { preferences, locale, syncSystemLanguage } = useUiPreferences();
  const systemDark = useMediaQuery("(prefers-color-scheme: dark)", false, {
    getInitialValueInEffect: false,
  });
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  useEffect(() => {
    window.addEventListener("languagechange", syncSystemLanguage);
    return () => window.removeEventListener("languagechange", syncSystemLanguage);
  }, [syncSystemLanguage]);
  const profileVariables: ProfileVariables = {
    "--sb-sidebar-width": `${profile.sidebarWidth}px`,
    "--sb-sidebar-compact-width": `${profile.compactSidebarWidth}px`,
    "--sb-navigation-item-height": `${profile.navigationItemHeight}px`,
  };

  return (
    <MantineProvider
      theme={createAppTheme(profile)}
      forceColorScheme={
        preferences.theme === "system" ? (systemDark ? "dark" : "light") : preferences.theme
      }
    >
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
