import type { MediaFormat } from "../../types/domain";
import type { DownloadSelection } from "./formatSelection";

function knownFormatBytes(format: MediaFormat): number | null {
  for (const bytes of [format.fileSizeBytes, format.approximateFileSizeBytes]) {
    if (typeof bytes === "number" && Number.isFinite(bytes) && bytes > 0) return bytes;
  }
  return null;
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
