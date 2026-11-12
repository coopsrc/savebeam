import { t } from "../../i18n/translate.ts";
import type { DownloadTask, TaskFormat } from "../../types/domain.ts";
import { codecLabel, type DownloadSelection } from "../download/formatSelection.ts";

/** Capture the resolved selection, not a preset or a site's numeric format ID. */
export function selectedFormatDetails(
  selection: DownloadSelection,
  audioOnly: boolean,
): TaskFormat | null {
  if (!selection.video && !selection.audio) return null;
  return {
    outputExtension: selection.extension,
    audioOnly,
    resolution:
      selection.video?.resolution ??
      (selection.video?.height ? `${selection.video.height}p` : null),
    fps: selection.video?.fps ?? null,
    videoCodec: selection.video?.videoCodec ?? null,
    videoBitrateKbps: selection.video?.videoBitrateKbps ?? null,
    audioCodec: selection.audio?.audioCodec ?? null,
    audioBitrateKbps: selection.audio?.audioBitrateKbps ?? null,
    audioExtension: selection.audio?.extension ?? null,
  };
}

export function taskFormatLines(task: Pick<DownloadTask, "formatDetails" | "formatId">): string[] {
  const f = task.formatDetails;
  if (!f) {
    if (task.formatId === "bestvideo+bestaudio/best") return [t("自动选择音视频，下载时确定")];
    if (task.formatId === "bestaudio/best") return [t("自动选择音频，下载时确定")];
    return [t("此旧任务未保存音视频参数")];
  }
  const number = (n: number | null, suffix: string, decimals = 0) =>
    n != null && Number.isFinite(n) && n > 0 ? `${Number(n.toFixed(decimals))} ${suffix}` : null;
  const video = !f.audioOnly
    ? [
        f.resolution?.replace(/(\d)x(?=\d)/gi, "$1×"),
        number(f.fps, "FPS", 3),
        f.videoCodec ? codecLabel(f.videoCodec) : null,
        number(f.videoBitrateKbps, "kbps"),
        f.outputExtension?.toUpperCase(),
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const audio = [
    f.audioCodec ? codecLabel(f.audioCodec) : null,
    number(f.audioBitrateKbps, "kbps"),
    f.audioExtension?.toUpperCase(),
  ]
    .filter(Boolean)
    .join(" · ");
  return [
    video ? t("视频：{0}", [video]) : null,
    f.audioOnly && f.outputExtension ? t("输出：{0}", [f.outputExtension.toUpperCase()]) : null,
    audio ? (f.audioOnly ? t("源音频：{0}", [audio]) : t("音频：{0}", [audio])) : null,
  ].filter((line): line is string => Boolean(line));
}
