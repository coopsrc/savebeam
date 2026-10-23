import type { PlaylistQuality } from "../../types/domain";
import { codecLabel } from "./formatSelection.ts";

export const DEFAULT_PLAYLIST_QUALITY: PlaylistQuality = {
  automaticRecommendations: true,
  resolutionHeight: null,
  frameRate: null,
  videoExtension: null,
  videoCodec: null,
  audioExtension: null,
  audioCodec: null,
  maxHeight: null,
  maxVideoBitrateKbps: null,
  maxAudioBitrateKbps: null,
  allowExceed: false,
};

/** This is the chosen policy, not a promise that every item offers the same tracks. */
export function summarizePlaylistQuality(value: PlaylistQuality, audioOnly: boolean) {
  const preference = (specified: string | null | undefined, recommended: string) =>
    specified?.toUpperCase() ?? (value.automaticRecommendations ? `推荐 ${recommended}` : "不限");
  const codec = (specified: string | null | undefined, recommended: string) =>
    specified ? codecLabel(specified) : preference(null, recommended);
  const video = audioOnly
    ? "不下载（仅音频）"
    : [
        value.resolutionHeight ? `${value.resolutionHeight}p` : "Best 分辨率",
        value.frameRate ? `${value.frameRate} FPS` : "Best FPS",
        preference(value.videoExtension, "MP4"),
        codec(value.videoCodec, "HEVC"),
        ...(value.maxHeight ? [`高度 ≤ ${value.maxHeight}p`] : []),
        ...(value.maxVideoBitrateKbps ? [`码率 ≤ ${value.maxVideoBitrateKbps} kbps`] : []),
      ].join(" · ");
  const audio = [
    preference(value.audioExtension, "M4A"),
    codec(value.audioCodec, "AAC"),
    value.maxAudioBitrateKbps ? `≤ ${value.maxAudioBitrateKbps} kbps` : "Best 码率",
    ...(audioOnly ? ["下载后转为 MP3"] : []),
  ].join(" · ");
  return { video, audio };
}
