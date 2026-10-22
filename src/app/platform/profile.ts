import { useAppStore } from "../../stores/appStore";
import { getPlatformProfile, type PlatformKind, type PlatformProfile } from "./profiles";

export { getPlatformProfile } from "./profiles";
export type { PlatformKind, PlatformProfile } from "./profiles";

function detectPlatform(): PlatformKind {
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("windows")) return "windows";
  if (userAgent.includes("macintosh") || userAgent.includes("mac os")) return "macos";
  return "linux";
}

export function usePlatformProfile(): PlatformProfile {
  const override = useAppStore((state) => state.platformOverride);
  return getPlatformProfile(override ?? detectPlatform());
}
