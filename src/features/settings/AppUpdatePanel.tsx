import { useEffect, useState } from "react";
import { Alert, Button, Group, Modal, Paper, Progress, Stack, Text } from "@mantine/core";
import { invokeCommand } from "../../ipc/client";
import { listenToEvent } from "../../ipc/events";
import { t, useUiLocale } from "../../i18n/translate";
import { useAppStore } from "../../stores/appStore";
import { formatBytes } from "../../utils/formatBytes";
import { optionError } from "../download/useDownloadOptions";
interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
}
interface UpdateProgress {
  downloadedBytes: number;
  totalBytes: number | null;
  phase: string;
}
export function AppUpdatePanel({ active }: { active: boolean }) {
  useUiLocale();
  const [update, setUpdate] = useState<UpdateInfo | null>(null),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState<string | null>(null),
    [error, setError] = useState<string | null>(null),
    [confirm, setConfirm] = useState(false),
    [progress, setProgress] = useState<UpdateProgress | null>(null);
  const unfinished = useAppStore((s) =>
    s.downloadTasks.some((t) =>
      ["queued", "preparing", "downloading", "post_processing", "cancelling"].includes(t.status),
    ),
  );
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listenToEvent<UpdateProgress>("app://update-progress", (p) => {
      if (!disposed) setProgress(p);
    })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);
  async function check() {
    setBusy("checking");
    setError(null);
    setUpdate(null);
    setChecked(false);
    try {
      setUpdate(await invokeCommand<UpdateInfo | null>("check_app_update"));
      setChecked(true);
    } catch (e) {
      setError(optionError(e));
    } finally {
      setBusy(null);
    }
  }
  async function install() {
    if (!update) return;
    setConfirm(false);
    setBusy("installing");
    setError(null);
    setProgress(null);
    try {
      await invokeCommand("install_app_update", { version: update.version });
    } catch (e) {
      setError(optionError(e));
    } finally {
      setBusy(null);
    }
  }
  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <Text fw={650}>{t("应用更新")}</Text>
        <Text size="sm" c="dimmed">
          {t("手动检查主应用更新；下载包验签通过后才会安装。组件更新在运行组件中单独管理。")}
        </Text>
        <Group>
          <Button
            variant="light"
            loading={busy === "checking"}
            disabled={busy === "installing"}
            onClick={() => void check()}
          >
            {t("检查应用更新")}
          </Button>
          {update && (
            <Button disabled={!!busy || unfinished} onClick={() => setConfirm(true)}>
              {t("下载并安装 {0}", [update.version])}
            </Button>
          )}
          {busy === "installing" && progress?.phase !== "installing" && (
            <Button
              variant="subtle"
              onClick={() =>
                void invokeCommand("cancel_app_update").catch((e) => setError(optionError(e)))
              }
            >
              {t("取消更新下载")}
            </Button>
          )}
        </Group>
        {checked && !update && (
          <Text size="sm" role="status">
            {t("当前已是最新版本。")}
          </Text>
        )}
        {update && (
          <>
            <Text size="sm">
              {t("当前版本 {0}，可更新至 {1}", [update.currentVersion, update.version])}
            </Text>
            {update.notes && (
              <Text size="sm" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {update.notes}
              </Text>
            )}
          </>
        )}
        {unfinished && (
          <Text size="xs" c="dimmed">
            {t("请先完成或取消下载任务，再安装应用更新。")}
          </Text>
        )}
        {busy === "installing" && (
          <Stack gap={4}>
            <Progress
              value={
                progress?.totalBytes
                  ? Math.min(100, (progress.downloadedBytes / progress.totalBytes) * 100)
                  : 0
              }
              animated
            />
            <Text size="sm" role="status">
              {progress?.phase === "installing"
                ? t("正在安装，完成后应用将重新启动。")
                : `${formatBytes(progress?.downloadedBytes ?? 0)}${progress?.totalBytes ? ` / ${formatBytes(progress.totalBytes)}` : ""}`}
            </Text>
          </Stack>
        )}
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        <Modal
          opened={confirm && active}
          returnFocus={active}
          onClose={() => setConfirm(false)}
          title={t("安装应用更新")}
          centered
        >
          <Stack>
            <Text>{t("更新安装完成后将重新启动应用，本机设置与下载记录会保留。")}</Text>
            <Group justify="flex-end">
              <Button variant="default" onClick={() => setConfirm(false)}>
                {t("取消")}
              </Button>
              <Button onClick={() => void install()} disabled={unfinished}>
                {t("确认安装")}
              </Button>
            </Group>
          </Stack>
        </Modal>
      </Stack>
    </Paper>
  );
}
