import { useState } from "react";
import { Badge, Button, Group, Paper, Progress, Stack, Text } from "@mantine/core";
import { t, useUiLocale } from "../../i18n/translate";
import { invokeCommand, IpcError } from "../../ipc/client";
import { useAppStore } from "../../stores/appStore";
import type { DownloadTask } from "../../types/domain";
import { formatBytes } from "../../utils/formatBytes";
import { DeleteTaskButton } from "./DeleteTaskButton";
import { CompletedTaskActions } from "./CompletedTaskActions";

function formatDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  return rounded >= 60
    ? t("{0}分{1}秒", [Math.floor(rounded / 60), rounded % 60])
    : t("{0}秒", [rounded]);
}

export function TaskCard({ task, active }: { task: DownloadTask; active: boolean }) {
  useUiLocale();
  const progress = useAppStore((s) => s.downloadProgress[task.id]);
  const [busy, setBusy] = useState(false);
  const labels = {
    queued: t("排队中"),
    preparing: t("准备中"),
    downloading: t("下载中"),
    post_processing: t("后处理中"),
    completed: t("已完成"),
    failed: t("失败"),
    cancelling: t("正在取消"),
    cancelled: t("已取消"),
  };
  const percent =
    progress?.totalBytes && progress.downloadedBytes != null
      ? Math.min(100, (progress.downloadedBytes / progress.totalBytes) * 100)
      : 0;
  async function change(action: "cancel" | "retry") {
    if (busy) return;
    setBusy(true);
    useAppStore.getState().setLastDownloadError(null);
    try {
      const updated = await invokeCommand<DownloadTask>(
        action === "cancel" ? "cancel_download" : "retry_download",
        { taskId: task.id },
      );
      useAppStore.getState().upsertDownloadTask(updated);
    } catch (error) {
      useAppStore.getState().setLastDownloadError({
        code: error instanceof IpcError ? error.code : "unknown",
        message: error instanceof Error ? error.message : t("无法更新下载任务。"),
        retryable: error instanceof IpcError && error.retryable,
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <Paper
      component="section"
      aria-label={t("任务：{0}", [task.title])}
      withBorder
      radius="md"
      p="md"
    >
      <Stack gap="sm">
        <Group justify="space-between" align="start">
          <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
            <Text fw={600} style={{ overflowWrap: "anywhere" }}>
              {task.title}
            </Text>
            <Text size="xs" c="dimmed">
              {t("格式：")}
              {task.formatId}
            </Text>
          </Stack>
          <Badge
            role="status"
            aria-label={t("下载任务状态：{0}", [labels[task.status]])}
            color={
              task.status === "failed" ? "red" : task.status === "completed" ? "green" : "blue"
            }
          >
            {labels[task.status]}
          </Badge>
        </Group>
        <Group justify="flex-end">
          <DeleteTaskButton task={task} active={active} />
          {["queued", "preparing", "downloading", "post_processing"].includes(task.status) && (
            <Button
              size="xs"
              variant="light"
              color="red"
              loading={busy}
              onClick={() => void change("cancel")}
            >
              {t("取消")}
            </Button>
          )}
          {["failed", "cancelled"].includes(task.status) && (
            <Button size="xs" variant="light" loading={busy} onClick={() => void change("retry")}>
              {t("重试")}
            </Button>
          )}
        </Group>
        {progress && ["downloading", "post_processing"].includes(task.status) && (
          <Stack gap={4}>
            <Progress.Root>
              <Progress.Section
                value={percent}
                withAria={false}
                animated={task.status === "downloading"}
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(percent)}
                aria-label={t("{0} 下载进度", [task.title])}
                aria-valuetext={`${Math.round(percent)}%`}
              />
            </Progress.Root>
            <Group justify="space-between">
              <Text size="xs" c="dimmed">
                {progress.downloadedBytes == null
                  ? t("正在准备传输")
                  : `${formatBytes(progress.downloadedBytes)}${progress.totalBytes ? ` / ${formatBytes(progress.totalBytes)}` : ""}`}
              </Text>
              <Text size="xs" c="dimmed">
                {progress.postProcessing
                  ? t("正在合并媒体流")
                  : [
                      progress.speedBytesPerSecond
                        ? `${formatBytes(progress.speedBytesPerSecond)}/s`
                        : null,
                      progress.etaSeconds != null
                        ? t("剩余 {0}", [formatDuration(progress.etaSeconds)])
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
              </Text>
            </Group>
          </Stack>
        )}
        {task.status === "completed" && <CompletedTaskActions task={task} active={active} />}
      </Stack>
    </Paper>
  );
}
