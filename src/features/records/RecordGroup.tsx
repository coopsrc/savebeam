import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Badge, Button, Group } from "@mantine/core";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { t, useUiLocale } from "../../i18n/translate";
import type { DownloadGroup } from "../../types/domain";
import { useNavigate } from "react-router-dom";
import { RecordCard } from "./RecordCard";
import { DeleteGroupButton } from "./DeleteGroupButton";

export function RecordGroup({
  context,
  expanded,
  onToggle,
  summary,
  children,
  active = true,
  taskId,
  history = false,
  onDeleted,
}: {
  context: DownloadGroup;
  expanded: boolean;
  onToggle: () => void;
  summary: ReactNode;
  children: ReactNode;
  active?: boolean;
  taskId: string;
  history?: boolean;
  onDeleted?: (error?: string) => void;
}) {
  useUiLocale();
  const id = useId();
  const navigate = useNavigate();
  const [visited, setVisited] = useState(expanded);
  const viewport = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(0);
  useLayoutEffect(() => {
    if (active && expanded && viewport.current) viewport.current.scrollTop = scrollTop.current;
  }, [active, expanded]);
  return (
    <RecordCard
      label={t("分组：{0}", [context.title])}
      title={context.title}
      taskId={taskId}
      active={active}
      className="record-group"
      metadata={summary}
      badge={
        <Badge variant="light" size="sm">
          {context.kind === "multipart" ? t("多 P 视频") : t("系列合集")}
        </Badge>
      }
      actions={
        <>
          <Button
            size="xs"
            variant="light"
            onClick={() => navigate(`/download?url=${encodeURIComponent(context.sourceUrl)}`)}
          >
            {t("选择视频")}
          </Button>
          <DeleteGroupButton
            context={context}
            history={history}
            active={active}
            onDeleted={onDeleted}
          />
        </>
      }
    >
      <Group justify="flex-end">
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
    </RecordCard>
  );
}
