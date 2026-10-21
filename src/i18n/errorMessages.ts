import type { AppError, AppErrorCode } from "../types/domain";

export type AppLocale = "zh-CN" | "en-US";

/** Error text is keyed by stable Rust error codes so more UI locales can be added later. */
const messages: Record<AppLocale, Record<AppErrorCode, string>> = {
  "zh-CN": {
    invalid_url: "请输入有效的 http 或 https 视频链接。",
    unsupported_url: "暂不支持此网站或链接格式。",
    component_missing: "缺少必需的运行组件，请前往设置检查安装状态。",
    component_too_old: "运行组件版本过旧或不可用，请在设置中更新或重新配置。",
    invalid_path: "文件或目录路径无效，请检查权限和路径后重试。",
    video_unavailable: "无法读取此视频；请检查链接、访问权限或视频可用性。",
    login_required: "此内容需要登录。你可以为当前任务明确授权使用登录 Cookie。",
    private_content: "此视频为私有内容，当前账号没有访问权限。",
    rate_limited: "请求过于频繁，请稍后重试。",
    network_failure: "网络连接失败或请求超时，请检查网络后重试。",
    disk_full: "磁盘空间不足，请释放空间后重试。",
    permission_denied: "没有权限访问所选文件、目录或网络资源。",
    merge_failed: "媒体合并失败，请检查 FFmpeg 安装状态和可用磁盘空间。",
    cancelled: "操作已取消。",
    unknown: "操作未能完成，请重试；如果问题持续，请导出诊断信息。",
  },
  "en-US": {
    invalid_url: "Enter a valid HTTP or HTTPS video URL.",
    unsupported_url: "This website or URL format is not supported yet.",
    component_missing:
      "A required runtime component is missing. Check its installation in Settings.",
    component_too_old:
      "A runtime component is outdated or unavailable. Update or reconfigure it in Settings.",
    invalid_path:
      "The file or directory path is invalid. Check the path and permissions, then try again.",
    video_unavailable: "This video could not be read. Check the URL, access, and availability.",
    login_required:
      "This content requires sign-in. You can explicitly authorize login cookies for this task.",
    private_content: "This video is private or the current account cannot access it.",
    rate_limited: "Too many requests. Please wait and try again.",
    network_failure:
      "The network request failed or timed out. Check your connection and try again.",
    disk_full: "There is not enough disk space. Free some space and try again.",
    permission_denied: "Access to the selected file, directory, or network resource was denied.",
    merge_failed: "Media merging failed. Check FFmpeg and available disk space.",
    cancelled: "The operation was cancelled.",
    unknown:
      "The operation could not be completed. Try again or export diagnostics if it persists.",
  },
};

export function getLocalizedErrorMessage(error: AppError, locale: AppLocale): string {
  return messages[locale][error.code];
}
