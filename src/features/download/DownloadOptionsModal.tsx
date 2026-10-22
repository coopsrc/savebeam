import { useState } from "react";
import { Button, Group, Modal, Stack, Text } from "@mantine/core";
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
}: {
  value: DownloadOptionDefaults;
  onApply: (value: DownloadOptionDefaults) => void;
  onClose: () => void;
  audioOnlyRequired?: boolean;
  subtitleTracks?: SubtitleTrack[];
  subtitleScope?: SubtitleScope;
}) {
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
    <Modal opened onClose={onClose} title="高级设置" size="lg" centered>
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          仅调整本次下载，不修改全局默认。创建任务后会保存此配置，排队、重启恢复及重试均保持不变。
        </Text>
        <div className="download-advanced-fields">
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
            使用全局默认
          </Button>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              取消
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
              应用到本次下载
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
