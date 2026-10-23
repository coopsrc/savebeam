import { t, useUiLocale } from "../../i18n/translate.ts";
import { useState } from "react";
import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import type { PlaylistQuality } from "../../types/domain";
import { PlaylistQualityFields } from "./PlaylistQualityFields";

export function PlaylistQualityModal({
  index,
  label,
  value,
  audioOnly,
  onApply,
  onInherit,
  onClose,
  opened = true,
}: {
  index: number;
  label?: string;
  value: PlaylistQuality;
  audioOnly: boolean;
  onApply: (value: PlaylistQuality) => void;
  onInherit: () => void;
  onClose: () => void;
  opened?: boolean;
}) {
  useUiLocale();

  const [draft, setDraft] = useState({ ...value });
  return (
    <Modal
      opened={opened}
      returnFocus={opened}
      onClose={onClose}
      title={t("{0} · 单独画质设置", [label ?? t("第 {0} 项", [index])])}
      size="lg"
      centered
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          {t("仅覆盖这一项，其余条目仍使用统一策略。")}
        </Text>
        <PlaylistQualityFields value={draft} onChange={setDraft} audioOnly={audioOnly} />
        <Group justify="space-between">
          <Button
            variant="subtle"
            onClick={() => {
              onInherit();
              onClose();
            }}
          >
            {t("恢复统一策略")}
          </Button>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              {t("取消")}
            </Button>
            <Button
              onClick={() => {
                onApply(draft);
                onClose();
              }}
            >
              {t("应用")}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
