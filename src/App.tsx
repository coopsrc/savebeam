import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useState } from "react";
import {
  Alert,
  Badge,
  Button,
  Group,
  Paper,
  Progress,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconDownload } from "@tabler/icons-react";
import { usePlatformProfile } from "./app/platform/profile";
import { EmptyState } from "./components/states/AppStates";
import { AppShell } from "./layout/AppShell";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "./stores/appStore";
import { ComponentsSettings } from "./features/settings/ComponentsSettings";
import { HistoryPage } from "./features/history/HistoryPage";
import { SubscriptionsPage } from "./features/subscriptions/SubscriptionsPage";
import { CompletedTaskActions } from "./features/tasks/CompletedTaskActions";
import { DeleteTaskButton } from "./features/tasks/DeleteTaskButton";
import { invokeCommand, IpcError } from "./ipc/client";
import type { DownloadTask } from "./types/domain";
import "./App.css";
import { formatBytes } from "./utils/formatBytes";

function FoundationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const profile = usePlatformProfile();
  const downloadTasks = useAppStore((state) => state.downloadTasks);
  const downloadProgress = useAppStore((state) => state.downloadProgress);
  const lastDownloadError = useAppStore((state) => state.lastDownloadError);
  const upsertDownloadTask = useAppStore((state) => state.upsertDownloadTask);
  const setLastDownloadError = useAppStore((state) => state.setLastDownloadError);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const titleByRoute: Record<string, string> = {
    "/download": "下载",
    "/tasks": "任务",
    "/history": "历史",
    "/settings": "设置",
  };
  const title = titleByRoute[location.pathname] ?? "下载";

  async function changeTask(taskId: string, action: "cancel" | "retry") {
    setBusyTaskId(taskId);
    setLastDownloadError(null);
    try {
      const task = await invokeCommand<DownloadTask>(
        action === "cancel" ? "cancel_download" : "retry_download",
        { taskId },
      );
      upsertDownloadTask(task);
    } catch (error: unknown) {
      setLastDownloadError({
        code: error instanceof IpcError ? error.code : "unknown",
        message: error instanceof Error ? error.message : "无法更新下载任务。",
        retryable: error instanceof IpcError && error.retryable,
      });
    } finally {
      setBusyTaskId(null);
    }
  }

  if (location.pathname === "/settings") {
    return <ComponentsSettings />;
  }

  if (location.pathname === "/history") {
    return <HistoryPage />;
  }

  if (location.pathname === "/tasks") {
    if (downloadTasks.length > 0) {
      return (
        <main className="task-list-page">
          <Stack gap="md">
            {lastDownloadError && (
              <Alert
                color="red"
                title="下载任务失败"
                role="alert"
                onClose={() => useAppStore.getState().setLastDownloadError(null)}
                withCloseButton
              >
                {lastDownloadError.message}
              </Alert>
            )}
            {downloadTasks.map((task) => {
              const progress = downloadProgress[task.id];
              const percent =
                progress?.totalBytes && progress.downloadedBytes != null
                  ? Math.min(100, (progress.downloadedBytes / progress.totalBytes) * 100)
                  : 0;
              const statusLabel: Record<typeof task.status, string> = {
                queued: "排队中",
                preparing: "准备中",
                downloading: "下载中",
                post_processing: "后处理中",
                completed: "已完成",
                failed: "失败",
                cancelling: "正在取消",
                cancelled: "已取消",
              };
              return (
                <Paper
                  key={task.id}
                  component="section"
                  aria-label={`任务：${task.title}`}
                  withBorder
                  radius="md"
                  p="md"
                >
                  <Stack gap="sm">
                    <Group justify="space-between" align="flex-start">
                      <Stack gap={4}>
                        <Text fw={600}>{task.title}</Text>
                        <Text size="xs" c="dimmed">
                          格式：{task.formatId}
                        </Text>
                      </Stack>
                      <Badge
                        role="status"
                        aria-label={`下载任务状态：${statusLabel[task.status]}`}
                        variant="light"
                        color={
                          task.status === "failed"
                            ? "red"
                            : task.status === "completed"
                              ? "green"
                              : "blue"
                        }
                      >
                        {statusLabel[task.status]}
                      </Badge>
                    </Group>
                    <Group justify="flex-end">
                      <DeleteTaskButton task={task} />
                      {["queued", "preparing", "downloading", "post_processing"].includes(
                        task.status,
                      ) && (
                        <Button
                          size="xs"
                          variant="light"
                          color="red"
                          loading={busyTaskId === task.id}
                          onClick={() => void changeTask(task.id, "cancel")}
                        >
                          取消
                        </Button>
                      )}
                      {["failed", "cancelled"].includes(task.status) && (
                        <Button
                          size="xs"
                          variant="light"
                          loading={busyTaskId === task.id}
                          onClick={() => void changeTask(task.id, "retry")}
                        >
                          重试
                        </Button>
                      )}
                    </Group>
                    {progress &&
                      (task.status === "downloading" || task.status === "post_processing") && (
                        <Stack gap={4}>
                          <Progress
                            value={percent}
                            animated={task.status === "downloading"}
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.round(percent)}
                            aria-label={`${task.title} 下载进度`}
                            aria-valuetext={`${Math.round(percent)}%`}
                          />
                          <Group justify="space-between">
                            <Text size="xs" c="dimmed">
                              {progress.downloadedBytes == null
                                ? "正在准备传输"
                                : `${formatBytes(progress.downloadedBytes)}${progress.totalBytes ? ` / ${formatBytes(progress.totalBytes)}` : ""}`}
                            </Text>
                            <Text size="xs" c="dimmed">
                              {progress.postProcessing
                                ? "正在合并媒体流"
                                : [
                                    progress.speedBytesPerSecond
                                      ? `${formatBytes(progress.speedBytesPerSecond)}/s`
                                      : null,
                                    progress.etaSeconds != null
                                      ? `剩余 ${formatDuration(progress.etaSeconds)}`
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                            </Text>
                          </Group>
                        </Stack>
                      )}
                    {task.status === "completed" && <CompletedTaskActions task={task} />}
                  </Stack>
                </Paper>
              );
            })}
          </Stack>
        </main>
      );
    }

    return (
      <EmptyState
        title="还没有下载任务"
        description="解析视频信息并开始下载后，任务进度会显示在这里。"
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

function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  return minutes > 0 ? `${minutes}分${remainder}秒` : `${remainder}秒`;
}

function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Navigate to="/download" replace />} />
        <Route path="/download" element={null} />
        <Route path="/tasks" element={<FoundationPage />} />
        <Route path="/history" element={<FoundationPage />} />
        <Route path="/subscriptions" element={<SubscriptionsPage />} />
        <Route path="/settings" element={<FoundationPage />} />
        <Route path="*" element={<Navigate to="/download" replace />} />
      </Route>
    </Routes>
  );
}

export default App;
