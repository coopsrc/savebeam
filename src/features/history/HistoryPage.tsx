import { useEffect, useState } from "react";
import { Alert, Button, Group, Paper, Stack, Text, TextInput, Title } from "@mantine/core";
import { IconExternalLink, IconFolderOpen, IconTrash } from "@tabler/icons-react";
import { invokeCommand, IpcError } from "../../ipc/client";
import type { DownloadHistoryRecord } from "../../types/domain";
import { formatBytes } from "../../utils/formatBytes";

export function HistoryPage() {
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<DownloadHistoryRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyTask, setBusyTask] = useState<string | null>(null);

  async function load(search = query) {
    setError(null);
    try {
      setRecords(
        await invokeCommand<DownloadHistoryRecord[]>("get_download_history", { query: search }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法读取下载历史。");
    }
  }

  useEffect(() => {
    let mounted = true;
    invokeCommand<DownloadHistoryRecord[]>("get_download_history", { query: "" })
      .then((items) => {
        if (mounted) setRecords(items);
      })
      .catch((reason: unknown) => {
        if (mounted) setError(reason instanceof Error ? reason.message : "无法读取下载历史。");
      });
    return () => {
      mounted = false;
    };
  }, []);

  async function runAction(
    taskId: string,
    action: "delete_download_history" | "open_history_file" | "open_history_folder",
    outputIndex = 0,
  ) {
    setBusyTask(taskId);
    setError(null);
    try {
      await invokeCommand(action, { taskId, outputIndex });
      if (action === "delete_download_history") await load();
    } catch (reason) {
      setError(
        reason instanceof IpcError || reason instanceof Error ? reason.message : "操作失败。",
      );
    } finally {
      setBusyTask(null);
    }
  }

  return (
    <main className="task-list-page">
      <Stack gap="md">
        <Group justify="space-between" align="end">
          <div>
            <Title order={2}>下载历史</Title>
            <Text size="sm" c="dimmed">
              历史记录仅保存在本机；删除记录不会删除媒体文件。
            </Text>
          </div>
        </Group>
        <Group align="end">
          <TextInput
            label="搜索标题或文件路径"
            placeholder="输入关键词"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void load();
            }}
            style={{ flex: 1 }}
          />
          <Button onClick={() => void load()}>搜索</Button>
        </Group>
        {error && (
          <Alert color="red" title="历史操作失败" role="alert">
            {error}
          </Alert>
        )}
        {records.length === 0 ? (
          <Paper withBorder radius="md" p="xl">
            <Text c="dimmed">暂无下载历史。</Text>
          </Paper>
        ) : (
          records.map((record) => (
            <Paper key={record.taskId} withBorder radius="md" p="md">
              <Stack gap="sm">
                <Group justify="space-between" align="start">
                  <div>
                    <Text fw={600}>{record.title}</Text>
                    <Text size="xs" c="dimmed">
                      {new Date(record.completedAtUnixMs).toLocaleString()} ·{" "}
                      {formatBytes(record.totalBytes)}
                    </Text>
                  </div>
                  <Button
                    variant="subtle"
                    color="red"
                    leftSection={<IconTrash size={16} />}
                    loading={busyTask === record.taskId}
                    onClick={() => void runAction(record.taskId, "delete_download_history")}
                  >
                    删除记录
                  </Button>
                </Group>
                {record.outputPaths.map((path, index) => (
                  <Group key={`${record.taskId}-${index}`} justify="space-between" wrap="nowrap">
                    <Text size="sm" truncate title={path}>
                      {path}
                    </Text>
                    <Group gap="xs" wrap="nowrap">
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconExternalLink size={14} />}
                        loading={busyTask === record.taskId}
                        onClick={() => void runAction(record.taskId, "open_history_file", index)}
                      >
                        打开文件
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconFolderOpen size={14} />}
                        loading={busyTask === record.taskId}
                        onClick={() => void runAction(record.taskId, "open_history_folder", index)}
                      >
                        打开目录
                      </Button>
                    </Group>
                  </Group>
                ))}
              </Stack>
            </Paper>
          ))
        )}
      </Stack>
    </main>
  );
}
