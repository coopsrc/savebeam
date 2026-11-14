import { t, useUiLocale } from "../../i18n/translate.ts";
import { useState } from "react";
import { Button, Group, Modal, NumberInput, Stack, Text } from "@mantine/core";
import type { DownloadOptionDefaults, SubtitleTrack } from "../../types/domain";
import type { SubtitleScope } from "./subtitleSelection";
import { DownloadOptionFields } from "./DownloadOptionFields";
import { copyDownloadOptions, validateDownloadOptions } from "./downloadOptionDefaults";
import { loadDownloadOptions, optionError } from "./useDownloadOptions";

/** Mount on opening and unmount on close: cancel/Escape/backdrop never commits the draft. */
export function DownloadOptionsModal({
  value,
  onApply,
  onClose,
  audioOnlyRequired = false,
  subtitleTracks,
  subtitleScope,
  opened = true,
}: {
  value: DownloadOptionDefaults;
  onApply: (value: DownloadOptionDefaults) => void;
  onClose: () => void;
  audioOnlyRequired?: boolean;
  subtitleTracks?: SubtitleTrack[];
  subtitleScope?: SubtitleScope;
  opened?: boolean;
}) {
  useUiLocale();

  const [draft, setDraft] = useState(() => copyDownloadOptions(value));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function restoreDefaults() {
    setLoading(true);
    setError(null);
    try {
      const next = await loadDownloadOptions();
      setDraft({ ...next, audioOnly: audioOnlyRequired || next.audioOnly });
    } catch (reason) {
      setError(optionError(reason));
    } finally {
      setLoading(false);
    }
  }
  return (
    <Modal
      opened={opened}
      returnFocus={opened}
      onClose={onClose}
      title={t("高级设置")}
      size="lg"
      centered
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {t(
            "仅调整本次下载，不修改全局默认。创建任务后会保存此配置，排队、重启恢复及重试均保持不变。",
          )}
        </Text>
        <div className="download-advanced-fields">
          {subtitleScope !== "video" && (
            <NumberInput
              label={t("本任务视频并发数")}
              description={t("留空使用并发设置中的默认值；创建任务后随恢复与重试保留。")}
              value={draft.videoConcurrency ?? ""}
              min={1}
              max={4}
              allowDecimal={false}
              disabled={loading}
              onChange={(n) =>
                setDraft({ ...draft, videoConcurrency: typeof n === "number" ? n : null })
              }
            />
          )}
          <DownloadOptionFields
            value={draft}
            onChange={(next) => {
              setDraft(next);
              setError(null);
            }}
            disabled={loading}
            audioOnlyRequired={audioOnlyRequired}
            subtitleTracks={subtitleTracks}
            subtitleScope={subtitleScope}
          />
        </div>
        {error && (
          <Text c="red" size="sm" role="alert">
            {error}
          </Text>
        )}
        <Group justify="space-between">
          <Button variant="subtle" loading={loading} onClick={() => void restoreDefaults()}>
            {t("使用全局默认")}
          </Button>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              {t("取消")}
            </Button>
            <Button
              disabled={loading}
              onClick={() => {
                const message = validateDownloadOptions(draft);
                if (message) {
                  setError(message);
                  return;
                }
                onApply(copyDownloadOptions(draft));
                onClose();
              }}
            >
              {t("应用到本次下载")}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
