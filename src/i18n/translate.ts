import { useUiPreferences } from "../stores/uiPreferencesStore.ts";
import { english } from "./english.ts";

/** Source strings are UI messages only. Never pass video titles, paths, URLs or raw logs here. */
export function t(source: string, parameters: readonly unknown[] = []): string {
  const message =
    useUiPreferences.getState().locale === "en-US" &&
    Object.prototype.hasOwnProperty.call(english, source)
      ? english[source]
      : source;
  return message.replace(/\{(\d+)\}/g, (token, index: string) =>
    Number(index) < parameters.length ? String(parameters[Number(index)]) : token,
  );
}

export function useUiLocale() {
  return useUiPreferences((state) => state.locale);
}
export function getUiLocale() {
  return useUiPreferences.getState().locale;
}
