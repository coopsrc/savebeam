import { NavLink, Stack, Text, Tooltip } from "@mantine/core";
import { IconDownload, IconHistory, IconListCheck, IconSettings } from "@tabler/icons-react";
import { Link, useLocation } from "react-router-dom";

const primaryItems = [
  { path: "/download", label: "下载", icon: IconDownload },
  { path: "/tasks", label: "任务", icon: IconListCheck },
  { path: "/history", label: "历史", icon: IconHistory },
];

const settingsItem = { path: "/settings", label: "设置", icon: IconSettings };

interface SidebarProps {
  compact: boolean;
}

export function Sidebar({ compact }: SidebarProps) {
  const { pathname } = useLocation();

  const renderItem = (item: (typeof primaryItems)[number]) => {
    const Icon = item.icon;
    return (
      <Tooltip key={item.path} label={item.label} position="right" disabled={!compact}>
        <NavLink
          component={Link}
          to={item.path}
          label={item.label}
          aria-label={item.label}
          leftSection={<Icon size={20} stroke={1.8} aria-hidden="true" />}
          active={pathname === item.path}
          className="sidebar-link"
        />
      </Tooltip>
    );
  };

  const SettingsIcon = settingsItem.icon;

  return (
    <aside className={`app-sidebar${compact ? " is-compact" : ""}`}>
      <div className="sidebar-brand" aria-label="Savebeam">
        <span className="brand-mark" aria-hidden="true">
          S
        </span>
        {!compact && <Text fw={700}>Savebeam</Text>}
      </div>

      <nav className="sidebar-primary" aria-label="主导航">
        <Stack gap={6}>{primaryItems.map(renderItem)}</Stack>
      </nav>

      <div className="sidebar-settings">
        <Tooltip label={settingsItem.label} position="right" disabled={!compact}>
          <NavLink
            component={Link}
            to={settingsItem.path}
            label={settingsItem.label}
            aria-label={settingsItem.label}
            leftSection={<SettingsIcon size={20} stroke={1.8} aria-hidden="true" />}
            active={pathname === settingsItem.path}
            className="sidebar-link"
          />
        </Tooltip>
      </div>
    </aside>
  );
}
