import { t } from "../../i18n/translate.ts";
import type {
  MediaInfo,
  PlaylistDetails,
  PlaylistEntry,
  PlaylistQuality,
} from "../../types/domain";

export type DownloadEntry = PlaylistEntry & {
  part?: PlaylistDetails["part"];
  parentTitle?: string;
};

/** Stable keys are local UI identities, never sent to yt-dlp as playlist selectors. */
export function expandedEntries(
  media: MediaInfo | null,
  details: Record<number, PlaylistDetails>,
): DownloadEntry[] {
  return (media?.playlist?.entries ?? [])
    .flatMap((entry) => {
      const row = details[entry.index];
      return row?.parts?.length
        ? row.parts.map((part) => ({
            index: part.index,
            id: part.id,
            title: part.title ?? t("分 P 标题待补全"),
            available: entry.available,
            part: part.part,
            parentTitle: row.title ?? entry.title,
          }))
        : [entry];
    })
    .slice(0, 50);
}

export function selectedDownloadEntries(entries: DownloadEntry[], keys: number[]) {
  return entries.filter(
    (entry) =>
      entry.available &&
      (keys.includes(entry.index) || (!!entry.part && keys.includes(entry.part.parentIndex))),
  );
}

export function entryLabel(entry: DownloadEntry, multipart = false) {
  return entry.part
    ? t("第 {0} 项 · P{1}", [entry.part.parentIndex, entry.part.partIndex])
    : multipart
      ? `P${entry.index}`
      : t("第 {0} 项", [entry.index]);
}

export function mediaType(media: MediaInfo | null) {
  return media?.mediaType ?? (media?.playlist ? "collection" : "single");
}

/** Preview images are display-only, never echoed into matching or persisted tasks. */
export function taskDetails(value: PlaylistDetails): PlaylistDetails {
  return { ...value, preview: undefined };
}

export function shortPartTitle(title: string, parentTitle: string | undefined, index: number) {
  const suffix =
    parentTitle && title.startsWith(parentTitle) ? title.slice(parentTitle.length).trim() : title;
  return (
    suffix
      .replace(new RegExp(`^(?:p0*${index}\\b|第\\s*${index}\\s*[pP])\\s*[-·:：]?\\s*`, "i"), "")
      .trim() || title
  );
}

export function entryGroups(entries: DownloadEntry[]) {
  const groups: { parentIndex: number | null; entries: DownloadEntry[] }[] = [];
  const parents = new Map<number, (typeof groups)[number]>();
  for (const entry of entries) {
    if (!entry.part) {
      groups.push({ parentIndex: null, entries: [entry] });
      continue;
    }
    let group = parents.get(entry.part.parentIndex);
    if (!group) {
      group = { parentIndex: entry.part.parentIndex, entries: [] };
      parents.set(entry.part.parentIndex, group);
      groups.push(group);
    }
    group.entries.push(entry);
  }
  return groups;
}

export function toggleGroupSelection(
  entries: DownloadEntry[],
  selectedKeys: number[],
  checked: boolean,
) {
  const keys = new Set(entries.filter((e) => e.available).map((e) => e.index));
  const result = selectedKeys.filter((key) => !keys.has(key));
  return checked ? [...new Set([...result, ...keys])] : result;
}

export function expandedOverrides(
  entries: DownloadEntry[],
  overrides: Record<number, PlaylistQuality>,
) {
  return entries.flatMap((entry) => {
    const policy =
      overrides[entry.index] ?? (entry.part ? overrides[entry.part.parentIndex] : undefined);
    return policy ? [{ index: entry.index, policy }] : [];
  });
}
