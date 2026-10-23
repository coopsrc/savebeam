import { t, useUiLocale } from "../../i18n/translate.ts";
import { useId, useState } from "react";
import { Button, Collapse, Group, Paper, Stack, Text, Title } from "@mantine/core";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import type { PlaylistQuality } from "../../types/domain";
import { PlaylistQualityFields } from "./PlaylistQualityFields";
import { summarizePlaylistQuality } from "./playlistQuality";

export function PlaylistQualityPanel({
  multipart,
  value,
  audioOnly,
  disabled,
  overrideCount,
  onChange,
}: {
  multipart: boolean;
  value: PlaylistQuality;
  audioOnly: boolean;
  disabled: boolean;
  overrideCount: number;
  onChange: (value: PlaylistQuality) => void;
}) {
  useUiLocale();

  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const summary = summarizePlaylistQuality(value, audioOnly);
  const title = multipart ? t("共用画质") : t("系列画质策略");
  return (
    <Paper
      component="section"
      aria-label={title}
      className="download-quality-panel"
      withBorder
      radius="md"
      p="md"
    >
      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={3}>{title}</Title>
          <Button
            type="button"
            variant="subtle"
            size="compact-sm"
            aria-expanded={expanded}
            aria-controls={id}
            rightSection={expanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? t("收起画质设置") : t("展开画质设置")}
          </Button>
        </Group>
        {!expanded && (
          <Stack gap={4} role="group" aria-label={t("当前画质参数")}>
            <Text size="sm">
              {t("视频：")}
              {summary.video}
            </Text>
            <Text size="sm">
              {t("音频：")}
              {summary.audio}
            </Text>
            <Text size="xs" c="dimmed">
              {value.allowExceed ? t("无匹配允许回退 Best") : t("严格匹配，无匹配跳过")}
            </Text>
          </Stack>
        )}
        <Collapse expanded={expanded} keepMountedMode="display-none" id={id}>
          <Stack gap="sm">
            <Text size="sm" c="dimmed">
              {t("分辨率和 FPS 可选 Best；格式与编码自动推荐，也可手动指定。")}
              {multipart
                ? t("各 P 按自身可用格式匹配，也可单独设置。")
                : t("少数例外可点右侧“单独设置”。")}
            </Text>
            <PlaylistQualityFields
              value={value}
              audioOnly={audioOnly}
              disabled={disabled}
              onChange={onChange}
            />
          </Stack>
        </Collapse>
        {overrideCount > 0 && (
          <Text size="xs" c="dimmed">
            {t("已单独设置 ")}
            {overrideCount} {t(" 项；其余跟随统一策略。")}
          </Text>
        )}
      </Stack>
    </Paper>
  );
}
