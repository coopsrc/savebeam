import type { MediaFormat, MediaInfo, MergeContainer } from "../../types/domain";

export const AUTOMATIC_AUDIO = "savebeam:auto";

export interface DownloadSelection {
  formatId: string;
  mergeContainer: MergeContainer | null;
  extension: string | null;
  video: MediaFormat | null;
  audio: MediaFormat | null;
}

// yt-dlp supplies formats in ascending preference order. Keep that ranking
// within each stream type, without defaulting to the first (often audio) item.
export function videoFormats(formats: MediaFormat[]): MediaFormat[] {
  return formats.filter((format) => format.videoCodec && format.videoCodec !== "images").reverse();
}

export function audioFormats(formats: MediaFormat[], allowMuxed = false): MediaFormat[] {
  const audio = formats.filter((format) => format.audioCodec && !format.videoCodec).reverse();
  return audio.length || !allowMuxed
    ? audio
    : formats.filter((format) => format.audioCodec).reverse();
}

export function mergeContainer(video: MediaFormat, audio: MediaFormat): MergeContainer {
  const videoCodec = video.videoCodec ?? "";
  const audioCodec = audio.audioCodec ?? "";
  if (
    /^(avc|h264|hev|hvc|h265|av01|av1|mpeg4)/i.test(videoCodec) &&
    /^(mp4a|aac|alac|mp3|ac-?3|eac-?3)/i.test(audioCodec)
  )
    return "mp4";
  if (/^(vp0?8|vp0?9|av01|av1)/i.test(videoCodec) && /^(opus|vorbis)/i.test(audioCodec))
    return "webm";
  return "mkv";
}

function automaticAudio(video: MediaFormat, formats: MediaFormat[]): MediaFormat | null {
  const candidates = audioFormats(formats);
  return candidates.find((audio) => isRecommendedAudio(video, audio)) ?? candidates[0] ?? null;
}

export function isRecommendedAudio(video: MediaFormat, audio: MediaFormat): boolean {
  const preferred = video.extension === "webm" ? "webm" : video.extension === "mp4" ? "mp4" : null;
  return preferred !== null && mergeContainer(video, audio) === preferred;
}

export function selectDownload(
  media: MediaInfo,
  videoId: string | null,
  audioId: string,
  audioOnly: boolean,
): DownloadSelection | null {
  if (media.playlist)
    return {
      formatId: audioOnly ? "bestaudio/best" : "bestvideo+bestaudio/best",
      mergeContainer: null,
      extension: audioOnly ? "mp3" : null,
      video: null,
      audio: null,
    };

  if (audioOnly) {
    const candidates = audioFormats(media.formats, true);
    const audio =
      audioId === AUTOMATIC_AUDIO
        ? candidates[0]
        : candidates.find((item) => item.formatId === audioId);
    if (!audio) return null;
    return { formatId: audio.formatId, mergeContainer: null, extension: "mp3", video: null, audio };
  }

  const video = videoFormats(media.formats).find((item) => item.formatId === videoId);
  if (!video) return null;
  // A combined stream already contains audio. Adding another audio selector
  // would be silently ignored by yt-dlp's single-audio-stream selection rules.
  if (video.audioCodec)
    return {
      formatId: video.formatId,
      mergeContainer: null,
      extension: video.extension,
      video,
      audio: video,
    };

  const audio =
    audioId === AUTOMATIC_AUDIO
      ? automaticAudio(video, media.formats)
      : (audioFormats(media.formats).find((item) => item.formatId === audioId) ?? null);
  if (!audio && audioFormats(media.formats).length) return null;
  if (!audio)
    return {
      formatId: video.formatId,
      mergeContainer: null,
      extension: video.extension,
      video,
      audio: null,
    };
  const container = mergeContainer(video, audio);
  return {
    formatId: `${video.formatId}+${audio.formatId}`,
    mergeContainer: container,
    extension: container,
    video,
    audio,
  };
}

export function codecLabel(codec: string | null): string {
  if (!codec) return "未知编码";
  if (/^(avc|h264)/i.test(codec)) return "H.264";
  if (/^(hev|hvc|h265)/i.test(codec)) return "HEVC";
  if (/^(av01|av1)/i.test(codec)) return "AV1";
  if (/^vp0?9/i.test(codec)) return "VP9";
  if (/^vp0?8/i.test(codec)) return "VP8";
  if (/^(mp4a|aac)/i.test(codec)) return "AAC";
  return codec.toUpperCase();
}

export function formatLabel(format: MediaFormat, kind: "video" | "audio"): string {
  const details =
    kind === "video"
      ? [format.resolution, format.fps ? `${format.fps} fps` : null, codecLabel(format.videoCodec)]
      : [
          format.audioBitrateKbps ? `${Math.round(format.audioBitrateKbps)} kbps` : null,
          format.language,
          codecLabel(format.audioCodec),
        ];
  return [...details, format.extension, format.formatNote, `#${format.formatId}`]
    .filter(Boolean)
    .join(" · ");
}
