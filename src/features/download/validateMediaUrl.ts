import { t } from "../../i18n/translate.ts";
const MAX_MEDIA_URL_LENGTH = 4096;

export type MediaUrlValidation =
  | { valid: true; normalizedUrl: string }
  | {
      valid: false;
      reason: "empty" | "too-long" | "malformed" | "unsupported-protocol" | "credentials";
    };

export function validateMediaUrl(value: string): MediaUrlValidation {
  const candidate = value.trim();

  if (!candidate) {
    return { valid: false, reason: "empty" };
  }

  if (candidate.length > MAX_MEDIA_URL_LENGTH) {
    return { valid: false, reason: "too-long" };
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { valid: false, reason: "malformed" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, reason: "unsupported-protocol" };
  }

  if (parsed.username || parsed.password) {
    return { valid: false, reason: "credentials" };
  }

  return { valid: true, normalizedUrl: parsed.toString() };
}

export function getMediaUrlError(
  reason: Exclude<MediaUrlValidation, { valid: true }>["reason"],
): string {
  switch (reason) {
    case "empty":
      return t("请输入视频链接。");
    case "too-long":
      return t("链接过长，请检查后重试。");
    case "malformed":
      return t("链接格式不正确，请输入完整的网址（例如 https://example.com/video）。");
    case "unsupported-protocol":
      return t("仅支持以 http:// 或 https:// 开头的链接。");
    case "credentials":
      return t("链接中不能包含用户名或密码。");
  }
}
