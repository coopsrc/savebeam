import { t, useUiLocale } from "../i18n/translate.ts";
import { useMediaQuery } from "@mantine/hooks";
import { IconDeviceDesktop } from "@tabler/icons-react";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { usePlatformProfile } from "../app/platform/profile";
import { Sidebar } from "./Sidebar";
import { IPC_EVENTS, listenToEvent } from "../ipc/events";
import type { AppError, DownloadProgress, DownloadResult, DownloadTask } from "../types/domain";
import { useAppStore } from "../stores/appStore";
import { invokeCommand } from "../ipc/client";
import { DownloadPage } from "../features/download/DownloadPage";
import { resolveDownloadSession } from "../features/download/downloadSession";
import { SettingsPage } from "../features/settings/SettingsPage";
import { HistoryPage } from "../features/history/HistoryPage";
import { SubscriptionsPage } from "../features/subscriptions/SubscriptionsPage";
import { TaskListPage } from "../features/tasks/TaskListPage";

const routeTitles: Record<string, string> = {
  get "/download"() {
    return t("下载");
  },
  get "/tasks"() {
    return t("任务");
  },
  get "/history"() {
    return t("历史");
  },
  get "/subscriptions"() {
    return t("订阅");
  },
  get "/settings"() {
    return t("设置");
  },
};

export function AppShell() {
  useUiLocale();

  const location = useLocation();
  const { pathname } = location;
  const navigate = useNavigate();
  const profile = usePlatformProfile();
  const compact = useMediaQuery("(max-width: 959px)", false, {
    getInitialValueInEffect: false,
  });
  const title = routeTitles[pathname] ?? t("下载");
  const downloadVisible = pathname === "/download";
  const settingsVisible = pathname === "/settings";
  const historyVisible = pathname === "/history";
  const subscriptionsVisible = pathname === "/subscriptions";
  const tasksVisible = pathname === "/tasks";
  const retainedRoute =
    settingsVisible || historyVisible || subscriptionsVisible || tasksVisible ? pathname : null;
  const [visited, setVisited] = useState(() => (retainedRoute ? [retainedRoute] : []));
  // Each retained page mounts on first visit only; at most four page instances are retained.
  if (retainedRoute && !visited.includes(retainedRoute)) setVisited([...visited, retainedRoute]);
  const [downloadSession, setDownloadSession] = useState(() =>
    resolveDownloadSession(null, location),
  );
  const session = resolveDownloadSession(downloadSession, location);
  // A bounded render-time adjustment keeps session identity consistent with this route commit.
  if (session !== downloadSession) setDownloadSession(session);
  const content = useRef<HTMLElement>(null);
  const downloadScroll = useRef<{ identity: object; top: number } | null>(null);
  const sessionIdentity = session?.identity;
  useLayoutEffect(() => {
    if (!downloadVisible || !sessionIdentity || !content.current) return;
    content.current.scrollTop =
      downloadScroll.current?.identity === sessionIdentity ? downloadScroll.current.top : 0;
  }, [downloadVisible, sessionIdentity]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const hasModifier = profile.modifierKey === "Meta" ? event.metaKey : event.ctrlKey;
      if (!hasModifier || event.altKey || event.shiftKey) return;

      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
      ) {
        return;
      }

      const routes: Record<string, string> = {
        "1": "/download",
        "2": "/tasks",
        "3": "/history",
        "4": "/subscriptions",
        ",": "/settings",
      };
      const route = routes[event.key];
      if (route) {
        event.preventDefault();
        navigate(route);
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [navigate, profile.modifierKey]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: Array<() => void> = [];
    void Promise.all([
      listenToEvent<DownloadTask>(IPC_EVENTS.downloadStateChanged, (task) => {
        useAppStore.getState().upsertDownloadTask(task);
      }),
      listenToEvent<string>(IPC_EVENTS.downloadRemoved, (taskId) => {
        useAppStore.getState().removeDownloadTask(taskId);
      }),
      listenToEvent<DownloadProgress>(IPC_EVENTS.downloadProgress, (progress) => {
        useAppStore.getState().updateDownloadProgress(progress);
      }),
      listenToEvent<AppError>(IPC_EVENTS.downloadError, (error) => {
        useAppStore.getState().setLastDownloadError(error);
      }),
      listenToEvent<DownloadResult>(IPC_EVENTS.downloadResult, (result) => {
        useAppStore.getState().setDownloadResult(result);
      }),
    ])
      .then((listeners) => {
        if (disposed) listeners.forEach((stop) => stop());
        else {
          unlisten = listeners;
          void invokeCommand<DownloadTask[]>("get_download_tasks")
            .then((tasks) =>
              tasks.forEach((task) => useAppStore.getState().upsertDownloadTask(task)),
            )
            .catch((error: unknown) => {
              useAppStore.getState().setLastDownloadError({
                code: "unknown",
                message: error instanceof Error ? error.message : t("无法读取本地任务记录。"),
                retryable: true,
              });
            });
        }
      })
      .catch(() => {
        useAppStore.getState().setLastDownloadError({
          code: "unknown",
          message: t("无法订阅下载进度事件，请重新启动应用。"),
          retryable: true,
        });
      });
    return () => {
      disposed = true;
      unlisten.forEach((stop) => stop());
    };
  }, []);

  return (
    <div className={`app-shell${compact ? " is-compact" : ""}`}>
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        {t("跳转到主要内容")}
      </a>
      <Sidebar compact={compact} />
      <div className="app-workspace">
        <header className="page-toolbar">
          <div>
            <p className="toolbar-eyebrow">SAVEBEAM DESKTOP</p>
            <h1 className="toolbar-title">{title}</h1>
          </div>
        </header>
        <section
          ref={content}
          id="main-content"
          className="page-content"
          aria-label={t("{0}页面", [title])}
          tabIndex={-1}
          onScroll={(event) => {
            if (downloadVisible && session)
              downloadScroll.current = {
                identity: session.identity,
                top: event.currentTarget.scrollTop,
              };
          }}
        >
          {session && (
            <DownloadPage
              key={session.key}
              initialUrl={session.initialUrl}
              active={downloadVisible}
              onDraftTouched={() =>
                setDownloadSession((current) =>
                  current?.identity === session.identity && !current.retained
                    ? { ...current, retained: true }
                    : current,
                )
              }
              onQueued={() =>
                setDownloadSession((current) =>
                  current?.identity === session.identity ? { ...current, consumed: true } : current,
                )
              }
            />
          )}
          {visited.includes("/settings") && <SettingsPage active={settingsVisible} />}
          {visited.includes("/tasks") && <TaskListPage active={tasksVisible} />}
          {visited.includes("/history") && <HistoryPage active={historyVisible} />}
          {visited.includes("/subscriptions") && (
            <SubscriptionsPage active={subscriptionsVisible} />
          )}
          {!downloadVisible && !retainedRoute && <Outlet />}
        </section>
        <footer className="status-bar" aria-label={t("应用状态")}>
          <span className="status-indicator" aria-hidden="true" />
          <span>{t("本地运行")}</span>
          <span className="status-separator" aria-hidden="true">
            ·
          </span>
          <span>{t("任务与媒体文件仅在本机处理")}</span>
          <span className="status-platform">
            <IconDeviceDesktop size={14} stroke={1.8} aria-hidden="true" />
            {t("桌面版")}
          </span>
          <span className="shortcut-hint">
            {profile.modifierKey === "Meta" ? "⌘" : "Ctrl"}
            {t("1–4 导航 ·")} {profile.modifierKey === "Meta" ? "⌘" : "Ctrl"}
            {t('", 设置')}
          </span>
        </footer>
      </div>
    </div>
  );
}
