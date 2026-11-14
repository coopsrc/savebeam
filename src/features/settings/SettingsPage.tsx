import { t, useUiLocale } from "../../i18n/translate.ts";
import { useLayoutEffect, useRef, useState } from "react";
import { Stack, Tabs } from "@mantine/core";
import {
  ComponentsSettings,
  CookiePreferencesPanel,
  DiagnosticsPanel,
  DownloadPreferencesPanel,
} from "./ComponentsSettings";
import { DownloadOptionsPanel } from "./DownloadOptionsPanel";
import { NetworkPreferencesPanel } from "./NetworkPreferencesPanel";
import { GeneralPreferencesPanel } from "./GeneralPreferencesPanel";
import { ConcurrencyPanel } from "./ConcurrencyPanel";

const groups = [
  {
    value: "general",
    get label() {
      return t("通用");
    },
  },
  {
    value: "download",
    get label() {
      return t("下载");
    },
  },
  {
    value: "network",
    get label() {
      return t("网络与代理");
    },
  },
  {
    value: "cookies",
    get label() {
      return t("Cookie 与登录");
    },
  },
  {
    value: "components",
    get label() {
      return t("运行组件");
    },
  },
] as const;

export function SettingsPage({ active }: { active: boolean }) {
  useUiLocale();

  const [tab, setTab] = useState("download");
  const root = useRef<HTMLElement>(null);
  const scrollPositions = useRef<Record<string, number>>({});

  useLayoutEffect(() => {
    const viewport = root.current?.closest(".page-content");
    if (!active || !viewport) return;
    viewport.scrollTop = scrollPositions.current[tab] ?? 0;
    // Listen only while visible: other routes share this viewport and must not overwrite it.
    function rememberScroll() {
      scrollPositions.current[tab] = viewport!.scrollTop;
    }
    viewport.addEventListener("scroll", rememberScroll);
    return () => viewport.removeEventListener("scroll", rememberScroll);
  }, [active, tab]);

  function changeTab(value: string | null) {
    if (!value || value === tab) return;
    scrollPositions.current[tab] = root.current?.closest(".page-content")?.scrollTop ?? 0;
    setTab(value);
  }

  return (
    <main
      className="settings-page"
      ref={root}
      hidden={!active}
      style={active ? undefined : { display: "none" }}
    >
      <Tabs
        className="settings-tabs"
        value={tab}
        onChange={changeTab}
        keepMounted
        keepMountedMode="display-none"
        classNames={{ list: "settings-tab-list", tab: "settings-tab", panel: "settings-tab-panel" }}
      >
        <div className="settings-tab-bar">
          <Tabs.List aria-label={t("设置分组")}>
            {groups.map((group) => (
              <Tabs.Tab value={group.value} key={group.value}>
                {group.label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </div>
        <Tabs.Panel value="general">
          <Stack gap="lg">
            <GeneralPreferencesPanel />
            <DiagnosticsPanel />
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="download">
          <Stack gap="lg">
            <DownloadPreferencesPanel />
            <ConcurrencyPanel />
            <DownloadOptionsPanel />
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="network">
          <NetworkPreferencesPanel />
        </Tabs.Panel>
        <Tabs.Panel value="cookies">
          <CookiePreferencesPanel />
        </Tabs.Panel>
        <Tabs.Panel value="components">
          <ComponentsSettings />
        </Tabs.Panel>
      </Tabs>
    </main>
  );
}
