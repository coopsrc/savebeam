export type UiTheme = "system" | "light" | "dark";
export type UiLanguage = "system" | "zh-CN" | "en-US";
export type UiLocale = Exclude<UiLanguage, "system">;
export type UiPreferences = { theme: UiTheme; language: UiLanguage };
export const UI_PREFERENCES_KEY = "savebeam.ui-preferences.v1";
export const DEFAULT_UI_PREFERENCES: UiPreferences = { theme: "system", language: "system" };

export function parseUiPreferences(raw: string | null): UiPreferences {
  if (raw === null) return { ...DEFAULT_UI_PREFERENCES };
  const data: unknown = JSON.parse(raw);
  if (
    !data ||
    typeof data !== "object" ||
    !("theme" in data) ||
    !("language" in data) ||
    typeof data.theme !== "string" ||
    !["system", "light", "dark"].includes(data.theme) ||
    typeof data.language !== "string" ||
    !["system", "zh-CN", "en-US"].includes(data.language)
  )
    throw new Error("Invalid UI preferences");
  return { theme: data.theme as UiTheme, language: data.language as UiLanguage };
}

export function resolveUiLocale(language: UiLanguage, languages: readonly string[]): UiLocale {
  if (language !== "system") return language;
  for (const value of languages) {
    if (/^zh(?:-|$)/i.test(value)) return "zh-CN";
    if (/^en(?:-|$)/i.test(value)) return "en-US";
  }
  return "en-US";
}
