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
            title: part.title ?? "分 P 标题待补全",
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

export function entryLabel(entry: DownloadEntry) {
  return entry.part
    ? `第 ${entry.part.parentIndex} 项 · P${entry.part.partIndex}`
    : `第 ${entry.index} 项`;
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
