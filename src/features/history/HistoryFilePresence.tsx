import { useEffect, useState } from "react";
import { Alert, Button, Group, Text } from "@mantine/core";
import { t, useUiLocale } from "../../i18n/translate";
import { invokeCommand } from "../../ipc/client";
import { useAppStore } from "../../stores/appStore";
import type { DownloadTask } from "../../types/domain";

export function HistoryFilePresence({
  taskId,
  active,
  groupKey,
  revision = "",
}: {
  taskId: string;
  active: boolean;
  groupKey?: string;
  revision?: string;
}) {
  useUiLocale();
  const [presence, setPresence] = useState<{
    state: string;
    missingCount: number;
    totalCount: number;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [requestedTask, setRequestedTask] = useState<string | null>(null);
  const queued = useAppStore((s) =>
    s.downloadTasks.some(
      (task) =>
        (task.id === taskId || task.id === requestedTask) &&
        ["queued", "preparing", "downloading", "post_processing", "cancelling"].includes(
          task.status,
        ),
    ),
  );
  const results = useAppStore((s) => s.downloadResults);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    void invokeCommand<typeof presence>(
      groupKey ? "get_record_group_file_presence" : "get_history_file_presence",
      groupKey ? { groupKey } : { taskId },
    )
      .then((value) => {
        if (!disposed && value && ["present", "missing", "unavailable"].includes(value.state))
          setPresence(value);
      })
      .catch(() => {
        if (!disposed) setPresence({ state: "unavailable", missingCount: 0, totalCount: 0 });
      });
    return () => {
      disposed = true;
    };
  }, [taskId, groupKey, active, results, revision]);
  async function download() {
    if (busy || queued) return;
    setBusy(true);
    setError(null);
    try {
      const task = await invokeCommand<DownloadTask>("redownload_missing_history", { taskId });
      useAppStore.getState().upsertDownloadTask(task);
      setRequestedTask(task.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("重新下载未完成。"));
    } finally {
      setBusy(false);
    }
  }
  if (!presence || presence.state === "present") return null;
  return (
    <>
      <Group justify="space-between">
        <Text size="sm" c="orange">
          {presence.state === "missing"
            ? t("文件已删除（{0}/{1}）", [presence.missingCount, presence.totalCount])
            : t("文件不可用或无法访问")}
        </Text>
        {!groupKey && (
          <Button
            size="xs"
            variant="light"
            loading={busy}
            disabled={queued}
            onClick={() => void download()}
          >
            {queued ? t("已加入任务列表") : t("重新下载")}
          </Button>
        )}
      </Group>
      {!groupKey && (
        <Text size="xs" c="dimmed">
          {t("重新下载会新建版本，旧记录保留。")}
        </Text>
      )}
      {error && (
        <Alert color="red" role="alert">
          {error}
        </Alert>
      )}
    </>
  );
}
