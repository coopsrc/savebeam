import { createTheme } from "@mantine/core";
import type { PlatformProfile } from "./platform/profile";

export function createAppTheme(profile: PlatformProfile) {
  return createTheme({
    primaryColor: "blue",
    primaryShade: { light: 6, dark: 4 },
    defaultRadius: "md",
    fontFamily: profile.systemFont,
    headings: { fontFamily: profile.systemFont, fontWeight: "650" },
    focusRing: "auto",
  });
}
