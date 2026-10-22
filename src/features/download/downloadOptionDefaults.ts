import type { DownloadOptionDefaults } from "../../types/domain";

export const INITIAL_DOWNLOAD_OPTIONS: DownloadOptionDefaults = {
  audioOnly: false,
  subtitleLanguages: [],
  writeAutomaticSubtitles: false,
  writeThumbnail: false,
  writeInfoJson: false,
  embedMetadata: false,
  keepIntermediateFiles: false,
};

export function copyDownloadOptions(value: DownloadOptionDefaults): DownloadOptionDefaults {
  return { ...value, subtitleLanguages: [...value.subtitleLanguages] };
}

export function validateDownloadOptions(value: DownloadOptionDefaults): string | null {
  if (
    value.subtitleLanguages.length > 10 ||
    value.subtitleLanguages.some((language) => !/^[a-zA-Z0-9_.-]{1,64}$/.test(language))
  )
    return "字幕语言最多 10 项，只能包含字母、数字、点、下划线或连字符。";
  if (value.writeAutomaticSubtitles && !value.subtitleLanguages.length)
    return "选择自动字幕前，请先指定至少一种字幕语言。";
  return null;
}

export function readDownloadOptions(value: unknown): DownloadOptionDefaults {
  if (!value || typeof value !== "object") throw new Error("下载选项数据无效，请重新读取。");
  const record = value as Record<string, unknown>;
  const keys = [
    "audioOnly",
    "writeAutomaticSubtitles",
    "writeThumbnail",
    "writeInfoJson",
    "embedMetadata",
    "keepIntermediateFiles",
  ];
  if (
    keys.some((key) => typeof record[key] !== "boolean") ||
    !Array.isArray(record.subtitleLanguages) ||
    record.subtitleLanguages.some((item) => typeof item !== "string")
  )
    throw new Error("下载选项数据无效，请重新读取。");
  const options = copyDownloadOptions(value as DownloadOptionDefaults);
  const error = validateDownloadOptions(options);
  if (error) throw new Error(error);
  return options;
}
