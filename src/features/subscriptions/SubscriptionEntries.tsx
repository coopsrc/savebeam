import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Checkbox, Group, ScrollArea, Stack, Text } from "@mantine/core";
import { subscriptionApi } from "./subscriptionApi";
import type { SubscriptionEntry, SubscriptionEntryMetadata } from "./subscriptionApi";
import { entryDuration, missingTitle } from "./entryMetadata";
import { isPending } from "./selection";

// One bounded request across expanded lists. Queued reads check their lifetime
// before invoking IPC, so hidden/collapsed lists do not start more site requests.
let metadataLane: Promise<unknown> = Promise.resolve();
function serialRead(read: () => Promise<SubscriptionEntryMetadata[]>) {
  const request = metadataLane.catch(() => {}).then(read);
  metadataLane = request;
  return request;
}

interface Props {
  id: number;
  title: string;
  active: boolean;
  checkedAt: number;
  entries: SubscriptionEntry[];
  chosen: string[];
  disabled: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onMetadata: (rows: SubscriptionEntryMetadata[]) => void;
}

export function SubscriptionEntries({
  id,
  title,
  active,
  checkedAt,
  entries,
  chosen,
  disabled,
  onSelect,
  onMetadata,
}: Props) {
  const latest = useRef({ entries, onMetadata });
  useLayoutEffect(() => {
    latest.current = { entries, onMetadata };
  }, [entries, onMetadata]);
  const attempted = useRef(new Set<string>());
  const pending = useRef<Promise<unknown> | null>(null);
  const stop = useRef(false);
  useLayoutEffect(() => {
    if (!active) stop.current = true;
  }, [active]);
  const budget = useRef(50);
  const retryNeeded = useRef(false);
  useLayoutEffect(() => {
    budget.current = 50;
    retryNeeded.current = false;
    attempted.current.clear();
  }, [checkedAt]);
  const [revision, setRevision] = useState(0);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState("");
  const [failures, setFailures] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    async function read() {
      await Promise.resolve(); // StrictMode replay must not duplicate site requests.
      if (!active || cancelled || retryNeeded.current) return;
      await pending.current?.catch(() => {});
      if (cancelled || retryNeeded.current) return;
      stop.current = false;
      const targets = latest.current.entries
        .filter(
          (entry) =>
            entry.available &&
            !attempted.current.has(`${entry.index}:${entry.id}`) &&
            (missingTitle(entry.title) || (revision > 0 && entry.durationSeconds == null)),
        )
        .sort((a, b) => Number(missingTitle(b.title)) - Number(missingTitle(a.title)))
        .slice(0, budget.current);
      if (!targets.length) return;
      setReading(true);
      let done = 0;
      try {
        for (let offset = 0; offset < targets.length; offset += 5) {
          if (cancelled || stop.current) break;
          const chunk = targets.slice(offset, offset + 5);
          setProgress(`正在补全视频信息 ${done}/${targets.length}（不下载媒体）`);
          const request = serialRead(async () => {
            if (cancelled || stop.current) return [];
            const current = chunk.filter((entry) =>
              latest.current.entries.some(
                (value) =>
                  value.id === entry.id &&
                  value.index === entry.index &&
                  value.available &&
                  (missingTitle(value.title) || (revision > 0 && value.durationSeconds == null)),
              ),
            );
            current.forEach((entry) => attempted.current.add(`${entry.index}:${entry.id}`));
            if (!current.length) return [];
            budget.current -= current.length;
            return subscriptionApi.details(
              id,
              current.map((entry) => entry.id),
            );
          });
          pending.current = request;
          const rows = await request;
          if (rows.some((row) => row.error)) retryNeeded.current = true;
          // A completed bounded request can persist/show its result while hidden;
          // only later requests are stopped. Parent verifies ID and position again.
          latest.current.onMetadata(rows);
          setFailures((previous) => ({
            ...previous,
            ...Object.fromEntries(
              rows.filter((row) => row.error).map((row) => [row.id, row.error!]),
            ),
          }));
          done += rows.length;
        }
        setProgress(`已读取 ${done}/${targets.length} 项视频信息；缺失或失败项可重试。`);
      } catch (error: unknown) {
        retryNeeded.current = true;
        setProgress(error instanceof Error ? error.message : "读取视频信息失败，可稍后重试。");
      } finally {
        setReading(false);
      }
    }
    void read();
    return () => {
      cancelled = true;
    };
  }, [active, id, revision, checkedAt]);

  const remaining = entries.filter(
    (entry) => entry.available && (missingTitle(entry.title) || entry.durationSeconds == null),
  ).length;
  return (
    <Stack gap="xs">
      <Group justify="space-between" gap="xs">
        <Text size="xs" c="dimmed" role="status">
          {progress ||
            (remaining
              ? "展开时分批补全缺失标题；标题和时长保存在本机。"
              : "视频信息已保存到本机。")}
        </Text>
        {reading ? (
          <Button
            size="xs"
            variant="subtle"
            onClick={() => {
              stop.current = true;
              setProgress("当前批次完成后停止后续读取。");
            }}
          >
            停止读取信息
          </Button>
        ) : (
          remaining > 0 && (
            <Button
              size="xs"
              variant="subtle"
              onClick={() => {
                if (
                  retryNeeded.current ||
                  !entries.some(
                    (entry) =>
                      entry.available &&
                      !attempted.current.has(`${entry.index}:${entry.id}`) &&
                      (missingTitle(entry.title) || entry.durationSeconds == null),
                  )
                )
                  attempted.current.clear();
                retryNeeded.current = false;
                budget.current = 50;
                setFailures({});
                setRevision((value) => value + 1);
              }}
            >
              继续 / 重试读取信息
            </Button>
          )
        )}
      </Group>
      <ScrollArea.Autosize
        mah={320}
        type="always"
        scrollbars="y"
        offsetScrollbars="y"
        className="subscription-entry-scroll"
        viewportProps={{ tabIndex: 0, role: "region", "aria-label": `${title}条目` }}
      >
        <Stack gap="sm" className="subscription-entry-content">
          {entries.map((entry) => {
            const duration = entryDuration(entry.durationSeconds);
            return (
              <Checkbox
                key={entry.id}
                checked={chosen.includes(entry.id)}
                disabled={
                  disabled ||
                  !isPending(entry) ||
                  (!chosen.includes(entry.id) && chosen.length >= 50)
                }
                label={`第 ${entry.index} 项 · ${missingTitle(entry.title) ? "标题待补全" : entry.title}${entry.isNew && !entry.downloaded ? " · 新增" : ""}`}
                description={
                  <>
                    {duration ? `时长 ${duration} · ` : ""}ID：{entry.id} ·{" "}
                    {entry.downloaded
                      ? "已下载"
                      : !entry.available
                        ? "不可用 / 已移出列表"
                        : !isPending(entry)
                          ? "已加入下载任务"
                          : entry.taskStatus === "failed" || entry.taskStatus === "cancelled"
                            ? "上次未完成，可重新下载"
                            : "待下载"}
                    {failures[entry.id] && (
                      <Text component="span" display="block" size="xs" c="orange">
                        {failures[entry.id]}
                      </Text>
                    )}
                  </>
                }
                onChange={(event) => onSelect(entry.id, event.currentTarget.checked)}
              />
            );
          })}
          {!entries.length && (
            <Text size="sm" c="dimmed">
              当前已知条目均已下载，或站点未返回可识别的视频 ID。
            </Text>
          )}
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  );
}
