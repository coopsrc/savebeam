import { useLayoutEffect, useRef, useState, type FormEvent } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Group,
  Image,
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
  PlaylistQuality,
  QueuedPlaylistTasks,
} from "../../types/domain";
import { useNavigate } from "react-router-dom";
import { invokeCommand } from "../../ipc/client";
import { useAppStore } from "../../stores/appStore";
import { inspectMedia } from "./mediaApi";
import { getMediaUrlError, validateMediaUrl } from "./validateMediaUrl";
import { selectedDownloadEntries, entryLabel, expandedOverrides } from "./playlistParts";
import { DownloadOptionsModal } from "./DownloadOptionsModal";
import { useDownloadOptions } from "./useDownloadOptions";
import { estimateOutputBytes } from "./outputEstimate";
import { PlaylistQualityFields } from "./PlaylistQualityFields";
import { DEFAULT_PLAYLIST_QUALITY } from "./playlistQuality";
import { PlaylistQualityModal } from "./PlaylistQualityModal";
import { usePlaylistDetails } from "./usePlaylistDetails";
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

export function DownloadPage({
  initialUrl,
  active,
  onDraftTouched,
  onQueued,
}: {
  initialUrl: string;
  active: boolean;
  onDraftTouched: () => void;
  onQueued: () => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const activePage = useRef(active);
  useLayoutEffect(() => {
    activePage.current = active;
    return () => {
      activePage.current = false;
    };
  }, [active]);
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
  const {
    options: advancedOptions,
    setOptions: setAdvancedOptions,
    loading: loadingDefaults,
    error: defaultsError,
    retry: retryDefaults,
  } = useDownloadOptions();
  const { audioOnly, subtitleLanguages, writeAutomaticSubtitles } = advancedOptions;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [quality, setQuality] = useState<PlaylistQuality>({ ...DEFAULT_PLAYLIST_QUALITY });
  const [qualityOverrides, setQualityOverrides] = useState<Record<number, PlaylistQuality>>({});
  const [editingQuality, setEditingQuality] = useState<number | null>(null);
  const [queuedNotice, setQueuedNotice] = useState<string | null>(null);
  const series = usePlaylistDetails(mediaInfo, useProxy, quality, qualityOverrides, audioOnly);
  const sizeEpoch = useRef(0);
  const upsertDownloadTask = useAppStore((state) => state.upsertDownloadTask);
  const navigate = useNavigate();
  const validation = hasSubmitted ? validateMediaUrl(url) : null;
  const validationError =
    validation && !validation.valid ? getMediaUrlError(validation.reason) : undefined;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onDraftTouched();
    setHasSubmitted(true);
    setRequestError(null);
    setMediaInfo(null);
    setThumbnailFailed(false);
    setSelectedVideoId(null);
    setSelectedAudioId(AUTOMATIC_AUDIO);
    setManualAudio(false);
    setPlaylistConfirmed(false);
    setPlaylistItems([]);
    const epoch = ++sizeEpoch.current;
    setQualityOverrides({});
    setEditingQuality(null);
    setQueuedNotice(null);

    const checked = validateMediaUrl(url);
    if (!checked.valid || loadingDefaults || defaultsError) return;

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
      if (!result.playlist && !videos.length && audioFormats(result.formats, true).length > 0)
        setAdvancedOptions((current) => ({ ...current, audioOnly: true }));
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
    onDraftTouched();
    sizeEpoch.current++;
    setQualityOverrides({});
    setQueuedNotice(null);
    setUrl(value);
    setEditingQuality(null);
    setMediaInfo(null);
    setPlaylistConfirmed(false);
    setRequestError(null);
    setHasSubmitted(false);
  }

  async function handleStartDownload() {
    if (
      !mediaInfo ||
      loadingDefaults ||
      defaultsError ||
      isStartingDownload ||
      !selection ||
      (mediaInfo.playlist && (!playlistConfirmed || !seriesReady || !matchedCount))
    )
      return;
    setRequestError(null);
    setIsStartingDownload(true);
    // Router transitions may update the URL before this page's active prop commits.
    const originLocation = window.location.href;
    const options: DownloadOptions = {
      title: mediaInfo.title,
      url: mediaInfo.webpageUrl,
      formatId: selection.formatId,
      mergeContainer: selection.mergeContainer,
      outputDirectory: "",
      playlistItemCount: mediaInfo.playlist ? chosenEntries.length : null,
      playlistItems: mediaInfo.playlist ? chosenEntries.map((entry) => entry.index) : null,
      ...advancedOptions,
      useProxy,
      conflictStrategy: "skip",
    };
    try {
      if (mediaInfo.playlist) {
        const result = await invokeCommand<QueuedPlaylistTasks>("start_playlist_download", {
          request: {
            url: mediaInfo.webpageUrl,
            items: chosenEntries.map((entry) => series.details[entry.index]),
            policy: quality,
            overrides: expandedOverrides(chosenEntries, qualityOverrides),
            downloadOptions: advancedOptions,
            useProxy,
          },
        });
        result.tasks.forEach(upsertDownloadTask);
        if (result.error || result.skipped.length) {
          setPlaylistItems(
            chosenEntries
              .map((entry) => entry.index)
              .filter((index) => !result.queuedIndices.includes(index)),
          );
          setPlaylistConfirmed(false);
          setQueuedNotice(
            `已加入 ${result.tasks.length} 项；${result.skipped.length} 项未匹配，未重复加入已排队条目。`,
          );
          if (result.error) setRequestError(result.error);
        } else {
          onQueued();
          if (activePage.current && window.location.href === originLocation) navigate("/tasks");
        }
        return;
      }
      const task = await invokeCommand<DownloadTask>("start_download", { options });
      upsertDownloadTask(task);
      onQueued();
      if (activePage.current && window.location.href === originLocation) navigate("/tasks");
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
  const playlistEntries = series.entries;
  const editingEntry = playlistEntries.find((entry) => entry.index === editingQuality);
  const chosenEntries = mediaInfo?.playlist
    ? selectedDownloadEntries(playlistEntries, playlistItems)
    : [];
  const bytes = selection ? estimateOutputBytes(selection, audioOnly) : null;
  const selectedMatches = chosenEntries.map((entry) =>
    series.matches.find((row) => row.index === entry.index),
  );
  const seriesReady =
    chosenEntries.length > 0 &&
    !series.matching &&
    chosenEntries.every((entry) => series.details[entry.index]?.id) &&
    selectedMatches.every(Boolean);
  const matchedCount = selectedMatches.filter((row) => row?.formatId).length;
  const knownSizes = selectedMatches.filter(
    (row) => row?.formatId && typeof row.bytes === "number",
  );
  const totalSize = knownSizes.reduce((total, row) => total + row!.bytes!, 0);
  const sizeText = audioOnly
    ? "预计文件大小：MP3 转换后待定"
    : mediaInfo?.playlist
      ? !chosenEntries.length
        ? "预计文件大小：未选择条目"
        : matchedCount > 0 && knownSizes.length === matchedCount && Number.isSafeInteger(totalSize)
          ? `匹配 ${matchedCount} 项合计：约 ${formatBytes(totalSize)}`
          : `已匹配 ${matchedCount}/${chosenEntries.length} 项 · ${knownSizes.length > 0 && Number.isSafeInteger(totalSize) ? `已知约 ${formatBytes(totalSize)}` : "大小待确定"}`
      : `预计文件大小：${bytes === null ? "暂无法估算" : `约 ${formatBytes(bytes)}`}`;

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
  const subtitleTracks = mediaInfo?.playlist
    ? Object.values(series.details).flatMap((item) => item.subtitles ?? [])
    : (mediaInfo?.subtitles ?? []);
  return (
    <main
      className="download-page"
      hidden={!active}
      style={active ? undefined : { display: "none" }}
    >
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
                  disabled={loadingDefaults || !!defaultsError || isStartingDownload}
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

              {defaultsError && (
                <Alert color="red" title="无法读取下载选项" role="alert">
                  {defaultsError}
                  <Button variant="subtle" onClick={retryDefaults}>
                    重新读取下载选项
                  </Button>
                </Alert>
              )}

              {requestError && (
                <Alert
                  color="red"
                  icon={<IconAlertCircle size={18} />}
                  title="操作未完成"
                  role="alert"
                  aria-live="assertive"
                >
                  {requestError}
                </Alert>
              )}
              {queuedNotice && (
                <Alert color="yellow" role="status">
                  {queuedNotice}
                  <Button variant="subtle" onClick={() => navigate("/tasks")}>
                    查看任务
                  </Button>
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
                  aria-label="系列画质策略"
                  className="download-quality-panel"
                  withBorder
                  radius="md"
                  p="md"
                >
                  <Stack gap="sm">
                    <Title order={3}>系列画质策略</Title>
                    <Text size="sm" c="dimmed">
                      分辨率和 FPS 可选
                      Best；格式与编码自动推荐，也可手动指定。少数例外可点右侧“单独设置”。
                    </Text>
                    <PlaylistQualityFields
                      value={quality}
                      audioOnly={audioOnly}
                      disabled={isStartingDownload}
                      onChange={(value) => {
                        setQuality(value);
                        setPlaylistConfirmed(false);
                      }}
                    />
                    <Text size="xs" c="dimmed">
                      已单独设置 {Object.keys(qualityOverrides).length} 项；其余跟随统一策略。
                    </Text>
                  </Stack>
                </Paper>
              )}
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
                        : `检测到 ${mediaInfo.playlist.totalCount ?? playlistEntries.length} 项，分 P 展开后最多展示 50 个可下载文件，可分别勾选。`}
                    </Text>
                    <Group justify="space-between" gap="xs">
                      <Text size="xs" c="dimmed" role="status">
                        {series.loading ? "正在读取标题与格式" : "条目详情"}：{series.done}/
                        {mediaInfo.playlist.entries.filter((entry) => entry.available).length}{" "}
                        个合集条目（分 P 独立读取，不下载媒体）
                      </Text>
                      {series.loading ? (
                        <Button variant="subtle" size="compact-xs" onClick={series.stop}>
                          停止后续读取
                        </Button>
                      ) : (
                        <Button
                          variant="subtle"
                          size="compact-xs"
                          disabled={isStartingDownload}
                          onClick={series.reload}
                        >
                          重新读取详情
                        </Button>
                      )}
                    </Group>
                    {(series.error || series.matchError) && (
                      <Text size="xs" c="red" role="alert">
                        {series.error || series.matchError}
                      </Text>
                    )}
                    <div
                      className="download-playlist-list"
                      role="group"
                      aria-label="可选视频条目"
                      tabIndex={0}
                    >
                      {playlistEntries.map((entry, offset) => {
                        const details = series.details[entry.index];
                        const matched = series.matches.find((row) => row.index === entry.index);
                        const tracks = matched?.formatId
                          ?.split("+")
                          .map((id) => details?.formats.find((format) => format.formatId === id));
                        const videoTrack = tracks?.find(
                          (format) => format?.videoCodec && format.videoCodec !== "none",
                        );
                        const audioTrack = tracks?.find(
                          (format) => format?.audioCodec && format.audioCodec !== "none",
                        );
                        const videoSpec = videoTrack
                          ? ` · ${videoTrack.fps ? `${Number(videoTrack.fps.toFixed(3))} fps · ` : ""}${videoTrack.extension} · ${codecLabel(videoTrack.videoCodec)}`
                          : "";
                        const audioSpec = audioTrack
                          ? ` · ${audioTrack.extension} · ${codecLabel(audioTrack.audioCodec)}`
                          : "";
                        const bitrate = (value: number | null) =>
                          value === null ? "未知" : `${Math.round(value)} kbps`;
                        const info =
                          details?.error ??
                          matched?.error ??
                          (matched?.formatId
                            ? `${audioOnly ? "MP3" : `${matched.resolution ?? "分辨率未知"}${videoSpec}`} · ${audioOnly ? "" : `视频 ${bitrate(matched.videoBitrateKbps)} · `}音频 ${bitrate(matched.audioBitrateKbps)}${audioSpec} · ${matched.bytes === null ? "大小待定" : `约 ${formatBytes(matched.bytes)}`}${matched.fallbackUsed ? " · 已回退 Best（未满足指定条件）" : ""}`
                            : details
                              ? "正在匹配规格…"
                              : "等待读取标题与格式…");
                        return (
                          <div className="download-playlist-row" key={`${entry.index}-${offset}`}>
                            <Checkbox
                              label={`${entryLabel(entry)} · ${details?.title ?? entry.title}`}
                              description={
                                <>
                                  {entry.part && (
                                    <Text component="span" display="block" size="xs" c="dimmed">
                                      {entry.parentTitle} · 共 {entry.part.partCount} 个分 P
                                    </Text>
                                  )}
                                  <span>{`视频 ID：${details?.id ?? entry.id ?? "待解析"}`}</span>
                                  <Text
                                    component="span"
                                    display="block"
                                    size="xs"
                                    c={
                                      details?.error || matched?.error
                                        ? "red"
                                        : matched?.fallbackUsed
                                          ? "orange"
                                          : "dimmed"
                                    }
                                  >
                                    {info}
                                    {qualityOverrides[entry.index] ? " · 单独策略" : ""}
                                  </Text>
                                </>
                              }
                              checked={chosenEntries.some((chosen) => chosen.index === entry.index)}
                              disabled={!entry.available || isStartingDownload}
                              onChange={(event) => {
                                const checked = event.currentTarget.checked;
                                changePlaylistItems(
                                  checked
                                    ? [
                                        ...new Set([
                                          ...chosenEntries.map((e) => e.index),
                                          entry.index,
                                        ]),
                                      ]
                                    : chosenEntries
                                        .filter((e) => e.index !== entry.index)
                                        .map((e) => e.index),
                                );
                              }}
                            />
                            <Button
                              type="button"
                              variant="subtle"
                              size="compact-xs"
                              aria-label={`${entryLabel(entry)}单独设置`}
                              disabled={!entry.available || isStartingDownload}
                              onClick={() => setEditingQuality(entry.index)}
                            >
                              单独设置
                            </Button>
                          </div>
                        );
                      })}
                      {!playlistEntries.length && (
                        <Text c="dimmed" size="sm">
                          未返回可选条目，请重新解析链接。
                        </Text>
                      )}
                    </div>
                    {seriesReady && matchedCount < chosenEntries.length && (
                      <Text c="orange" size="xs">
                        {chosenEntries.length - matchedCount}{" "}
                        项未匹配，将跳过；请单独调整、重新读取或取消勾选。
                      </Text>
                    )}
                    <Checkbox
                      checked={playlistConfirmed}
                      disabled={!seriesReady || !matchedCount || isStartingDownload}
                      onChange={(event) => setPlaylistConfirmed(event.currentTarget.checked)}
                      label={`我确认下载匹配的 ${matchedCount} 项`}
                    />
                  </Stack>
                </Paper>
              )}
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
                </Text>
                <Group className="download-action-buttons" gap="sm" wrap="nowrap">
                  <Button
                    type="button"
                    variant="default"
                    disabled={isStartingDownload || loadingDefaults || !!defaultsError}
                    onClick={() => setAdvancedOpen(true)}
                  >
                    高级设置
                  </Button>
                  <Button
                    type="button"
                    onClick={handleStartDownload}
                    loading={isStartingDownload}
                    disabled={
                      !selection ||
                      (mediaInfo.playlist &&
                        (!playlistConfirmed || !seriesReady || !matchedCount)) ||
                      (writeAutomaticSubtitles && subtitleLanguages.length === 0)
                    }
                  >
                    开始下载
                  </Button>
                </Group>
              </Group>
            </div>
          )}
        </Stack>
      </Paper>
      {advancedOpen && (
        <DownloadOptionsModal
          opened={active}
          value={advancedOptions}
          subtitleTracks={subtitleTracks}
          subtitleScope={mediaInfo?.playlist ? "series" : "video"}
          audioOnlyRequired={
            !!mediaInfo && !mediaInfo.playlist && videos.length === 0 && audios.length > 0
          }
          onClose={() => setAdvancedOpen(false)}
          onApply={(next) => {
            setAdvancedOptions(next);
            setPlaylistConfirmed(false);
            if (next.audioOnly !== audioOnly) {
              setSelectedAudioId(AUTOMATIC_AUDIO);
              setManualAudio(false);
            }
          }}
        />
      )}
      {editingQuality !== null && editingEntry && (
        <PlaylistQualityModal
          opened={active}
          index={editingQuality}
          label={entryLabel(editingEntry)}
          value={qualityOverrides[editingQuality] ?? quality}
          audioOnly={audioOnly}
          onClose={() => setEditingQuality(null)}
          onApply={(value) => {
            setQualityOverrides((current) => ({ ...current, [editingQuality]: value }));
            setPlaylistConfirmed(false);
          }}
          onInherit={() => {
            setQualityOverrides((current) => {
              const next = { ...current };
              delete next[editingQuality];
              return next;
            });
            setPlaylistConfirmed(false);
          }}
        />
      )}
    </main>
  );
}
