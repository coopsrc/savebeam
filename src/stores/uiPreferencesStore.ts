import { create } from "zustand";
import {
  DEFAULT_UI_PREFERENCES,
  parseUiPreferences,
  resolveUiLocale,
  UI_PREFERENCES_KEY,
  type UiPreferences,
  type UiLocale,
} from "../app/uiPreferences.ts";

const systemLanguages = () =>
  typeof window === "undefined" || typeof navigator === "undefined"
    ? ["zh-CN"]
    : navigator.languages.length
      ? navigator.languages
      : [navigator.language];
function initial() {
  try {
    return {
      preferences: parseUiPreferences(
        typeof window === "undefined" ? null : window.localStorage.getItem(UI_PREFERENCES_KEY),
      ),
      error: null,
    };
  } catch {
    return {
      preferences: { ...DEFAULT_UI_PREFERENCES },
      error: "无法读取界面偏好，当前使用系统默认。可重新选择以保存。",
    };
  }
}
const restored = initial();
export const useUiPreferences = create<{
  preferences: UiPreferences;
  locale: UiLocale;
  error: string | null;
  setPreferences: (value: UiPreferences) => void;
  syncSystemLanguage: () => void;
}>((set, get) => ({
  ...restored,
  locale: resolveUiLocale(restored.preferences.language, systemLanguages()),
  setPreferences(value) {
    try {
      const preferences = parseUiPreferences(JSON.stringify(value));
      window.localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(preferences));
      set({
        preferences,
        locale: resolveUiLocale(preferences.language, systemLanguages()),
        error: null,
      });
    } catch {
      set({ error: "无法保存界面偏好，设置未更改。请检查本机存储权限后重试。" });
    }
  },
  syncSystemLanguage() {
    set({ locale: resolveUiLocale(get().preferences.language, systemLanguages()) });
  },
}));
