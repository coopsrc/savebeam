import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Button, Checkbox, Group, Modal, Paper, Stack, Text } from "@mantine/core";
import { invokeCommand, IpcError } from "../../ipc/client";
import { useAppStore } from "../../stores/appStore";
import type { DownloadTask } from "../../types/domain";
import { formatBytes } from "../../utils/formatBytes";
import { compareVersionFiles, sourceLabels } from "./mediaVersions";
import type { MediaVersion, SourceCheck } from "./mediaVersions";

function message(error: unknown) {
  return error instanceof IpcError ? error.contextMessage : "版本操作失败，请重试。";
}

export function MediaVersionsButton({
  taskId,
  active = true,
}: {
  taskId: string;
  active?: boolean;
}) {
  const [opened, setOpened] = useState(false);
  return (
    <>
      <Button size="xs" variant="light" onClick={() => setOpened(true)}>
        来源与版本
      </Button>
      {opened && (
        <VersionsDialog taskId={taskId} active={active} onClose={() => setOpened(false)} />
      )}
    </>
  );
}

function VersionsDialog({
  taskId,
  active,
  onClose,
}: {
  taskId: string;
  active: boolean;
  onClose: () => void;
}) {
  const [versions, setVersions] = useState<MediaVersion[]>([]);
  const [check, setCheck] = useState<SourceCheck | null>(null);
  const [proxy, setProxy] = useState(false);
  const [busy, setBusy] = useState<string | null>("list");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const initialRead = useRef<{ taskId: string; promise: Promise<MediaVersion[]> } | null>(null);

  useEffect(() => {
    let disposed = false;
    // StrictMode replays effects in development. Share the read so a long legacy
    // hash is not duplicated (or rejected by the backend's single-operation gate).
    if (initialRead.current?.taskId !== taskId) {
      initialRead.current = {
        taskId,
        promise: invokeCommand<MediaVersion[]>("list_media_versions", { taskId }),
      };
    }
    void initialRead.current.promise
      .then((items) => {
        if (!disposed) setVersions(items);
      })
      .catch((reason: unknown) => {
        if (!disposed) setError(message(reason));
      })
      .finally(() => {
        if (!disposed) setBusy((current) => (current === "list" ? null : current));
      });
    return () => {
      disposed = true;
    };
  }, [taskId]);

  async function run(
    kind: "check" | "download" | "open" | "list",
    versionId?: string,
    outputIndex = 0,
  ) {
    if (busy) return;
    setBusy(kind);
    setError(null);
    setNotice(null);
    try {
      if (kind === "list") {
        setVersions(await invokeCommand<MediaVersion[]>("list_media_versions", { taskId }));
      } else if (kind === "check") {
        setCheck(null);
        setCheck(
          await invokeCommand<SourceCheck>("check_history_source", { taskId, useProxy: proxy }),
        );
      } else if (kind === "download") {
        const task = await invokeCommand<DownloadTask>("redownload_media_version", {
          taskId,
          useProxy: proxy,
        });
        useAppStore.getState().upsertDownloadTask(task);
        setCheck(null);
        setNotice("新版本已加入任务列表，不覆盖旧文件；完成后刷新版本列表可查看摘要。");
      } else {
        await invokeCommand("open_history_file", { taskId: versionId, outputIndex });
      }
    } catch (reason: unknown) {
      // Failed checks/downloads must never leave a stale authorization-looking result.
      if (kind !== "open") setCheck(null);
      setError(message(reason));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      opened={active}
      returnFocus={active}
      onClose={onClose}
      title="来源与历史版本"
      size="lg"
      centered
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          仅在点击检查时访问来源。元数据变化只能提示疑似换源，未变化也不保证内容相同。旧下载没有历史来源基线时无法判断。
        </Text>
        <Checkbox
          label="使用代理"
          description="仅用于本次检查和新版本下载；登录 Cookie 使用设置中已授权的配置。"
          checked={proxy}
          disabled={!!busy}
          onChange={(event) => {
            setProxy(event.currentTarget.checked);
            setCheck(null);
          }}
        />
        <Group>
          <Button
            variant="default"
            disabled={!!busy}
            loading={busy === "check"}
            onClick={() => void run("check")}
          >
            检查来源变化
          </Button>
          <Button
            disabled={!!busy || !check || check.comparison.status === "identity_changed"}
            loading={busy === "download"}
            onClick={() => void run("download")}
          >
            重新下载并保留旧版本
          </Button>
        </Group>
        {check && (
          <Alert
            color={
              check.comparison.status === "possible_change"
                ? "yellow"
                : check.comparison.status === "identity_changed"
                  ? "red"
                  : "blue"
            }
            title={sourceLabels[check.comparison.status]}
            role="status"
          >
            {check.comparison.reasons.map((reason) => (
              <Text size="sm" key={reason}>
                {reason}
              </Text>
            ))}
          </Alert>
        )}
        <Text size="xs" c="dimmed">
          新版本保存在原下载目录的 Savebeam Versions
          独立子目录，不移动或覆盖旧文件。沿用原任务的高级选项，按原画质策略重新匹配；旧任务无策略时使用自动推荐，不复用失效的格式
          ID。
        </Text>
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        {notice && (
          <Alert color="green" role="status">
            {notice}
          </Alert>
        )}
        <Group justify="space-between">
          <Text fw={600}>已保存版本（{versions.length}）</Text>
          <Button size="xs" variant="subtle" disabled={!!busy} onClick={() => void run("list")}>
            刷新版本
          </Button>
        </Group>
        {busy === "list" && (
          <Text size="sm">正在读取版本，旧文件首次计算摘要可能需要一些时间…</Text>
        )}
        <Stack gap="sm" mah={320} style={{ overflowY: "auto" }}>
          {versions.map((version) => (
            <Paper withBorder p="sm" key={version.taskId}>
              <Stack gap="xs">
                <Group gap="xs">
                  <Text fw={600}>版本 {version.versionNumber}</Text>
                  {version.taskId === taskId && <Badge size="xs">当前记录</Badge>}
                  <Text size="xs" c="dimmed">
                    {new Date(version.completedAtUnixMs).toLocaleString()}
                  </Text>
                </Group>
                <Text size="sm">{compareVersionFiles(version, versions)}</Text>
                <Text size="xs" c="dimmed">
                  {version.source
                    ? `媒体 ID：${version.source.mediaId}`
                    : "无历史来源基线；摘要仅代表首次记录时的本地文件。"}
                </Text>
                {version.files.map((file, index) => (
                  <Stack gap={4} key={`${index}-${file.path}`}>
                    <Text size="xs" style={{ overflowWrap: "anywhere" }}>
                      {file.path} ·{" "}
                      {file.sizeBytes === null ? "大小未知" : formatBytes(file.sizeBytes)}
                    </Text>
                    <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
                      SHA-256：{file.sha256 ?? "文件缺失、不可访问或无法安全计算"}
                    </Text>
                    <Button
                      size="xs"
                      variant="subtle"
                      disabled={!!busy}
                      onClick={() => void run("open", version.taskId, index)}
                    >
                      打开此版本
                    </Button>
                  </Stack>
                ))}
              </Stack>
            </Paper>
          ))}
        </Stack>
        <Text size="xs" c="dimmed">
          文件摘要不同也可能来自编码、封装或元数据差异，不证明 UP
          主更换了源视频。删除某条历史记录会一并删除其版本摘要，不影响其他版本。
        </Text>
      </Stack>
    </Modal>
  );
}
