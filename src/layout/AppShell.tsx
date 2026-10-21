import { useMediaQuery } from "@mantine/hooks";
import { IconDeviceDesktop } from "@tabler/icons-react";
import { isTauri } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { usePlatformProfile } from "../app/platform/profile";
import { Sidebar } from "./Sidebar";
import { IPC_EVENTS, listenToEvent } from "../ipc/events";
import type { AppError, DownloadProgress, DownloadResult, DownloadTask } from "../types/domain";
import { useAppStore } from "../stores/appStore";

const routeTitles: Record<string, string> = {
  "/download": "下载",
  "/tasks": "任务",
  "/history": "历史",
  "/settings": "设置",
};

export function AppShell() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const profile = usePlatformProfile();
  const compact = useMediaQuery("(max-width: 959px)", false, {
    getInitialValueInEffect: false,
  });
  const title = routeTitles[pathname] ?? "下载";

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
        else unlisten = listeners;
      })
      .catch(() => {
        useAppStore.getState().setLastDownloadError({
          code: "unknown",
          message: "无法订阅下载进度事件，请重新启动应用。",
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
        跳转到主要内容
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
          id="main-content"
          className="page-content"
          aria-label={`${title}页面`}
          tabIndex={-1}
        >
          <Outlet />
        </section>
        <footer className="status-bar" aria-label="应用状态">
          <span className="status-indicator" aria-hidden="true" />
          <span>本地运行</span>
          <span className="status-separator" aria-hidden="true">
            ·
          </span>
          <span>任务与媒体文件仅在本机处理</span>
          <span className="status-platform">
            <IconDeviceDesktop size={14} stroke={1.8} aria-hidden="true" />
            桌面版
          </span>
          <span className="shortcut-hint">
            {profile.modifierKey === "Meta" ? "⌘" : "Ctrl"}1–3 导航 ·{" "}
            {profile.modifierKey === "Meta" ? "⌘" : "Ctrl"}", 设置
          </span>
        </footer>
      </div>
    </div>
  );
}
