export interface VersionFile {
  path: string;
  sizeBytes: number | null;
  sha256: string | null;
}

export interface MediaVersion {
  taskId: string;
  rootTaskId: string;
  parentTaskId: string | null;
  versionNumber: number;
  completedAtUnixMs: number;
  source: { mediaId: string } | null;
  files: VersionFile[];
}

export interface SourceCheck {
  comparison: {
    status: "unknown" | "possible_change" | "no_obvious_change" | "identity_changed";
    reasons: string[];
  };
  current: { mediaId: string };
  title: string;
}

export const sourceLabels = {
  unknown: "无法判断是否换源",
  possible_change: "疑似来源发生变化",
  no_obvious_change: "未发现明显元数据变化",
  identity_changed: "媒体标识已改变，请重新解析",
} as const;

/** Only compare one-to-one final files, never infer uploader edits from bytes. */
export function compareVersionFiles(version: MediaVersion, versions: MediaVersion[]): string {
  if (!version.parentTaskId) return "原始下载";
  const parent = versions.find((item) => item.taskId === version.parentTaskId);
  if (!parent || parent.files.length !== 1 || version.files.length !== 1) return "缺少可比文件摘要";
  const before = parent.files[0].sha256;
  const after = version.files[0].sha256;
  if (!before || !after || !/^[a-f0-9]{64}$/.test(before) || !/^[a-f0-9]{64}$/.test(after))
    return "缺少可比文件摘要";
  return before === after ? "与上一版本文件相同" : "与上一版本文件不同（不等于确认换源）";
}
