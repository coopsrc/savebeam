import { useState } from "react";
import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import type { PlaylistQuality } from "../../types/domain";
import { PlaylistQualityFields } from "./PlaylistQualityFields";

export function PlaylistQualityModal({
  index,
  value,
  audioOnly,
  onApply,
  onInherit,
  onClose,
}: {
  index: number;
  value: PlaylistQuality;
  audioOnly: boolean;
  onApply: (value: PlaylistQuality) => void;
  onInherit: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({ ...value });
  return (
    <Modal opened onClose={onClose} title={`第 ${index} 项 · 单独画质设置`} size="lg" centered>
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          仅覆盖这一项，其余条目仍使用统一策略。
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
            恢复统一策略
          </Button>
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              取消
            </Button>
            <Button
              onClick={() => {
                onApply(draft);
                onClose();
              }}
            >
              应用
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}
