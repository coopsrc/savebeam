import { t, useUiLocale } from "../../i18n/translate.ts";
import { useId } from "react";
import { ActionIcon, Button, Checkbox, Text } from "@mantine/core";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import type {
  MediaInfo,
  PlaylistDetails,
  PlaylistMatch,
  PlaylistQuality,
} from "../../types/domain";
import { formatBytes } from "../../utils/formatBytes";
import { codecLabel } from "./formatSelection";
import {
  entryGroups,
  entryLabel,
  shortPartTitle,
  toggleGroupSelection,
  type DownloadEntry,
} from "./playlistParts";

type Props = {
  media: MediaInfo;
  multipart: boolean;
  entries: DownloadEntry[];
  details: Record<number, PlaylistDetails>;
  matches: PlaylistMatch[];
  selectedKeys: number[];
  overrides: Record<number, PlaylistQuality>;
  audioOnly: boolean;
  disabled: boolean;
  expanded: Record<number, boolean>;
  onExpand: (index: number) => void;
  onSelect: (keys: number[]) => void;
  onEdit: (index: number) => void;
};

function formatDuration(value: number | null | undefined) {
  return value && Number.isFinite(value) && value > 0
    ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}`
    : null;
}

function EntryRow({ entry, ...props }: Props & { entry: DownloadEntry }) {
  useUiLocale();

  const detail = props.details[entry.index];
  const matched = props.matches.find((row) => row.index === entry.index);
  const tracks = matched?.formatId
    ?.split("+")
    .map((id) => detail?.formats.find((f) => f.formatId === id));
  const video = tracks?.find((f) => f?.videoCodec && f.videoCodec !== "none");
  const audio = tracks?.find((f) => f?.audioCodec && f.audioCodec !== "none");
  const videoSpec = video
    ? ` · ${video.fps ? `${Number(video.fps.toFixed(3))} fps · ` : ""}${video.extension} · ${codecLabel(video.videoCodec)}`
    : "";
  const audioSpec = audio ? ` · ${audio.extension} · ${codecLabel(audio.audioCodec)}` : "";
  const bitrate = (value: number | null) =>
    value === null ? t("未知") : `${Math.round(value)} kbps`;
  const info =
    detail?.error ??
    matched?.error ??
    (matched?.formatId
      ? t("{0} · {1}音频 {2}{3} · {4}{5}", [
          props.audioOnly ? "MP3" : `${matched.resolution ?? t("分辨率未知")}${videoSpec}`,
          props.audioOnly ? "" : t("视频 {0} · ", [bitrate(matched.videoBitrateKbps)]),
          bitrate(matched.audioBitrateKbps),
          audioSpec,
          matched.bytes === null ? t("大小待定") : t("约 {0}", [formatBytes(matched.bytes)]),
          matched.fallbackUsed ? t(" · 已回退 Best（未满足指定条件）") : "",
        ])
      : detail
        ? t("正在匹配规格…")
        : t("等待读取标题与格式…"));
  const fullTitle = detail?.title ?? entry.title;
  const partIndex = entry.part?.partIndex ?? entry.index;
  const isPart = !!entry.part || props.multipart;
  const title = isPart
    ? shortPartTitle(fullTitle, entry.parentTitle ?? props.media.title, partIndex)
    : fullTitle;
  const label = entryLabel(entry, props.multipart);
  const duration = formatDuration(detail?.durationSeconds);
  return (
    <div className="download-playlist-row">
      <Checkbox
        aria-label={`${label} · ${fullTitle}`}
        label={
          <span title={fullTitle}>
            {isPart ? `P${partIndex}` : label} · {title}
          </span>
        }
        description={
          <>
            <span>
              {duration ? t("时长 {0} · ", [duration]) : ""}
              {t("视频 ID：")}
              {detail?.id ?? entry.id ?? t("待解析")}
            </span>
            <Text
              component="span"
              display="block"
              size="xs"
              c={
                detail?.error || matched?.error
                  ? "red"
                  : matched?.fallbackUsed
                    ? "orange"
                    : "dimmed"
              }
            >
              {t(info)}
              {props.overrides[entry.index] ||
              (entry.part && props.overrides[entry.part.parentIndex])
                ? t(" · 单独策略")
                : ""}
            </Text>
          </>
        }
        checked={props.selectedKeys.includes(entry.index)}
        disabled={!entry.available || props.disabled}
        onChange={(event) =>
          props.onSelect(
            toggleGroupSelection([entry], props.selectedKeys, event.currentTarget.checked),
          )
        }
      />
      <Button
        type="button"
        variant="subtle"
        size="compact-xs"
        aria-label={t("{0}单独设置", [label])}
        disabled={!entry.available || props.disabled}
        onClick={() => props.onEdit(entry.index)}
      >
        {t("单独设置")}
      </Button>
    </div>
  );
}

export function DownloadEntryList(props: Props) {
  useUiLocale();

  const listId = useId();
  return (
    <div
      className="download-playlist-list"
      role="group"
      aria-label={props.multipart ? t("可选分 P") : t("可选视频条目")}
      tabIndex={0}
    >
      {entryGroups(props.entries).map((group) => {
        const first = group.entries[0];
        if (group.parentIndex === null)
          return <EntryRow key={first.index} {...props} entry={first} />;
        const index = group.parentIndex;
        const available = group.entries.filter((e) => e.available);
        const chosen = available.filter((e) => props.selectedKeys.includes(e.index));
        const selected = props.matches.filter((m) => chosen.some((e) => e.index === m.index));
        const known = selected.filter((m) => m.formatId && m.bytes !== null);
        const total = known.reduce((sum, m) => sum + m.bytes!, 0);
        const size = props.audioOnly
          ? t("转换后大小待定")
          : !chosen.length
            ? t("未选择")
            : known.length === chosen.length && Number.isSafeInteger(total)
              ? t("约 {0}", [formatBytes(total)])
              : t("大小待确定");
        const errors = group.entries.filter(
          (e) =>
            props.details[e.index]?.error || props.matches.find((m) => m.index === e.index)?.error,
        ).length;
        const opened = !!props.expanded[index];
        const title = props.details[index]?.title ?? first.parentTitle ?? t("标题待补全");
        return (
          <div key={`parent-${index}`} className="download-part-group">
            <div className="download-playlist-row">
              <Checkbox
                label={t("第 {0} 项 · {1}", [index, title])}
                description={
                  <>
                    <span>
                      {t("视频 ID：")}
                      {first.part!.parentId} {t(" · 已选 ")}
                      {chosen.length}/{available.length} P · {size}
                      {first.part!.partCount > available.length
                        ? t("（共 {0} P，本次仅展示部分）", [first.part!.partCount])
                        : ""}
                    </span>
                    {errors > 0 && (
                      <Text component="span" display="block" size="xs" c="red">
                        {errors} {t(" 个分 P 未匹配或读取失败，展开查看。")}
                      </Text>
                    )}
                  </>
                }
                checked={available.length > 0 && chosen.length === available.length}
                indeterminate={chosen.length > 0 && chosen.length < available.length}
                disabled={!available.length || props.disabled}
                onChange={(event) =>
                  props.onSelect(
                    toggleGroupSelection(
                      group.entries,
                      props.selectedKeys,
                      event.currentTarget.checked,
                    ),
                  )
                }
              />
              <ActionIcon
                variant="subtle"
                aria-label={t("{0}第 {1} 项分 P", [opened ? t("收起") : t("展开"), index])}
                aria-expanded={opened}
                aria-controls={`${listId}-${index}`}
                onClick={() => props.onExpand(index)}
              >
                {opened ? <IconChevronUp size={18} /> : <IconChevronDown size={18} />}
              </ActionIcon>
            </div>
            {opened && (
              <div
                id={`${listId}-${index}`}
                role="group"
                aria-label={t("第 {0} 项分 P", [index])}
                className="download-part-children"
              >
                {group.entries.map((entry) => (
                  <EntryRow key={entry.index} {...props} entry={entry} />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {!props.entries.length && (
        <Text c="dimmed" size="sm">
          {t("未返回可选条目，请重新解析链接。")}
        </Text>
      )}
    </div>
  );
}
