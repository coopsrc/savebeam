import { t, useUiLocale } from "../../i18n/translate.ts";
import { useState } from "react";
import { Button, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { invokeCommand } from "../../ipc/client";
import { DownloadOptionFields } from "../download/DownloadOptionFields";
import { readDownloadOptions, validateDownloadOptions } from "../download/downloadOptionDefaults";
import { optionError, useDownloadOptions } from "../download/useDownloadOptions";

export function DownloadOptionsPanel() {
  useUiLocale();

  const {
    options,
    setOptions,
    loading,
    error: loadError,
    retry,
    restoreInitial,
  } = useDownloadOptions();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    const message = validateDownloadOptions(options);
    if (message) {
      setError(message);
      return;
    }
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      setOptions(
        readDownloadOptions(await invokeCommand("save_download_option_defaults", { options })),
      );
      setSaved(true);
    } catch (reason) {
      setError(optionError(reason));
    } finally {
      setSaving(false);
    }
  }
  return (
    <Paper component="section" aria-label={t("下载选项默认配置")} withBorder radius="md" p="md">
      <Stack gap="md">
        <div>
          <Title order={3}>{t("下载选项")}</Title>
          <Text size="sm" c="dimmed">
            {t(
              "新任务使用此默认配置，也可在“高级设置”中单独调整。保存不会修改已创建、排队或待重试任务。恢复初始值只修改草稿，需要保存后生效。",
            )}
          </Text>
        </div>
        <DownloadOptionFields
          showAudioOnly={false}
          value={options}
          onChange={(next) => {
            setOptions(next);
            setSaved(false);
            setError(null);
          }}
          disabled={loading || saving || !!loadError}
        />
        {(error || loadError) && (
          <Text c="red" size="sm" role="alert">
            {error || loadError}
          </Text>
        )}
        {saved && (
          <Text c="green" size="sm" role="status">
            {t("下载选项默认配置已保存。")}
          </Text>
        )}
        <Group justify="flex-end">
          {loadError && (
            <Button variant="default" onClick={retry}>
              {t("重新读取下载选项")}
            </Button>
          )}
          <Button
            variant="default"
            disabled={loading || saving}
            onClick={() => {
              restoreInitial();
              setSaved(false);
              setError(null);
            }}
          >
            {t("恢复初始值")}
          </Button>
          <Button loading={saving} disabled={loading || !!loadError} onClick={() => void save()}>
            {t("保存下载选项")}
          </Button>
        </Group>
      </Stack>
    </Paper>
  );
}
