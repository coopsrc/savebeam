import { t, useUiLocale, getUiLocale } from "../../i18n/translate.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconExternalLink, IconFolderOpen, IconTrash } from "@tabler/icons-react";
import { invokeCommand, IpcError } from "../../ipc/client";
import type { DownloadHistoryRecord } from "../../types/domain";
import { formatBytes } from "../../utils/formatBytes";
import { useRetainedPageScroll } from "../../layout/useRetainedPageScroll";
import { useAppStore } from "../../stores/appStore";
import { MediaVersionsButton } from "./MediaVersionsButton";

export function HistoryPage({ active }: { active: boolean }) {
  useUiLocale();

  const root = useRetainedPageScroll(active);
  const [query, setQuery] = useState("");
  const [records, setRecords] = useState<DownloadHistoryRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyTask, setBusyTask] = useState<string | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<DownloadHistoryRecord | null>(null);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [deletionError, setDeletionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const deleting = pendingDeletion !== null && busyTask === pendingDeletion.taskId;
  const results = useAppStore((state) => state.downloadResults);
  const appliedQuery = useRef("");
  const request = useRef<object | null>(null);

  const load = useCallback(async (search: string) => {
    const revision = {};
    request.current = revision;
    appliedQuery.current = search;
    try {
      const items = await invokeCommand<DownloadHistoryRecord[]>("get_download_history", {
        query: search,
      });
      if (revision === request.current) {
        setRecords(items);
        setError(null);
      }
    } catch (reason) {
      if (revision === request.current)
        setError(reason instanceof Error ? reason.message : t("无法读取下载历史。"));
    }
  }, []);

  useEffect(() => {
    const revision = {};
    request.current = revision;
    // Initial read and newly saved results use the submitted filter, never the input draft.
    void invokeCommand<DownloadHistoryRecord[]>("get_download_history", {
      query: appliedQuery.current,
    })
      .then((items) => {
        if (revision === request.current) {
          setRecords(items);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (revision === request.current)
          setError(reason instanceof Error ? reason.message : t("无法读取下载历史。"));
      });
    return () => {
      request.current = null;
    };
  }, [results]);

  async function runAction(
    taskId: string,
    action: "open_history_file" | "open_history_folder",
    outputIndex = 0,
  ) {
    setBusyTask(taskId);
    setError(null);
    try {
      await invokeCommand(action, { taskId, outputIndex });
    } catch (reason) {
      setError(
        reason instanceof IpcError || reason instanceof Error ? reason.message : t("操作失败。"),
      );
    } finally {
      setBusyTask(null);
    }
  }

  function requestDeletion(record: DownloadHistoryRecord) {
    setPendingDeletion(record);
    setDeleteFiles(false);
    setDeletionError(null);
    setNotice(null);
  }

  function closeDeletion() {
    if (!deleting) setPendingDeletion(null);
  }

  async function confirmDeletion() {
    if (!pendingDeletion || deleting) return;
    setBusyTask(pendingDeletion.taskId);
    setDeletionError(null);
    setError(null);
    try {
      const deleted = await invokeCommand<boolean>("delete_download_history", {
        taskId: pendingDeletion.taskId,
        deleteFiles,
      });
      setPendingDeletion(null);
      setNotice(
        !deleted
          ? t("该历史记录已不存在。")
          : deleteFiles
            ? t("历史记录已删除，仍存在的关联媒体文件已移入系统废纸篓或回收站。")
            : t("历史记录已删除，下载文件已保留。"),
      );
      await load(appliedQuery.current);
    } catch (reason) {
      setDeletionError(reason instanceof Error ? reason.message : t("删除操作未完成。"));
    } finally {
      setBusyTask(null);
    }
  }

  return (
    <main
      className="task-list-page history-page"
      ref={root}
      hidden={!active}
      style={active ? undefined : { display: "none" }}
    >
      <Stack gap="md">
        <Group justify="space-between" align="end">
          <div>
            <Title order={2}>{t("下载历史")}</Title>
            <Text size="sm" c="dimmed">
              {t(
                "历史记录仅保存在本机；删除时默认保留文件，也可选择将关联媒体文件移入系统废纸篓或回收站。",
              )}
            </Text>
          </div>
        </Group>
        <Group align="end">
          <TextInput
            label={t("搜索标题或文件路径")}
            placeholder={t("输入关键词")}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void load(query);
            }}
            style={{ flex: 1 }}
          />
          <Button onClick={() => void load(query)}>{t("搜索")}</Button>
        </Group>
        {error && (
          <Alert color="red" title={t("历史操作失败")} role="alert">
            {error}
          </Alert>
        )}
        {notice && (
          <Alert color="green" role="status">
            {notice}
          </Alert>
        )}
        {records.length === 0 ? (
          <Paper withBorder radius="md" p="xl">
            <Text c="dimmed">{t("暂无下载历史。")}</Text>
          </Paper>
        ) : (
          records.map((record) => (
            <Paper key={record.taskId} withBorder radius="md" p="md">
              <Stack gap="sm">
                <Group justify="space-between" align="start">
                  <div>
                    <Text fw={600}>{record.title}</Text>
                    <Text size="xs" c="dimmed">
                      {new Date(record.completedAtUnixMs).toLocaleString(getUiLocale())} ·{" "}
                      {formatBytes(record.totalBytes)}
                    </Text>
                  </div>
                  <Group gap="xs">
                    <MediaVersionsButton taskId={record.taskId} active={active} />
                    <Button
                      variant="subtle"
                      color="red"
                      leftSection={<IconTrash size={16} />}
                      loading={busyTask === record.taskId}
                      disabled={busyTask !== null}
                      onClick={() => requestDeletion(record)}
                    >
                      {t("删除记录")}
                    </Button>
                  </Group>
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
                        {t("打开文件")}
                      </Button>
                      <Button
                        size="xs"
                        variant="light"
                        leftSection={<IconFolderOpen size={14} />}
                        loading={busyTask === record.taskId}
                        onClick={() => void runAction(record.taskId, "open_history_folder", index)}
                      >
                        {t("打开目录")}
                      </Button>
                    </Group>
                  </Group>
                ))}
              </Stack>
            </Paper>
          ))
        )}
      </Stack>
      <Modal
        opened={active && pendingDeletion !== null}
        returnFocus={active}
        onClose={closeDeletion}
        title={t("删除下载历史")}
        centered
        closeOnClickOutside={!deleting}
        closeOnEscape={!deleting}
        withCloseButton={!deleting}
      >
        {pendingDeletion && (
          <Stack gap="md">
            <Text>
              {t("确认删除“")}
              {pendingDeletion.title}
              {t("”的历史记录？")}
            </Text>
            <Text size="sm" c="dimmed">
              {t("此记录关联的下载文件（")}
              {pendingDeletion.outputPaths.length} {t(" 个）：")}
            </Text>
            <Stack gap="xs" mah={180} style={{ overflowY: "auto" }}>
              {pendingDeletion.outputPaths.map((path, index) => (
                <Text key={`${index}-${path}`} size="xs" style={{ overflowWrap: "anywhere" }}>
                  {path}
                </Text>
              ))}
            </Stack>
            <Checkbox
              label={t("同时删除下载文件")}
              description={t("移入系统废纸篓或回收站，已不存在的文件会跳过。")}
              checked={deleteFiles}
              disabled={deleting}
              onChange={(event) => setDeleteFiles(event.currentTarget.checked)}
            />
            <Text size="sm" c={deleteFiles ? "red" : "dimmed"}>
              {deleteFiles
                ? t(
                    "仅处理以上媒体文件，不删除目录，也不会自动清理字幕、封面、JSON 或保留的中间文件。",
                  )
                : t("仅删除历史记录，所有下载文件均会保留。")}
            </Text>
            {deletionError && (
              <Alert color="red" title={t("删除未完成")} role="alert">
                <Text size="sm">{deletionError}</Text>
                {deleteFiles && (
                  <Text size="sm">
                    {t("历史记录会保留以便重试；部分文件可能已移入废纸篓或回收站，可在其中恢复。")}
                  </Text>
                )}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" disabled={deleting} onClick={closeDeletion}>
                {t("取消")}
              </Button>
              <Button color="red" loading={deleting} onClick={() => void confirmDeletion()}>
                {deleteFiles ? t("移入废纸篓并删除记录") : t("仅删除记录")}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </main>
  );
}
