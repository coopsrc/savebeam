import { useState, type FormEvent } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Image,
  MultiSelect,
  Paper,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertCircle, IconLink, IconSearch } from "@tabler/icons-react";
import { open } from "@tauri-apps/plugin-dialog";
import { IpcError } from "../../ipc/client";
import type { CookieBrowser, DownloadOptions, DownloadTask, MediaInfo } from "../../types/domain";
import { useNavigate } from "react-router-dom";
import { invokeCommand } from "../../ipc/client";
import { useAppStore } from "../../stores/appStore";
import { inspectMedia } from "./mediaApi";
import { getMediaUrlError, validateMediaUrl } from "./validateMediaUrl";

function formatLabel(format: MediaInfo["formats"][number]): string {
  const details = [format.resolution, format.fps ? `${format.fps} fps` : null, format.extension]
    .filter(Boolean)
    .join(" · ");
  const streams = [format.videoCodec ? "视频" : null, format.audioCodec ? "音频" : null]
    .filter(Boolean)
    .join("+");
  return `${format.formatId} — ${details || "未知规格"}${streams ? ` · ${streams}` : ""}`;
}

export function DownloadPage() {
  const [url, setUrl] = useState("");
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isStartingDownload, setIsStartingDownload] = useState(false);
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);
  const [playlistConfirmed, setPlaylistConfirmed] = useState(false);
  const [audioOnly, setAudioOnly] = useState(false);
  const [subtitleLanguages, setSubtitleLanguages] = useState<string[]>([]);
  const [writeAutomaticSubtitles, setWriteAutomaticSubtitles] = useState(false);
  const [writeThumbnail, setWriteThumbnail] = useState(false);
  const [writeInfoJson, setWriteInfoJson] = useState(false);
  const [embedMetadata, setEmbedMetadata] = useState(false);
  const [cookieSource, setCookieSource] = useState<"none" | "file" | "browser">("none");
  const [cookiesFilePath, setCookiesFilePath] = useState<string | null>(null);
  const [cookiesBrowser, setCookiesBrowser] = useState<CookieBrowser | null>(null);
  const [cookieAccessConfirmed, setCookieAccessConfirmed] = useState(false);
  const [cookiePickerError, setCookiePickerError] = useState<string | null>(null);
  const [requestError, setRequestError] = useState<string | null>(null);
  const upsertDownloadTask = useAppStore((state) => state.upsertDownloadTask);
  const navigate = useNavigate();
  const validation = hasSubmitted ? validateMediaUrl(url) : null;
  const validationError =
    validation && !validation.valid ? getMediaUrlError(validation.reason) : undefined;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasSubmitted(true);
    setRequestError(null);
    setMediaInfo(null);
    setSelectedFormat(null);
    setPlaylistConfirmed(false);
    setAudioOnly(false);
    setSubtitleLanguages([]);
    setWriteAutomaticSubtitles(false);
    setWriteThumbnail(false);
    setWriteInfoJson(false);
    setEmbedMetadata(false);
    setCookieSource("none");
    setCookiesFilePath(null);
    setCookiesBrowser(null);
    setCookieAccessConfirmed(false);
    setCookiePickerError(null);

    const checked = validateMediaUrl(url);
    if (!checked.valid) return;

    setIsInspecting(true);
    try {
      const result = await inspectMedia(checked.normalizedUrl);
      setMediaInfo(result);
      setSelectedFormat(result.formats[0]?.formatId ?? null);
    } catch (error: unknown) {
      setRequestError(error instanceof IpcError ? error.message : "解析失败，请稍后重试。");
    } finally {
      setIsInspecting(false);
    }
  }

  function handleChange(value: string) {
    setUrl(value);
    setMediaInfo(null);
    setPlaylistConfirmed(false);
    setRequestError(null);
    setHasSubmitted(false);
  }

  async function handleStartDownload() {
    if (!mediaInfo || (mediaInfo.playlist ? !playlistConfirmed : !selectedFormat && !audioOnly))
      return;
    setRequestError(null);
    setIsStartingDownload(true);
    const options: DownloadOptions = {
      title: mediaInfo.title,
      url: mediaInfo.webpageUrl,
      formatId: audioOnly ? "bestaudio/best" : mediaInfo.playlist ? "best" : selectedFormat!,
      outputDirectory: "",
      playlistItemCount: mediaInfo.playlist?.downloadCount ?? null,
      audioOnly,
      subtitleLanguages,
      writeAutomaticSubtitles,
      writeThumbnail,
      writeInfoJson,
      embedMetadata,
      cookiesFilePath: cookieSource === "file" ? cookiesFilePath : null,
      cookiesBrowser: cookieSource === "browser" ? cookiesBrowser : null,
      cookieAccessConfirmed,
      conflictStrategy: "skip",
    };
    try {
      const task = await invokeCommand<DownloadTask>("start_download", { options });
      upsertDownloadTask(task);
      navigate("/tasks");
    } catch (error: unknown) {
      setRequestError(error instanceof IpcError ? error.message : "无法创建下载任务。");
    } finally {
      setIsStartingDownload(false);
    }
  }

  async function chooseCookiesFile() {
    setCookiePickerError(null);
    try {
      const selection = await open({
        title: "选择 cookies.txt",
        filters: [{ name: "Cookie 文本文件", extensions: ["txt"] }],
        multiple: false,
        directory: false,
        fileAccessMode: "scoped",
      });
      if (typeof selection === "string") {
        setCookiesFilePath(selection);
        setCookieAccessConfirmed(false);
      }
    } catch {
      setCookiePickerError("无法打开系统文件选择器，请稍后重试。");
    }
  }

  const formatOptions =
    mediaInfo?.formats.map((format) => ({
      value: format.formatId,
      label: formatLabel(format),
    })) ?? [];
  const subtitleOptions = mediaInfo
    ? Array.from(new Map(mediaInfo.subtitles.map((track) => [track.language, track])).values()).map(
        (track) => ({
          value: track.language,
          label: `${track.language}${track.name ? ` — ${track.name}` : ""}`,
        }),
      )
    : [];
  return (
    <main className="download-page">
      <Paper className="download-card" shadow="sm" radius="lg" withBorder>
        <Stack gap="xl">
          <Stack gap={6}>
            <div className="download-heading-icon" aria-hidden="true">
              <IconLink size={21} stroke={1.8} />
            </div>
            <Title order={2}>添加视频链接</Title>
            <Text c="dimmed" size="sm">
              输入公开的视频页面网址，读取标题、封面、可用格式和字幕。此步骤不会下载媒体。
            </Text>
          </Stack>

          <form onSubmit={handleSubmit} noValidate>
            <Stack gap="md">
              <TextInput
                autoComplete="url"
                autoCapitalize="off"
                spellCheck={false}
                label="视频链接"
                placeholder="https://example.com/video"
                value={url}
                onChange={(event) => handleChange(event.currentTarget.value)}
                error={validationError}
                inputMode="url"
                aria-describedby="url-input-hint"
              />
              <Text id="url-input-hint" size="xs" c="dimmed">
                仅支持 http:// 和 https://；需要已在设置中配置 yt-dlp。
              </Text>
              <div className="download-actions">
                <Button
                  type="submit"
                  loading={isInspecting}
                  leftSection={<IconSearch size={16} stroke={1.8} />}
                >
                  解析视频信息
                </Button>
              </div>

              {requestError && (
                <Alert
                  color="red"
                  icon={<IconAlertCircle size={18} />}
                  title="无法解析"
                  role="alert"
                  aria-live="assertive"
                >
                  {requestError}
                </Alert>
              )}

              {mediaInfo && (
                <Paper className="media-info-card" withBorder radius="md" p="md">
                  <Stack gap="md">
                    <Group align="flex-start" wrap="nowrap">
                      {mediaInfo.thumbnailUrl && (
                        <Image
                          src={mediaInfo.thumbnailUrl}
                          alt="视频封面"
                          w={180}
                          h={102}
                          radius="sm"
                          fit="cover"
                        />
                      )}
                      <div>
                        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
                          媒体信息
                        </Text>
                        <Title order={3} mt={4}>
                          {mediaInfo.title}
                        </Title>
                        {mediaInfo.uploader && (
                          <Text size="sm" c="dimmed">
                            {mediaInfo.uploader}
                          </Text>
                        )}
                        {mediaInfo.durationSeconds && (
                          <Text size="sm" c="dimmed">
                            时长 {Math.floor(mediaInfo.durationSeconds / 60)}:
                            {String(Math.floor(mediaInfo.durationSeconds % 60)).padStart(2, "0")}
                          </Text>
                        )}
                      </div>
                    </Group>
                    {mediaInfo.playlist ? (
                      <Alert color="orange" title="播放列表下载数量确认" aria-live="polite">
                        <Stack gap="sm">
                          <Text size="sm">
                            {mediaInfo.playlist.truncated
                              ? `播放列表超过安全上限，将只下载前 ${mediaInfo.playlist.downloadCount} 项。`
                              : `检测到 ${mediaInfo.playlist.downloadCount} 项，将按${audioOnly ? "仅音频 MP3" : "默认最佳格式"}下载。`}
                          </Text>
                          <Checkbox
                            checked={playlistConfirmed}
                            onChange={(event) => setPlaylistConfirmed(event.currentTarget.checked)}
                            label={`我确认创建 ${mediaInfo.playlist.downloadCount} 项的播放列表下载任务`}
                          />
                        </Stack>
                      </Alert>
                    ) : !audioOnly && formatOptions.length > 0 ? (
                      <Select
                        label="可用格式"
                        data={formatOptions}
                        value={selectedFormat}
                        onChange={setSelectedFormat}
                        allowDeselect={false}
                        disabled={audioOnly}
                      />
                    ) : !audioOnly ? (
                      <Alert color="yellow" title="没有可选格式">
                        网站没有返回可供下载的媒体格式。
                      </Alert>
                    ) : null}
                    <Stack gap="xs">
                      <Checkbox
                        checked={audioOnly}
                        onChange={(event) => setAudioOnly(event.currentTarget.checked)}
                        label="仅下载音频（MP3）"
                        description="需要 FFmpeg 和 ffprobe 进行音频提取与转换。"
                      />
                      {subtitleOptions.length > 0 && (
                        <>
                          <MultiSelect
                            label="下载字幕"
                            placeholder="不下载字幕"
                            data={subtitleOptions}
                            value={subtitleLanguages}
                            onChange={setSubtitleLanguages}
                            searchable
                            clearable
                          />
                          {subtitleLanguages.length > 0 &&
                            mediaInfo.subtitles.some(
                              (track) =>
                                track.automatic && subtitleLanguages.includes(track.language),
                            ) && (
                              <Checkbox
                                checked={writeAutomaticSubtitles}
                                onChange={(event) =>
                                  setWriteAutomaticSubtitles(event.currentTarget.checked)
                                }
                                label="同时下载自动生成的字幕"
                              />
                            )}
                        </>
                      )}
                      <Checkbox
                        checked={writeThumbnail}
                        onChange={(event) => setWriteThumbnail(event.currentTarget.checked)}
                        label="另存缩略图文件"
                      />
                      <Checkbox
                        checked={writeInfoJson}
                        onChange={(event) => setWriteInfoJson(event.currentTarget.checked)}
                        label="另存媒体信息 JSON"
                      />
                      <Checkbox
                        checked={embedMetadata}
                        onChange={(event) => setEmbedMetadata(event.currentTarget.checked)}
                        label="将媒体元数据写入文件"
                      />
                    </Stack>
                    <Stack gap="xs">
                      <Select
                        label="登录信息来源（可选）"
                        description="只用于你明确选择的当前下载任务。"
                        data={[
                          { value: "none", label: "不使用登录信息" },
                          { value: "file", label: "使用 cookies.txt 文件" },
                          { value: "browser", label: "从本机浏览器读取登录 Cookie" },
                        ]}
                        value={cookieSource}
                        onChange={(value) => {
                          const source = value === "file" || value === "browser" ? value : "none";
                          setCookieSource(source);
                          setCookieAccessConfirmed(false);
                          setCookiePickerError(null);
                          if (source !== "file") setCookiesFilePath(null);
                          if (source !== "browser") setCookiesBrowser(null);
                        }}
                        allowDeselect={false}
                      />
                      {cookieSource === "file" && (
                        <>
                          <Group align="center" wrap="wrap">
                            <Button variant="default" onClick={() => void chooseCookiesFile()}>
                              选择 cookies.txt
                            </Button>
                            {cookiesFilePath && (
                              <Text size="sm" c="dimmed">
                                已选择：{cookiesFilePath.split(/[\\/]/).pop() ?? "cookies.txt"}
                              </Text>
                            )}
                          </Group>
                          <Alert color="yellow" title="Cookie 文件注意事项">
                            yt-dlp
                            会读取并可能更新你选择的文件。若不希望原文件发生变化，请先选择它的副本。
                          </Alert>
                        </>
                      )}
                      {cookieSource === "browser" && (
                        <>
                          <Select
                            label="选择浏览器"
                            placeholder="选择已登录的浏览器"
                            data={[
                              { value: "brave", label: "Brave" },
                              { value: "chrome", label: "Google Chrome" },
                              { value: "chromium", label: "Chromium" },
                              { value: "edge", label: "Microsoft Edge" },
                              { value: "firefox", label: "Firefox" },
                              { value: "opera", label: "Opera" },
                              { value: "safari", label: "Safari" },
                              { value: "vivaldi", label: "Vivaldi" },
                              { value: "whale", label: "Whale" },
                            ]}
                            value={cookiesBrowser}
                            onChange={(value) => {
                              setCookiesBrowser(value as CookieBrowser | null);
                              setCookieAccessConfirmed(false);
                            }}
                            searchable
                            allowDeselect={false}
                          />
                          <Alert color="orange" title="敏感权限确认">
                            Savebeam 将要求 yt-dlp 从所选浏览器读取登录 Cookie；配置按 yt-dlp
                            默认规则选择， 通常为最近使用的配置。Cookie
                            可代表你的账号访问网站；请只对你信任的网站使用。应用不会读取 Cookie
                            内容， 但 yt-dlp
                            会在本机读取它们并用于本次下载。若浏览器配置被占用，请先退出浏览器。
                          </Alert>
                        </>
                      )}
                      {cookieSource !== "none" && (
                        <Checkbox
                          checked={cookieAccessConfirmed}
                          onChange={(event) =>
                            setCookieAccessConfirmed(event.currentTarget.checked)
                          }
                          disabled={
                            (cookieSource === "file" && !cookiesFilePath) ||
                            (cookieSource === "browser" && !cookiesBrowser)
                          }
                          label={
                            cookieSource === "browser"
                              ? "我授权本任务使用所选浏览器的登录 Cookie"
                              : "我授权 yt-dlp 为本任务读取并可能更新所选 cookies.txt 文件"
                          }
                        />
                      )}
                      {cookiePickerError && (
                        <Text size="sm" c="red" role="alert">
                          {cookiePickerError}
                        </Text>
                      )}
                    </Stack>
                    <Text size="xs" c="dimmed">
                      保存位置：系统“下载”目录。部分后处理选项需要 FFmpeg。
                    </Text>
                    <Group justify="flex-end">
                      <Button
                        onClick={handleStartDownload}
                        loading={isStartingDownload}
                        disabled={
                          (mediaInfo.playlist
                            ? !playlistConfirmed
                            : !selectedFormat && !audioOnly) ||
                          (writeAutomaticSubtitles && subtitleLanguages.length === 0) ||
                          (cookieSource === "file" && !cookiesFilePath) ||
                          (cookieSource === "browser" &&
                            (!cookiesBrowser || !cookieAccessConfirmed)) ||
                          (cookieSource === "file" && !cookieAccessConfirmed)
                        }
                      >
                        开始下载
                      </Button>
                    </Group>
                  </Stack>
                </Paper>
              )}
            </Stack>
          </form>
        </Stack>
      </Paper>
    </main>
  );
}
