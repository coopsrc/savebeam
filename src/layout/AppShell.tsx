import { useMediaQuery } from "@mantine/hooks";
import { IconDeviceDesktop } from "@tabler/icons-react";
import { Outlet, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";

const routeTitles: Record<string, string> = {
  "/download": "下载",
  "/tasks": "任务",
  "/history": "历史",
  "/settings": "设置",
};

export function AppShell() {
  const { pathname } = useLocation();
  const compact = useMediaQuery("(max-width: 959px)", false, {
    getInitialValueInEffect: false,
  });
  const title = routeTitles[pathname] ?? "下载";

  return (
    <div className={`app-shell${compact ? " is-compact" : ""}`}>
      <Sidebar compact={compact} />
      <div className="app-workspace">
        <header className="page-toolbar">
          <div>
            <p className="toolbar-eyebrow">SAVEBEAM DESKTOP</p>
            <h1 className="toolbar-title">{title}</h1>
          </div>
        </header>
        <section className="page-content" aria-label={`${title}页面`}>
          <Outlet />
        </section>
        <footer className="status-bar">
          <span className="status-indicator" aria-hidden="true" />
          <span>本地运行</span>
          <span className="status-separator" aria-hidden="true">
            ·
          </span>
          <span>下载组件将在后续里程碑接入</span>
          <span className="status-platform">
            <IconDeviceDesktop size={14} stroke={1.8} aria-hidden="true" />
            桌面版
          </span>
        </footer>
      </div>
    </div>
  );
}
