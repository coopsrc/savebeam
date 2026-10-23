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
  height?: number | null;
  videoBitrateKbps?: number | null;
  formatId: string;
  extension: string;
  resolution: string | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  audioBitrateKbps: number | null;
  language: string | null;
  formatNote: string | null;
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
  thumbnailDataUrl: string | null;
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
  id: string | null;
  title: string;
  entries: PlaylistEntry[];
}

export interface PlaylistEntry {
  index: number;
  id: string | null;
  title: string;
  available: boolean;
}

export interface PlaylistSizeItem {
  index: number;
  id: string | null;
  bytes: number | null;
}

export interface PlaylistQuality {
  automaticRecommendations?: boolean;
  resolutionHeight?: number | null;
  frameRate?: number | null;
  videoExtension?: string | null;
  videoCodec?: string | null;
  audioExtension?: string | null;
  audioCodec?: string | null;
  maxHeight: number | null;
  maxVideoBitrateKbps: number | null;
  maxAudioBitrateKbps: number | null;
  allowExceed: boolean;
}
export interface PlaylistDetails {
  part?: PlaylistPartContext | null;
  parts?: PlaylistDetails[];
  index: number;
  id: string | null;
  title: string | null;
  durationSeconds: number | null;
  formats: MediaFormat[];
  subtitles?: SubtitleTrack[];
  error: string | null;
}
export interface PlaylistPartContext {
  sourceUrl: string;
  collectionId: string;
  collectionTitle: string;
  parentId: string;
  parentIndex: number;
  partIndex: number;
  partCount: number;
}
export interface PlaylistMatch {
  index: number;
  id: string | null;
  formatId: string | null;
  mergeContainer: MergeContainer | null;
  resolution: string | null;
  videoBitrateKbps: number | null;
  audioBitrateKbps: number | null;
  bytes: number | null;
  fallbackUsed: boolean;
  error: string | null;
}
export interface QueuedPlaylistTasks {
  tasks: DownloadTask[];
  queuedIndices: number[];
  skipped: number[];
  error: string | null;
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
  mergeContainer: MergeContainer | null;
  outputDirectory: string;
  subtitleLanguages: string[];
  playlistItemCount: number | null;
  playlistItems: number[] | null;
  audioOnly: boolean;
  writeAutomaticSubtitles: boolean;
  writeThumbnail: boolean;
  writeInfoJson: boolean;
  embedMetadata: boolean;
  keepIntermediateFiles: boolean;
  useProxy: boolean;
  conflictStrategy: "skip" | "overwrite";
}

export type MergeContainer = "mp4" | "webm" | "mkv";

export type CookieBrowser =
  "brave" | "chrome" | "chromium" | "edge" | "firefox" | "opera" | "safari" | "vivaldi" | "whale";

export interface DownloadPreferences {
  outputDirectory: string;
  maxConcurrent: number;
  conflictStrategy: "skip" | "overwrite";
}

export type DownloadOptionDefaults = Pick<
  DownloadOptions,
  | "audioOnly"
  | "subtitleLanguages"
  | "writeAutomaticSubtitles"
  | "writeThumbnail"
  | "writeInfoJson"
  | "embedMetadata"
  | "keepIntermediateFiles"
>;

export interface CookiePreferences {
  cookiesFilePath: string | null;
  cookiesBrowser: CookieBrowser | null;
  accessConfirmed: boolean;
}

export interface NetworkPreferences {
  proxyMode: "default" | "direct" | "custom";
  proxyUrl: string;
}

export interface ConnectionCheck {
  status: "success" | "failed" | "limited" | "skipped";
  message: string;
  durationMs: number | null;
  httpStatus: number | null;
}

export interface NetworkConnectionTestResult {
  proxy: ConnectionCheck;
  youtube: ConnectionCheck;
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
