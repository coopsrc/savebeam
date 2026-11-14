import { useEffect, useState } from "react";
import { Button, Group, NumberInput, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import { invokeCommand } from "../../ipc/client";
import { t, useUiLocale } from "../../i18n/translate";
import type { ConcurrencyPreferences } from "../../ipc/concurrency";
export function ConcurrencyPanel() {
  useUiLocale();
  const [value, setValue] = useState<ConcurrencyPreferences | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    void invokeCommand<ConcurrencyPreferences>("get_concurrency_preferences")
      .then(setValue)
      .catch((e) => setError(String(e)));
  }, []);
  const fields = [
    ["metadataTotal", t("信息读取总并发数"), 8],
    ["metadataPerList", t("每个列表信息读取并发数"), 4],
    ["downloadTasks", t("同时下载任务数"), 4],
    ["videosPerTask", t("每个列表同时下载视频数"), 4],
  ] as const;
  return (
    <Paper withBorder radius="md" p="md">
      <Stack gap="sm">
        <Text fw={650}>{t("并发与队列")}</Text>
        <Text size="sm" c="dimmed">
          {t("完成一项立即补位；信息读取与下载分别调度。每个合集或多 P 算一个下载任务。")}
        </Text>
        {value && (
          <>
            <SimpleGrid cols={2}>
              {fields.map(([key, label, max]) => (
                <NumberInput
                  key={key}
                  label={label}
                  min={1}
                  max={max}
                  allowDecimal={false}
                  disabled={busy}
                  value={value[key]}
                  onChange={(n) => {
                    if (typeof n === "number") {
                      setValue({ ...value, [key]: n });
                      setSaved(false);
                    }
                  }}
                />
              ))}
            </SimpleGrid>
            <Text size="xs" c="dimmed">
              {t(
                "最多同时处理 {0} 个下载视频。降低上限不终止已开始的工作；列表视频默认值只影响新任务。",
                [value.downloadTasks * value.videosPerTask],
              )}
            </Text>
            <Group justify="flex-end">
              <Button
                loading={busy}
                onClick={() => {
                  setBusy(true);
                  setError("");
                  setSaved(false);
                  void invokeCommand<ConcurrencyPreferences>("save_concurrency_preferences", {
                    preferences: value,
                  })
                    .then((v) => {
                      setValue(v);
                      setSaved(true);
                    })
                    .catch((e) => setError(String(e)))
                    .finally(() => setBusy(false));
                }}
              >
                {t("保存并发设置")}
              </Button>
            </Group>
          </>
        )}
        {error && (
          <Text c="red" role="alert">
            {error}
          </Text>
        )}
        {saved && (
          <Text c="green" role="status">
            {t("设置已保存。")}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
