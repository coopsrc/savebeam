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
import { IpcError } from "../../ipc/client";
import type { DownloadOptions, DownloadTask, MediaInfo } from "../../types/domain";
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
                    <Text size="sm" c="dimmed">
                      登录 Cookie 在“设置 → Cookie 与登录”中配置，全局用于解析媒体信息与下载。
                    </Text>
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
                          (writeAutomaticSubtitles && subtitleLanguages.length === 0)
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
