/** Stable application contracts serialized by Rust using camelCase fields. */
export type AppErrorCode =
  | "invalid_url"
  | "unsupported_url"
  | "component_missing"
  | "component_too_old"
  | "invalid_path"
  | "video_unavailable"
  | "login_required"
  | "private_content"
  | "rate_limited"
  | "network_failure"
  | "disk_full"
  | "permission_denied"
  | "merge_failed"
  | "cancelled"
  | "unknown";

export interface AppError {
  code: AppErrorCode;
  message: string;
  retryable: boolean;
  diagnostic?: string;
}

export interface EventEnvelope<T> {
  schemaVersion: number;
  payload: T;
}

export type ComponentKind = "yt_dlp" | "ffmpeg" | "ffprobe" | "javascript_runtime";
export type ComponentSource = "app_managed" | "system" | "custom";
export type ComponentStatus = "missing" | "available" | "outdated" | "unhealthy";

export interface ComponentInstallation {
  kind: ComponentKind;
  source: ComponentSource | null;
  status: ComponentStatus;
  executablePath: string | null;
  version: string | null;
}

export interface ComponentRelease {
  kind: ComponentKind;
  version: string;
  targetOs: "mac_os" | "windows" | "linux";
  architecture: "aarch64" | "x86_64";
  provider: string;
  url: string;
  sha256: string;
  sizeBytes: number;
  archive: "raw" | "zip" | "tar_gz" | "tar_xz";
  executableName: string;
}

export interface ComponentInstallProgress {
  component: string;
  downloadedBytes: number;
  totalBytes: number;
}

export interface MediaFormat {
  formatId: string;
  extension: string;
  resolution: string | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  fileSizeBytes: number | null;
  approximateFileSizeBytes: number | null;
}

export interface SubtitleTrack {
  language: string;
  name: string | null;
  extension: string | null;
  automatic: boolean;
}

export interface MediaInfo {
  id: string;
  title: string;
  webpageUrl: string;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  uploader: string | null;
  formats: MediaFormat[];
  subtitles: SubtitleTrack[];
  playlist?: PlaylistInfo | null;
}

export interface PlaylistInfo {
  downloadCount: number;
  totalCount: number | null;
  truncated: boolean;
}

export type DownloadTaskStatus =
  | "queued"
  | "preparing"
  | "downloading"
  | "post_processing"
  | "completed"
  | "failed"
  | "cancelling"
  | "cancelled";

export interface DownloadTask {
  id: string;
  url: string;
  title: string;
  formatId: string;
  status: DownloadTaskStatus;
  createdAtUnixMs: number;
}

export interface DownloadOptions {
  title: string;
  url: string;
  formatId: string;
  outputDirectory: string;
  subtitleLanguages: string[];
  playlistItemCount: number | null;
  conflictStrategy: "skip" | "overwrite";
}

export interface DownloadPreferences {
  outputDirectory: string;
  maxConcurrent: number;
  conflictStrategy: "skip" | "overwrite";
}

export interface DownloadProgress {
  taskId: string;
  status: DownloadTaskStatus;
  downloadedBytes: number | null;
  totalBytes: number | null;
  speedBytesPerSecond: number | null;
  etaSeconds: number | null;
  postProcessing: boolean;
}

export interface DownloadResult {
  taskId: string;
  title: string;
  outputPaths: string[];
  totalBytes: number;
}

export interface DownloadHistoryRecord {
  taskId: string;
  title: string;
  outputPaths: string[];
  totalBytes: number;
  completedAtUnixMs: number;
}
