import { useState } from "react";
import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { invokeCommand, IpcError } from "../../ipc/client";
import { useAppStore } from "../../stores/appStore";
import type { DownloadTask } from "../../types/domain";

export function DeleteTaskButton({ task }: { task: DownloadTask }) {
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!["completed", "failed", "cancelled"].includes(task.status)) return null;

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await invokeCommand<boolean>("delete_download_task", { taskId: task.id });
      useAppStore.getState().removeDownloadTask(task.id);
      setOpened(false);
    } catch (reason: unknown) {
      setError(
        reason instanceof IpcError
          ? reason.contextMessage
          : reason instanceof Error
            ? reason.message
            : "删除任务失败，请重试。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size="xs"
        variant="subtle"
        color="red"
        leftSection={<IconTrash size={14} />}
        onClick={() => {
          setError(null);
          setOpened(true);
        }}
      >
        删除任务
      </Button>
      <Modal
        opened={opened}
        onClose={() => {
          if (!busy) setOpened(false);
        }}
        title="删除任务"
        centered
        closeOnEscape={!busy}
        closeOnClickOutside={!busy}
        withCloseButton={!busy}
      >
        <Stack gap="md">
          <Text>确定从任务列表删除“{task.title}”？</Text>
          <Text size="sm" c="dimmed">
            只移除任务，保留下载文件、历史记录和订阅的已下载状态。若需删除文件，请前往“历史”单独操作。
          </Text>
          {error && (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" disabled={busy} onClick={() => setOpened(false)}>
              返回
            </Button>
            <Button color="red" loading={busy} onClick={() => void confirm()}>
              确认删除任务
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
