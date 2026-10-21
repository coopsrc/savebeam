import type { MediaInfo, PlaylistInfo } from "../../types/domain";

// Display-only approximation of yt-dlp's Windows-compatible filename cleaning.
// Never used as a filesystem path; yt-dlp remains authoritative at download time.
export function previewComponent(value: string): string {
  const timestampSafe = value.replace(/\d+(?::\d+)+/g, (match) => match.replace(/:/g, "_"));
  const clean = Array.from(timestampSafe, (character) => {
    if (character === "\n") return " ";
    const code = character.codePointAt(0)!;
    if (code < 32 || code === 127) return "";
    if (character === "/") return "⧸";
    if (character === "\\") return "⧹";
    return '"*:<>?|'.includes(character) ? String.fromCodePoint(code + 0xfee0) : character;
  }).join("");
  return !clean || clean === "." || clean === ".." ? "_" : clean;
}

export function selectedEntries(playlist: PlaylistInfo, indices: number[]) {
  const selected = new Set(indices);
  return (playlist.entries ?? [])
    .filter((entry) => entry.available && selected.has(entry.index))
    .sort((left, right) => left.index - right.index);
}

function stem(title: string, id: string | null) {
  return `${previewComponent(title)}${id ? ` [${previewComponent(id)}]` : ""}`;
}

export function outputPreview(media: MediaInfo, extension: string | null, indices: number[]) {
  const suffix = extension ?? "{扩展名}";
  if (!media.playlist)
    return { directory: null, files: [stem(media.title, media.id) + "." + suffix] };
  return {
    directory: stem(media.playlist.title || media.title, media.playlist.id ?? null),
    files: selectedEntries(media.playlist, indices).map(
      (entry) => `${entry.index}-${stem(entry.title, entry.id)}.${suffix}`,
    ),
  };
}
