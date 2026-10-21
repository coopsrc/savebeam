import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Alert, Badge, Group, Paper, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";
import { usePlatformProfile } from "./app/platform/profile";
import { EmptyState } from "./components/states/AppStates";
import { AppShell } from "./layout/AppShell";
import { DownloadPage } from "./features/download/DownloadPage";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "./stores/appStore";
import "./App.css";

function FoundationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const profile = usePlatformProfile();
  const mockTasks = useAppStore((state) => state.mockTasks);
  const titleByRoute: Record<string, string> = {
    "/download": "下载",
    "/tasks": "任务",
    "/history": "历史",
    "/settings": "设置",
  };
  const title = titleByRoute[location.pathname] ?? "下载";

  if (location.pathname === "/tasks") {
    if (mockTasks.length > 0) {
      return (
        <main className="task-list-page">
          <Stack gap="md">
            <Alert color="blue" title="原型演示">
              这些是假任务，仅用于验证界面流程，不会启动下载或写入历史。
            </Alert>
            {mockTasks.map((task) => (
              <Paper key={task.id} withBorder radius="md" p="md">
                <Group justify="space-between" align="flex-start">
                  <Stack gap={4}>
                    <Text fw={600}>{task.title}</Text>
                    <Text size="sm" c="dimmed" className="validated-url">
                      {task.url}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {task.formatLabel}
                    </Text>
                  </Stack>
                  <Badge variant="light">排队中（模拟）</Badge>
                </Group>
              </Paper>
            ))}
          </Stack>
        </main>
      );
    }

    return (
      <EmptyState
        title="还没有下载任务"
        description="添加视频链接并通过后续解析后，下载任务会显示在这里。"
        actionLabel="添加视频链接"
        onAction={() => navigate("/download")}
      />
    );
  }

  if (location.pathname === "/history") {
    return (
      <EmptyState
        title="暂无下载记录"
        description="已完成的下载会保存在本机，并显示在这里。"
        actionLabel="开始添加链接"
        onAction={() => navigate("/download")}
      />
    );
  }

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
        <Route path="/download" element={<DownloadPage />} />
        <Route path="/tasks" element={<FoundationPage />} />
        <Route path="/history" element={<FoundationPage />} />
        <Route path="/settings" element={<FoundationPage />} />
        <Route path="*" element={<Navigate to="/download" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
