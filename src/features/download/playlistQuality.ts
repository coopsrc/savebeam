import { t } from "../../i18n/translate.ts";
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
    specified?.toUpperCase() ??
    (value.automaticRecommendations ? t("推荐 {0}", [recommended]) : t("不限"));
  const codec = (specified: string | null | undefined, recommended: string) =>
    specified ? codecLabel(specified) : preference(null, recommended);
  const video = audioOnly
    ? t("不下载（仅音频）")
    : [
        value.resolutionHeight ? `${value.resolutionHeight}p` : t("Best 分辨率"),
        value.frameRate ? `${value.frameRate} FPS` : "Best FPS",
        preference(value.videoExtension, "MP4"),
        codec(value.videoCodec, "HEVC"),
        ...(value.maxHeight ? [t("高度 ≤ {0}p", [value.maxHeight])] : []),
        ...(value.maxVideoBitrateKbps ? [t("码率 ≤ {0} kbps", [value.maxVideoBitrateKbps])] : []),
      ].join(" · ");
  const audio = [
    preference(value.audioExtension, "M4A"),
    codec(value.audioCodec, "AAC"),
    value.maxAudioBitrateKbps ? `≤ ${value.maxAudioBitrateKbps} kbps` : t("Best 码率"),
    ...(audioOnly ? [t("下载后转为 MP3")] : []),
  ].join(" · ");
  return { video, audio };
}
