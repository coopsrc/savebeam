import { t, useUiLocale } from "../../i18n/translate.ts";
import { SegmentedControl } from "@mantine/core";
import { useAppStore } from "../../stores/appStore";

const platformOptions = [
  {
    get label() {
      return t("自动");
    },
    value: "auto",
  },
  { label: "macOS", value: "macos" },
  { label: "Windows", value: "windows" },
  { label: "Linux", value: "linux" },
];

export function DevPlatformSwitcher() {
  useUiLocale();

  const platformOverride = useAppStore((state) => state.platformOverride);
  const setPlatformOverride = useAppStore((state) => state.setPlatformOverride);

  if (!import.meta.env.DEV) return null;

  return (
    <div className="dev-platform-switcher">
      <span className="dev-platform-label">{t("开发预览平台")}</span>
      <SegmentedControl
        size="xs"
        aria-label={t("切换开发预览平台")}
        value={platformOverride ?? "auto"}
        onChange={(value) => {
          setPlatformOverride(value === "auto" ? null : (value as "macos" | "windows" | "linux"));
        }}
        data={platformOptions}
      />
    </div>
  );
}
