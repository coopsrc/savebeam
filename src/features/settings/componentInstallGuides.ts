import { t } from "../../i18n/translate.ts";
import type { PlatformKind } from "../../app/platform/profiles";
import type { ComponentKind } from "../../types/domain";

export function installationPlatform(platform: PlatformKind) {
  const guides = {
    macos: {
      label: "macOS · Homebrew",
      note: t(
        "当前为 macOS，以下命令使用 Homebrew；请先安装 Homebrew，再在终端中执行。安装完成后点击“重新检测”。",
      ),
      ffmpegUrl: "https://ffmpeg.org/download.html#build-mac",
    },
    windows: {
      label: "Windows · WinGet",
      note: t(
        "当前为 Windows，以下命令使用 WinGet；请先确认 WinGet 可用，再在 PowerShell 或终端中执行。安装完成后点击“重新检测”。",
      ),
      ffmpegUrl: "https://ffmpeg.org/download.html#build-windows",
    },
    linux: {
      label: t("Linux · Ubuntu/Debian 示例"),
      note: t(
        "当前为 Linux，以下 apt-get 命令仅为 Ubuntu/Debian 示例；其他发行版请使用对应包管理器。仓库版本可能较旧，安装后请点击“重新检测”。",
      ),
      ffmpegUrl: "https://ffmpeg.org/download.html#build-linux",
    },
  };
  return guides[platform];
}

export function componentRecommendation(
  kind: ComponentKind,
  platform: PlatformKind,
): { command?: string; note?: string; url?: string } {
  if (platform === "macos") {
    if (kind === "yt_dlp") return { command: "brew install yt-dlp" };
    if (kind === "ffmpeg" || kind === "ffprobe")
      return { command: "brew install ffmpeg", note: t("ffprobe 随 FFmpeg 一同提供。") };
    return { command: "brew install deno" };
  }
  if (platform === "windows") {
    if (kind === "yt_dlp") return { command: "winget install --id yt-dlp.yt-dlp -e" };
    if (kind === "ffmpeg" || kind === "ffprobe")
      return {
        command: "winget install --id Gyan.FFmpeg -e",
        note: t("此 WinGet 包由 Gyan 提供；ffprobe 通常包含在该构建中。"),
      };
    return { command: "winget install --id DenoLand.Deno -e" };
  }
  if (kind === "yt_dlp") return { command: "sudo apt-get install yt-dlp" };
  if (kind === "ffmpeg" || kind === "ffprobe")
    return { command: "sudo apt-get install ffmpeg", note: t("ffprobe 随 FFmpeg 一同提供。") };
  return {
    note: t("Deno 没有官方 apt 源；请查看 Deno 官方安装说明或使用发行版推荐的包管理器。"),
    url: "https://docs.deno.com/runtime/getting_started/installation/",
  };
}
