import { t } from "../../i18n/translate.ts";
import type { ComponentInstallation, ComponentKind } from "../../types/domain";

const KINDS: ComponentKind[] = ["yt_dlp", "ffmpeg", "ffprobe", "javascript_runtime"];

/** Keep the legacy Rust spelling at the wire boundary, not in UI labels/actions. */
export function normalizeComponentKinds<T extends { kind: string }>(items: T[]) {
  return items.map((item) => {
    const kind = item.kind === "java_script_runtime" ? "javascript_runtime" : item.kind;
    if (!KINDS.includes(kind as ComponentKind))
      throw new Error(t("收到无法识别的组件类型，请更新应用后重试。"));
    return { ...item, kind: kind as ComponentKind };
  });
}

export function localComponentSummary(items: ComponentInstallation[]) {
  const available = KINDS.filter(
    (kind) =>
      items.filter((item) => item.kind === kind).length === 1 &&
      items.find((item) => item.kind === kind)?.status === "available",
  ).length;
  return available === KINDS.length
    ? { ready: true, message: t("本机组件检测完成：4 项组件均可用。") }
    : {
        ready: false,
        message: t("本机组件检测完成：{0}/4 项可用，其余组件请查看下方状态。", [available]),
      };
}
