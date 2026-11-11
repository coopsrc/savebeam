import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Button, Group, Paper, Stack, Text } from "@mantine/core";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { t, useUiLocale } from "../../i18n/translate";
import type { DownloadGroup } from "../../types/domain";

export function RecordGroup({
  context,
  expanded,
  onToggle,
  summary,
  children,
  active = true,
}: {
  context: DownloadGroup;
  expanded: boolean;
  onToggle: () => void;
  summary: ReactNode;
  children: ReactNode;
  active?: boolean;
}) {
  useUiLocale();
  const id = useId();
  const [visited, setVisited] = useState(expanded);
  const viewport = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);
  useLayoutEffect(() => {
    if (active && expanded && viewport.current) viewport.current.scrollTop = scrollTop.current;
  }, [active, expanded]);
  return (
    <Paper
      component="section"
      aria-label={t("分组：{0}", [context.title])}
      withBorder
      radius="md"
      p="md"
      className="record-group"
    >
      <Stack gap="sm">
        <Group justify="space-between" align="start" wrap="nowrap">
          <Stack gap={4} style={{ minWidth: 0, flex: 1 }}>
            <Text fw={650} style={{ overflowWrap: "anywhere" }}>
              {context.title}
            </Text>
            <Badge variant="light" size="sm">
              {context.kind === "multipart" ? t("多 P 视频") : t("系列合集")}
            </Badge>
          </Stack>
          <Button
            type="button"
            size="compact-sm"
            variant="subtle"
            aria-label={
              expanded ? t("收起分组：{0}", [context.title]) : t("展开分组：{0}", [context.title])
            }
            aria-expanded={expanded}
            aria-controls={id}
            rightSection={expanded ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
            onClick={() => {
              setVisited(true);
              onToggle();
            }}
          >
            {expanded ? t("收起") : t("展开")}
          </Button>
        </Group>
        {summary}
        <div
          ref={viewport}
          id={id}
          hidden={!expanded}
          inert={!expanded || !active}
          className="download-playlist-list record-group-list"
          onScroll={(event) => {
            if (active && expanded && event.currentTarget.getClientRects().length)
              scrollTop.current = event.currentTarget.scrollTop;
          }}
        >
          {(visited || expanded) && children}
        </div>
      </Stack>
    </Paper>
  );
}
