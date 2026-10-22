import type { MediaFormat, PlaylistEntry, PlaylistSizeItem } from "../../types/domain";
import type { DownloadSelection } from "./formatSelection";

function knownFormatBytes(format: MediaFormat): number | null {
  for (const bytes of [format.fileSizeBytes, format.approximateFileSizeBytes]) {
    if (typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes > 0) return bytes;
  }
  return null;
}

export type PlaylistSizeCache = Record<string, number | null>;
export function sizeCacheKey(item: Pick<PlaylistEntry, "index" | "id">): string {
  return `${item.index}:${item.id ?? ""}`;
}

export function applyPlaylistSizes(
  cache: PlaylistSizeCache,
  requested: PlaylistEntry[],
  response: PlaylistSizeItem[],
): PlaylistSizeCache {
  const next = { ...cache };
  for (const item of requested) {
    const matches = response.filter((result) => result.index === item.index);
    const result = matches.length === 1 ? matches[0] : null;
    const bytes = result?.bytes;
    next[sizeCacheKey(item)] =
      result &&
      (!item.id || item.id === result.id) &&
      typeof bytes === "number" &&
      Number.isSafeInteger(bytes) &&
      bytes > 0
        ? bytes
        : null;
  }
  return next;
}

export function summarizePlaylistBytes(entries: PlaylistEntry[], cache: PlaylistSizeCache) {
  let total = 0;
  let knownCount = 0;
  for (const item of entries) {
    const bytes = cache[sizeCacheKey(item)];
    if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes <= 0) continue;
    total += bytes;
    knownCount++;
  }
  if (!Number.isSafeInteger(total))
    return { knownBytes: null, unknownCount: entries.length, knownCount: 0 };
  return {
    knownBytes: knownCount ? total : null,
    unknownCount: entries.length - knownCount,
    knownCount,
  };
}

/** Estimate final media payload; auxiliary files and container overhead are not included.
 * MP3 conversion and flat playlists have no reliable final size at this stage. */
export function estimateOutputBytes(
  selection: DownloadSelection,
  audioOnly: boolean,
): number | null {
  if (audioOnly || !selection.video) return null;
  const tracks = [selection.video];
  if (selection.audio && selection.audio.formatId !== selection.video.formatId)
    tracks.push(selection.audio);
  let total = 0;
  for (const track of tracks) {
    const size = knownFormatBytes(track);
    if (size === null) return null;
    total += size;
  }
  return total <= Number.MAX_SAFE_INTEGER ? total : null;
}
