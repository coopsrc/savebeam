import { useRef, useState, type FormEvent } from "react";
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
import { IconAlertCircle, IconLink, IconPhotoOff, IconSearch } from "@tabler/icons-react";
import { IpcError } from "../../ipc/client";
import type {
  DownloadOptions,
  DownloadTask,
  MediaInfo,
  PlaylistSizeItem,
} from "../../types/domain";
import { useNavigate, useLocation } from "react-router-dom";
import { invokeCommand } from "../../ipc/client";
import { useAppStore } from "../../stores/appStore";
import { inspectMedia } from "./mediaApi";
import { getMediaUrlError, validateMediaUrl } from "./validateMediaUrl";
import { selectedEntries } from "./outputPreview";
import {
  applyPlaylistSizes,
  estimateOutputBytes,
  summarizePlaylistBytes,
  type PlaylistSizeCache,
} from "./outputEstimate";
import { formatBytes } from "../../utils/formatBytes";
import {
  AUTOMATIC_AUDIO,
  audioFormats,
  codecLabel,
  formatLabel,
  isRecommendedAudio,
  selectDownload,
  videoFormats,
} from "./formatSelection";

export function DownloadPage() {
  const location = useLocation();
  const [url, setUrl] = useState(() => new URLSearchParams(location.search).get("url") ?? "");
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [useProxy, setUseProxy] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isStartingDownload, setIsStartingDownload] = useState(false);
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const [selectedAudioId, setSelectedAudioId] = useState(AUTOMATIC_AUDIO);
  const [manualAudio, setManualAudio] = useState(false);
  const [playlistConfirmed, setPlaylistConfirmed] = useState(false);
  const [playlistItems, setPlaylistItems] = useState<number[]>([]);
  const [audioOnly, setAudioOnly] = useState(false);
  const [subtitleLanguages, setSubtitleLanguages] = useState<string[]>([]);
  const [writeAutomaticSubtitles, setWriteAutomaticSubtitles] = useState(false);
  const [writeThumbnail, setWriteThumbnail] = useState(false);
  const [writeInfoJson, setWriteInfoJson] = useState(false);
  const [embedMetadata, setEmbedMetadata] = useState(false);
  const [keepIntermediateFiles, setKeepIntermediateFiles] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [playlistSizes, setPlaylistSizes] = useState<PlaylistSizeCache>({});
  const [estimatingSize, setEstimatingSize] = useState(false);
  const [sizeError, setSizeError] = useState<string | null>(null);
  const sizeEpoch = useRef(0);
  const estimatingRef = useRef(false);
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
    setThumbnailFailed(false);
    setSelectedVideoId(null);
    setSelectedAudioId(AUTOMATIC_AUDIO);
    setManualAudio(false);
    setPlaylistConfirmed(false);
    setPlaylistItems([]);
    setAudioOnly(false);
    setSubtitleLanguages([]);
    setWriteAutomaticSubtitles(false);
    setWriteThumbnail(false);
    setWriteInfoJson(false);
    setEmbedMetadata(false);
    setKeepIntermediateFiles(false);
    const epoch = ++sizeEpoch.current;
    setPlaylistSizes({});
    setSizeError(null);

    const checked = validateMediaUrl(url);
    if (!checked.valid) return;

    setIsInspecting(true);
    try {
      const result = await inspectMedia(checked.normalizedUrl, useProxy);
      if (epoch !== sizeEpoch.current) return;
      setMediaInfo(result);
      setPlaylistItems(
        result.playlist?.entries?.filter((entry) => entry.available).map((entry) => entry.index) ??
          [],
      );
      const videos = videoFormats(result.formats);
      setSelectedVideoId(videos[0]?.formatId ?? null);
      setAudioOnly(
        !result.playlist && !videos.length && audioFormats(result.formats, true).length > 0,
      );
    } catch (error: unknown) {
      if (epoch === sizeEpoch.current)
        setRequestError(
          error instanceof IpcError ? error.contextMessage : "解析失败，请稍后重试。",
        );
    } finally {
      setIsInspecting(false);
    }
  }

  function handleChange(value: string) {
    sizeEpoch.current++;
    setPlaylistSizes({});
    setSizeError(null);
    setUrl(value);
    setMediaInfo(null);
    setPlaylistConfirmed(false);
    setRequestError(null);
    setHasSubmitted(false);
  }

  async function handleStartDownload() {
    if (
      !mediaInfo ||
      !selection ||
      (mediaInfo.playlist && (!playlistConfirmed || chosenEntries.length === 0))
    )
      return;
    setRequestError(null);
    setIsStartingDownload(true);
    const options: DownloadOptions = {
      title: mediaInfo.title,
      url: mediaInfo.webpageUrl,
      formatId: selection.formatId,
      mergeContainer: selection.mergeContainer,
      outputDirectory: "",
      playlistItemCount: mediaInfo.playlist ? chosenEntries.length : null,
      playlistItems: mediaInfo.playlist ? chosenEntries.map((entry) => entry.index) : null,
      audioOnly,
      subtitleLanguages,
      writeAutomaticSubtitles,
      writeThumbnail,
      writeInfoJson,
      embedMetadata,
      keepIntermediateFiles,
      useProxy,
      conflictStrategy: "skip",
    };
    try {
      const task = await invokeCommand<DownloadTask>("start_download", { options });
      upsertDownloadTask(task);
      navigate("/tasks");
    } catch (error: unknown) {
      setRequestError(error instanceof IpcError ? error.contextMessage : "无法创建下载任务。");
    } finally {
      setIsStartingDownload(false);
    }
  }

  const selection = mediaInfo
    ? selectDownload(mediaInfo, selectedVideoId, selectedAudioId, audioOnly)
    : null;
  const automaticSelection = mediaInfo
    ? selectDownload(mediaInfo, selectedVideoId, AUTOMATIC_AUDIO, audioOnly)
    : null;
  const playlistEntries = mediaInfo?.playlist?.entries ?? [];
  const chosenEntries = mediaInfo?.playlist
    ? selectedEntries(mediaInfo.playlist, playlistItems)
    : [];
  const bytes = selection ? estimateOutputBytes(selection, audioOnly) : null;
  const seriesBytes = summarizePlaylistBytes(chosenEntries, playlistSizes);
  const sizeText = audioOnly
    ? "预计文件大小：MP3 转换后待定"
    : mediaInfo?.playlist
      ? !chosenEntries.length
        ? "预计文件大小：未选择条目"
        : seriesBytes.unknownCount === 0
          ? `所选 ${chosenEntries.length} 项合计：约 ${formatBytes(seriesBytes.knownBytes!)}`
          : seriesBytes.knownBytes !== null
            ? `已知大小：约 ${formatBytes(seriesBytes.knownBytes)}，${seriesBytes.unknownCount} 项待估算`
            : `所选 ${chosenEntries.length} 项：大小待估算`
      : `预计文件大小：${bytes === null ? "暂无法估算" : `约 ${formatBytes(bytes)}`}`;

  async function estimatePlaylistSize() {
    if (!mediaInfo?.playlist || !chosenEntries.length || audioOnly || estimatingRef.current) return;
    const epoch = sizeEpoch.current;
    const requested = [...chosenEntries];
    estimatingRef.current = true;
    setEstimatingSize(true);
    setSizeError(null);
    try {
      const response = await invokeCommand<PlaylistSizeItem[]>("estimate_playlist_size", {
        url: mediaInfo.webpageUrl,
        items: requested.map(({ index, id }) => ({ index, id })),
        useProxy,
      });
      if (epoch === sizeEpoch.current)
        setPlaylistSizes((current) => applyPlaylistSizes(current, requested, response));
    } catch (reason) {
      if (epoch === sizeEpoch.current)
        setSizeError(
          reason instanceof IpcError ? reason.contextMessage : "大小估算失败，可稍后重试。",
        );
    } finally {
      estimatingRef.current = false;
      setEstimatingSize(false);
    }
  }
  function changePlaylistItems(items: number[]) {
    setPlaylistItems(items);
    setPlaylistConfirmed(false);
  }
  const videos = videoFormats(mediaInfo?.formats ?? []);
  const currentVideo = videos.find((format) => format.formatId === selectedVideoId);
  const usesEmbeddedAudio = !audioOnly && !!currentVideo?.audioCodec;
  const audios = audioFormats(mediaInfo?.formats ?? [], audioOnly);
  const videoOptions = videos.map((format) => ({
    value: format.formatId,
    label: formatLabel(format, "video") + (format.audioCodec ? " · 含音轨" : ""),
  }));
  const audioOptions = audios.map((format) => ({
    value: format.formatId,
    label:
      formatLabel(format, "audio") +
      (format.formatId === automaticSelection?.audio?.formatId
        ? "（推荐 · 自动匹配）"
        : !audioOnly && currentVideo && isRecommendedAudio(currentVideo, format)
          ? "（兼容推荐）"
          : ""),
  }));
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
      <Paper
        className={`download-card${mediaInfo?.playlist ? " download-card--series" : ""}`}
        shadow="sm"
        radius="lg"
        withBorder
      >
        <Stack gap="xl">
          <Group align="flex-start" wrap="nowrap" className="download-heading">
            <div className="download-heading-icon" aria-hidden="true">
              <IconLink size={21} stroke={1.8} />
            </div>
            <Stack gap={4}>
              <Title order={2}>添加视频链接</Title>
              <Text c="dimmed" size="sm">
                输入公开的视频页面网址，读取标题、封面、可用格式和字幕。此步骤不会下载媒体。
              </Text>
            </Stack>
          </Group>

          <form onSubmit={handleSubmit} noValidate>
            <Stack gap="md">
              <div className="download-url-row">
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
                <Button
                  type="submit"
                  loading={isInspecting}
                  leftSection={<IconSearch size={16} stroke={1.8} />}
                >
                  解析视频信息
                </Button>
              </div>
              <Checkbox
                label="使用代理"
                description="不勾选时直接连接；勾选后，解析、大小估算和本次下载使用设置中已保存的自定义代理。"
                checked={useProxy}
                disabled={isInspecting || isStartingDownload}
                onChange={(event) => {
                  const checked = event.currentTarget.checked;
                  setUseProxy(checked);
                  handleChange(url);
                }}
              />
              <Text id="url-input-hint" size="xs" c="dimmed">
                仅支持 http:// 和 https://；需要已在设置中配置 yt-dlp。
              </Text>

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
            </Stack>
          </form>

          {mediaInfo && (
            <div
              className={`download-workbench${mediaInfo.playlist ? " download-workbench--series" : ""}`}
            >
              <Paper
                className="media-info-card download-source-panel"
                component="section"
                aria-label="媒体与格式"
                withBorder
                radius="md"
                p="md"
              >
                <Stack gap="md">
                  <Group align="flex-start" wrap="nowrap" className="download-media-header">
                    {mediaInfo.thumbnailDataUrl && !thumbnailFailed ? (
                      <Image
                        src={mediaInfo.thumbnailDataUrl}
                        alt="视频封面"
                        className="download-thumbnail"
                        w={144}
                        h={81}
                        radius="sm"
                        fit="cover"
                        style={{ flexShrink: 0 }}
                        onError={() => setThumbnailFailed(true)}
                      />
                    ) : (
                      <Stack
                        className="media-thumbnail-placeholder"
                        gap={4}
                        align="center"
                        justify="center"
                      >
                        <IconPhotoOff size={24} aria-hidden="true" />
                        <Text size="xs">封面暂不可用</Text>
                      </Stack>
                    )}
                    <div className="download-media-details">
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
                  {!mediaInfo.playlist &&
                    (videos.length > 0 || audios.length > 0 ? (
                      <Stack gap="sm">
                        <Text fw={600}>视频与音轨</Text>
                        {!audioOnly && (
                          <Select
                            label="视频画质"
                            description="默认优先最佳画质。独立音频将在下载后自动合并。"
                            data={videoOptions}
                            value={selectedVideoId}
                            onChange={setSelectedVideoId}
                            allowDeselect={false}
                          />
                        )}
                        <Text size="sm" c="dimmed">
                          {usesEmbeddedAudio
                            ? `音频：使用视频内置音轨（${codecLabel(currentVideo?.audioCodec ?? null)}）`
                            : automaticSelection?.audio
                              ? `${manualAudio ? "推荐音频" : "自动匹配音频"}：${formatLabel(automaticSelection.audio, "audio")}`
                              : "站点未提供独立音频轨道。"}
                        </Text>
                        <Checkbox
                          label="手动选择音频"
                          description={
                            usesEmbeddedAudio
                              ? "该视频格式已包含音轨；选择音视频分离的视频格式后可更换独立音轨。"
                              : "展开可用音频列表，按推荐标识、编码、码率或语言选择。"
                          }
                          checked={manualAudio && !usesEmbeddedAudio}
                          disabled={usesEmbeddedAudio || audios.length === 0}
                          onChange={(event) => {
                            const manual = event.currentTarget.checked;
                            setManualAudio(manual);
                            setSelectedAudioId(
                              manual
                                ? (automaticSelection?.audio?.formatId ??
                                    audios[0]?.formatId ??
                                    AUTOMATIC_AUDIO)
                                : AUTOMATIC_AUDIO,
                            );
                          }}
                        />
                        {manualAudio && !usesEmbeddedAudio && (
                          <Select
                            label="音频轨道"
                            description="推荐项优先保持视频容器兼容；更换编码后，输出格式可能改变。"
                            data={audioOptions}
                            value={selectedAudioId}
                            onChange={(value) => setSelectedAudioId(value ?? AUTOMATIC_AUDIO)}
                            allowDeselect={false}
                          />
                        )}
                        {!audioOnly && selection && !selection.audio && (
                          <Alert color="yellow" title="该格式没有音轨">
                            站点未提供独立音频，此选择将下载无声视频。可尝试选择包含音轨的视频格式。
                          </Alert>
                        )}
                      </Stack>
                    ) : (
                      <Alert color="yellow" title="没有可选格式">
                        网站没有返回可供下载的媒体格式。
                      </Alert>
                    ))}
                </Stack>
              </Paper>
              {mediaInfo.playlist && (
                <Paper
                  component="section"
                  aria-label="选择系列视频"
                  withBorder
                  p="md"
                  className="download-series-panel"
                >
                  <Stack gap="sm" className="download-series-content">
                    <Text fw={600}>选择下载条目（已选 {chosenEntries.length} 项）</Text>
                    <Group justify="space-between">
                      <Button
                        type="button"
                        size="xs"
                        variant="light"
                        onClick={() =>
                          navigate(`/subscriptions?url=${encodeURIComponent(mediaInfo.webpageUrl)}`)
                        }
                      >
                        订阅此系列
                      </Button>
                      <Group gap="xs">
                        <Button
                          type="button"
                          size="xs"
                          variant="subtle"
                          onClick={() =>
                            changePlaylistItems(
                              playlistEntries
                                .filter((entry) => entry.available)
                                .map((entry) => entry.index),
                            )
                          }
                        >
                          全选
                        </Button>
                        <Button
                          type="button"
                          size="xs"
                          variant="subtle"
                          onClick={() => changePlaylistItems([])}
                        >
                          取消全选
                        </Button>
                      </Group>
                    </Group>
                    <Text size="sm">
                      {mediaInfo.playlist.truncated
                        ? "系列超过安全上限，当前最多展示前 50 项，可勾选其中一部分。"
                        : `检测到 ${mediaInfo.playlist.totalCount ?? playlistEntries.length} 项，可勾选需要下载的条目。`}
                    </Text>
                    <div
                      className="download-playlist-list"
                      role="group"
                      aria-label="可选视频条目"
                      tabIndex={0}
                    >
                      {playlistEntries.map((entry, offset) => (
                        <Checkbox
                          key={`${entry.index}-${offset}`}
                          label={`第 ${entry.index} 项 · ${entry.title}`}
                          description={
                            entry.available
                              ? entry.id
                                ? `视频 ID：${entry.id}`
                                : "视频 ID 待解析"
                              : "条目信息不可用或不在支持范围，暂不可选"
                          }
                          checked={entry.available && playlistItems.includes(entry.index)}
                          disabled={!entry.available}
                          onChange={(event) => {
                            const checked = event.currentTarget.checked;
                            changePlaylistItems(
                              checked
                                ? [...playlistItems, entry.index]
                                : playlistItems.filter((index) => index !== entry.index),
                            );
                          }}
                        />
                      ))}
                      {!playlistEntries.length && (
                        <Text c="dimmed" size="sm">
                          未返回可选条目，请重新解析链接。
                        </Text>
                      )}
                    </div>
                    <Checkbox
                      checked={playlistConfirmed}
                      disabled={chosenEntries.length === 0}
                      onChange={(event) => setPlaylistConfirmed(event.currentTarget.checked)}
                      label={`我确认下载所选 ${chosenEntries.length} 项`}
                    />
                  </Stack>
                </Paper>
              )}
              <Paper
                className="download-options-panel"
                component="section"
                aria-label="下载选项"
                withBorder
                radius="md"
                p="md"
              >
                <Stack gap="md">
                  <Title order={3}>下载选项</Title>
                  <Stack gap="xs">
                    <Checkbox
                      checked={audioOnly}
                      disabled={!mediaInfo.playlist && videos.length === 0}
                      onChange={(event) => {
                        setAudioOnly(event.currentTarget.checked);
                        setPlaylistConfirmed(false);
                        setSelectedAudioId(AUTOMATIC_AUDIO);
                        setManualAudio(false);
                      }}
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
                    <Checkbox
                      checked={keepIntermediateFiles}
                      onChange={(event) => setKeepIntermediateFiles(event.currentTarget.checked)}
                      label="保留中间文件"
                      description="保留合并或转换前的源文件，会占用额外空间；分轨文件在合并成功后按格式 ID、编码、分辨率和码率命名。"
                    />
                  </Stack>
                </Stack>
              </Paper>
              <Group
                className="download-start-actions"
                justify="space-between"
                role="group"
                aria-label="下载操作"
              >
                <Text
                  component="div"
                  size="sm"
                  c="dimmed"
                  aria-live="polite"
                  className="download-size-hint"
                  title="估算最终媒体大小，不含字幕、封面、JSON 和保留的中间文件；封装后可能略有差异，源格式可能随时间变化。"
                >
                  <span>{sizeText}</span>
                  {mediaInfo.playlist && !audioOnly && (
                    <Button
                      type="button"
                      variant="subtle"
                      size="compact-xs"
                      ml="xs"
                      onClick={() => void estimatePlaylistSize()}
                      loading={estimatingSize}
                      disabled={!chosenEntries.length || estimatingSize}
                    >
                      {seriesBytes.knownCount ? "重新估算" : "估算大小"}
                    </Button>
                  )}
                  {sizeError && (
                    <Text component="span" c="red" size="xs" ml="xs" role="alert">
                      {sizeError}
                    </Text>
                  )}
                </Text>
                <Button
                  type="button"
                  onClick={handleStartDownload}
                  loading={isStartingDownload}
                  disabled={
                    !selection ||
                    (mediaInfo.playlist && (!playlistConfirmed || chosenEntries.length === 0)) ||
                    (writeAutomaticSubtitles && subtitleLanguages.length === 0)
                  }
                >
                  开始下载
                </Button>
              </Group>
            </div>
          )}
        </Stack>
      </Paper>
    </main>
  );
}
