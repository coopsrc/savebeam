import { t, useUiLocale } from "../../i18n/translate.ts";
import { useEffect, useState } from "react";
import { Alert, Button, Group, Select, Stack, Text } from "@mantine/core";
import { IconExternalLink, IconFolderOpen, IconHistory, IconRefresh } from "@tabler/icons-react";
import { useNavigate } from "react-router-dom";
import { invokeCommand, IpcError } from "../../ipc/client";
import type { DownloadHistoryRecord, DownloadTask } from "../../types/domain";
import { formatBytes } from "../../utils/formatBytes";
import { MediaVersionsButton } from "../history/MediaVersionsButton";

function actionError(reason: unknown): string {
  // Only Rust-authored user messages, never diagnostic/stderr, are displayed.
  return reason instanceof IpcError
    ? reason.contextMessage
    : reason instanceof Error
      ? reason.message
      : t("操作失败，请重试。");
}

export function CompletedTaskActions({ task }: { task: DownloadTask }) {
  useUiLocale();

  const navigate = useNavigate();
  const [record, setRecord] = useState<DownloadHistoryRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"file" | "folder" | null>(null);
  const [outputIndex, setOutputIndex] = useState("0");

  useEffect(() => {
    let disposed = false;
    void invokeCommand<DownloadHistoryRecord | null>("get_download_history_record", {
      taskId: task.id,
    })
      .then((result) => {
        if (!disposed) setRecord(result);
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(actionError(reason));
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [task.id]);

  const paths = record?.outputPaths ?? [];
  const index = Number(outputIndex);
  const selectedPath = paths[index];

  async function open(kind: "file" | "folder") {
    if (busy || loading || !selectedPath) return;
    setBusy(kind);
    setError(null);
    try {
      // The backend looks up the stored path; the UI sends no arbitrary local path.
      await invokeCommand(kind === "file" ? "open_history_file" : "open_history_folder", {
        taskId: task.id,
        outputIndex: index,
      });
    } catch (reason: unknown) {
      setError(actionError(reason));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Stack gap="sm">
      {error && (
        <Alert color="red" title={t("任务操作失败")} role="alert">
          {error}
        </Alert>
      )}
      {paths.length > 1 && (
        <Select
          label={t("下载文件")}
          description={t("该任务生成 {0} 个文件，选择后打开。", [paths.length])}
          data={paths.map((path, index) => ({
            value: String(index),
            label: `${index + 1}. ${path.split(/[\\/]/).pop() ?? path}`,
          }))}
          value={outputIndex}
          onChange={(value) => setOutputIndex(value ?? "0")}
          allowDeselect={false}
          disabled={!!busy}
        />
      )}
      {selectedPath && (
        <Text size="xs" c="dimmed" title={selectedPath} style={{ overflowWrap: "anywhere" }}>
          {t("已保存：")}
          {selectedPath}
          {record ? t(" · 共 {0}", [formatBytes(record.totalBytes)]) : ""}
        </Text>
      )}
      {!loading && !record && !error && (
        <Text size="xs" c="dimmed">
          {t("下载历史已删除或未能保存，无法从任务定位文件；仍可重新解析来源链接。")}
        </Text>
      )}
      <Group justify="flex-end" gap="xs">
        {record && <MediaVersionsButton taskId={task.id} />}
        <Button
          size="xs"
          variant="light"
          leftSection={<IconExternalLink size={14} />}
          disabled={loading || !!busy || !selectedPath}
          loading={busy === "file"}
          onClick={() => void open("file")}
        >
          {t("打开文件")}
        </Button>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconFolderOpen size={14} />}
          disabled={loading || !!busy || !selectedPath}
          loading={busy === "folder"}
          onClick={() => void open("folder")}
        >
          {t("打开所在文件夹")}
        </Button>
        <Button
          size="xs"
          variant="subtle"
          leftSection={<IconHistory size={14} />}
          disabled={!!busy}
          onClick={() => navigate("/history")}
        >
          {t("查看历史")}
        </Button>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconRefresh size={14} />}
          disabled={!!busy}
          onClick={() => navigate(`/download?url=${encodeURIComponent(task.url)}`)}
        >
          {t("重新解析")}
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        {t("重新解析只回填原链接；需要保留旧文件并保存新版本时，请使用“来源与版本”。")}
      </Text>
    </Stack>
  );
}
