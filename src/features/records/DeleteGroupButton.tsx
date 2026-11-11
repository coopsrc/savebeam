import { useState } from "react";
import { Alert, Button, Checkbox, Group, Modal, Stack, Text } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import { t, useUiLocale } from "../../i18n/translate";
import { invokeCommand } from "../../ipc/client";
import { useAppStore } from "../../stores/appStore";
import type { DownloadGroup } from "../../types/domain";

export function DeleteGroupButton({
  context,
  history,
  active,
  onDeleted,
}: {
  context: DownloadGroup;
  history: boolean;
  active: boolean;
  onDeleted?: (error?: string) => void;
}) {
  useUiLocale();
  const [opened, setOpened] = useState(false),
    [busy, setBusy] = useState(false),
    [members, setMembers] = useState<string[]>([]),
    [files, setFiles] = useState(false),
    [error, setError] = useState<string | null>(null);
  async function open() {
    setOpened(true);
    setBusy(true);
    setFiles(false);
    setMembers([]);
    setError(null);
    try {
      setMembers(
        await invokeCommand<string[]>("get_record_group_members", {
          groupKey: context.key,
          history,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("无法读取删除范围。"));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (busy || !members.length) return;
    setBusy(true);
    setError(null);
    try {
      const result = await invokeCommand<{ removedIds: string[]; error: string | null }>(
        "delete_record_group",
        { groupKey: context.key, taskIds: members, history, deleteFiles: history && files },
      );
      if (!history) result.removedIds.forEach(useAppStore.getState().removeDownloadTask);
      setMembers((v) => v.filter((id) => !result.removedIds.includes(id)));
      if (result.error)
        setError(
          t("已删除 {0} 条；其余记录未删除，可重试。", [result.removedIds.length]) +
            " " +
            result.error,
        );
      else {
        setOpened(false);
        onDeleted?.();
      }
      // Refresh successful rows even when a later item failed.
      if (result.error) {
        onDeleted?.(result.error);
        if (!history)
          useAppStore
            .getState()
            .setLastDownloadError({ code: "unknown", message: result.error, retryable: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("整组删除未完成。"));
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
        onClick={() => void open()}
      >
        {t("删除整组")}
      </Button>
      <Modal
        opened={active && opened}
        returnFocus={active}
        onClose={() => {
          if (!busy) setOpened(false);
        }}
        title={t("删除整组")}
        centered
        closeOnEscape={!busy}
        closeOnClickOutside={!busy}
        withCloseButton={!busy}
      >
        <Stack gap="md">
          <Text fw={600}>{context.title}</Text>
          <Text>{t("本次确认范围：{0} 条记录。", [members.length])}</Text>
          <Text size="sm" c="dimmed">
            {history
              ? t(
                  "删除该组全部历史记录（含历史版本），包括当前搜索未显示的记录；确认后新增的记录不在本次范围内。",
                )
              : t(
                  "取消并移除该组未完成任务；已完成的历史、下载文件及订阅状态均保留。确认后新增的任务不在本次范围内。",
                )}
          </Text>
          {history && (
            <Checkbox
              label={t("同时删除下载文件")}
              description={t("移入系统废纸篓或回收站，已不存在的文件会跳过。")}
              checked={files}
              disabled={busy}
              onChange={(e) => setFiles(e.currentTarget.checked)}
            />
          )}
          {history && files && (
            <Text c="red" size="sm">
              {t(
                "仅处理记录关联的媒体文件，不删除目录或其他附属文件。部分失败时保留未删除记录以便重试。",
              )}
            </Text>
          )}
          {error && (
            <Alert color="red" role="alert">
              {error}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button variant="default" disabled={busy} onClick={() => setOpened(false)}>
              {t("取消")}
            </Button>
            <Button
              color="red"
              loading={busy}
              disabled={!members.length}
              onClick={() => void remove()}
            >
              {t("确认删除整组")}
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
