import type { DownloadOptionDefaults, SubtitleTrack } from "../../types/domain";

export type SubtitleScope = "preferences" | "video" | "series";
export interface SubtitleChoice {
  language: string;
  label: string;
  manual: boolean;
  automatic: boolean;
  formats: string[];
  available: boolean;
}

const commonLanguages = [
  ["zh-Hans", "简体中文"],
  ["zh-Hant", "繁体中文"],
  ["zh", "中文"],
  ["zh-CN", "中文（中国大陆）"],
  ["zh-TW", "中文（台湾）"],
  ["zh-HK", "中文（香港）"],
  ["en", "英语"],
  ["en-US", "英语（美国）"],
  ["en-GB", "英语（英国）"],
  ["ja", "日语"],
  ["ko", "韩语"],
  ["fr", "法语"],
  ["de", "德语"],
  ["es", "西班牙语"],
  ["pt", "葡萄牙语"],
  ["ru", "俄语"],
  ["it", "意大利语"],
  ["ar", "阿拉伯语"],
] as const;
const validLanguage = (language: string) => /^[a-zA-Z0-9_.-]{1,64}$/.test(language);
const isChat = (language: string) => /^(live_chat|danmaku)$/i.test(language);

/** Never invent availability. Defaults and unread series use language preferences, not claims. */
export function subtitleChoices(
  tracks: SubtitleTrack[],
  selected: string[],
  scope: SubtitleScope,
): SubtitleChoice[] {
  const choices = new Map<string, SubtitleChoice>();
  const add = (language: string, name?: string | null) => {
    const common = commonLanguages.find(([code]) => code === language)?.[1];
    const choice = choices.get(language) ?? {
      language,
      label: `${name || common || language}${name || common ? `（${language}）` : ""}`,
      manual: false,
      automatic: false,
      formats: [],
      available: false,
    };
    choices.set(language, choice);
    return choice;
  };
  for (const track of tracks) {
    if (!validLanguage(track.language) || isChat(track.language)) continue;
    const choice = add(track.language, track.name);
    choice.available = true;
    choice.manual ||= !track.automatic;
    choice.automatic ||= track.automatic;
    if (track.extension && !choice.formats.includes(track.extension))
      choice.formats.push(track.extension);
  }
  if (scope !== "video") for (const [code, name] of commonLanguages) add(code, name);
  // A saved choice missing on this video remains visible until explicitly deselected.
  for (const language of selected) if (validLanguage(language)) add(language);
  return [...choices.values()];
}

export function updateSubtitleSelection(
  choices: SubtitleChoice[],
  previous: string[],
  proposed: string[],
  automatic: boolean,
): Pick<DownloadOptionDefaults, "subtitleLanguages" | "writeAutomaticSubtitles"> {
  const allowed = new Set(choices.map((choice) => choice.language));
  const languages = [
    ...new Set(proposed.filter((language) => validLanguage(language) && allowed.has(language))),
  ].slice(0, 10);
  const addedAutomatic = choices.some(
    (choice) =>
      languages.includes(choice.language) &&
      !previous.includes(choice.language) &&
      choice.automatic &&
      !choice.manual,
  );
  return {
    subtitleLanguages: languages,
    writeAutomaticSubtitles: languages.length > 0 && (automatic || addedAutomatic),
  };
}

export function subtitleChoiceDescription(choice: SubtitleChoice, scope: SubtitleScope): string {
  if (!choice.available)
    return scope === "video" ? "本视频未提供，将跳过" : "语言偏好 · 下载时按各视频匹配";
  const sources = [choice.manual ? "人工字幕" : "", choice.automatic ? "自动生成" : ""].filter(
    Boolean,
  );
  return `${scope === "series" ? "已读取条目可用 · " : ""}${sources.join(" / ")}${choice.formats.length ? ` · ${choice.formats.join(" / ").toUpperCase()}` : ""}`;
}
