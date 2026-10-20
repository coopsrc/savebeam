import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Badge, Group, Paper, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";
import { usePlatformProfile } from "./app/platform/profile";
import { AppShell } from "./layout/AppShell";
import "./App.css";

function FoundationPage() {
  const location = useLocation();
  const profile = usePlatformProfile();
  const titleByRoute: Record<string, string> = {
    "/download": "下载",
    "/tasks": "任务",
    "/history": "历史",
    "/settings": "设置",
  };
  const title = titleByRoute[location.pathname] ?? "下载";

  return (
    <main className="foundation-page">
      <Paper className="foundation-card" shadow="sm" radius="lg" withBorder>
        <Stack gap="lg">
          <Group gap="md" align="center">
            <ThemeIcon size={48} radius="md" variant="light" color="blue">
              <IconDownload size={26} stroke={1.8} aria-hidden="true" />
            </ThemeIcon>
            <div>
              <Text className="eyebrow">SAVEBEAM DESKTOP</Text>
              <Title order={1}>{title}</Title>
            </div>
          </Group>
          <Text c="dimmed">界面基础已就绪。后续里程碑将逐步加入导航、媒体信息和下载任务交互。</Text>
          <Group justify="space-between" align="center">
            <Badge variant="light" color="blue">
              M1 · UI Foundation
            </Badge>
            <Text size="sm" c="dimmed">
              平台样式：{profile.label}
            </Text>
          </Group>
        </Stack>
      </Paper>
    </main>
  );
}

function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/download" replace />} />
        <Route path="/download" element={<FoundationPage />} />
        <Route path="/tasks" element={<FoundationPage />} />
        <Route path="/history" element={<FoundationPage />} />
        <Route path="/settings" element={<FoundationPage />} />
        <Route path="*" element={<Navigate to="/download" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
