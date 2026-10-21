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
import { IconAlertCircle, IconLink, IconPhotoOff, IconSearch } from "@tabler/icons-react";
import { IpcError } from "../../ipc/client";
import type { DownloadOptions, DownloadTask, MediaInfo } from "../../types/domain";
import { useNavigate } from "react-router-dom";
import { invokeCommand } from "../../ipc/client";
import { useAppStore } from "../../stores/appStore";
import { inspectMedia } from "./mediaApi";
import { getMediaUrlError, validateMediaUrl } from "./validateMediaUrl";
import { estimateOutputBytes } from "./outputEstimate";
import { formatBytes } from "../../utils/formatBytes";
import { outputPreview, selectedEntries } from "./outputPreview";
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
  const [url, setUrl] = useState("");
  const [hasSubmitted, setHasSubmitted] = useState(false);
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

    const checked = validateMediaUrl(url);
    if (!checked.valid) return;

    setIsInspecting(true);
    try {
      const result = await inspectMedia(checked.normalizedUrl);
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

  const selection = mediaInfo
    ? selectDownload(mediaInfo, selectedVideoId, selectedAudioId, audioOnly)
    : null;
  const automaticSelection = mediaInfo
    ? selectDownload(mediaInfo, selectedVideoId, AUTOMATIC_AUDIO, audioOnly)
    : null;
  const estimatedBytes = selection ? estimateOutputBytes(selection, audioOnly) : null;
  const playlistEntries = mediaInfo?.playlist?.entries ?? [];
  const chosenEntries = mediaInfo?.playlist
    ? selectedEntries(mediaInfo.playlist, playlistItems)
    : [];
  const preview =
    mediaInfo && selection ? outputPreview(mediaInfo, selection.extension, playlistItems) : null;
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
                      {mediaInfo.thumbnailDataUrl && !thumbnailFailed ? (
                        <Image
                          src={mediaInfo.thumbnailDataUrl}
                          alt="视频封面"
                          w={180}
                          h={102}
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
                      <Paper component="section" aria-label="选择系列视频" withBorder p="sm">
                        <Stack gap="sm">
                          <Group justify="space-between">
                            <Text fw={600}>选择下载条目（已选 {chosenEntries.length} 项）</Text>
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
                          <Stack gap="sm" mah={240} style={{ overflowY: "auto" }}>
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
                          </Stack>
                          <Checkbox
                            checked={playlistConfirmed}
                            disabled={chosenEntries.length === 0}
                            onChange={(event) => setPlaylistConfirmed(event.currentTarget.checked)}
                            label={`我确认下载所选 ${chosenEntries.length} 项`}
                          />
                        </Stack>
                      </Paper>
                    ) : videos.length > 0 || audios.length > 0 ? (
                      <Stack gap="sm">
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
                    )}
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
                    <Text size="sm" c="dimmed">
                      登录 Cookie 在“设置 → Cookie 与登录”中配置，全局用于解析媒体信息与下载。
                    </Text>
                    <Text size="xs" c="dimmed">
                      保存位置：默认下载目录，可在设置中更改。部分后处理选项需要 FFmpeg。
                    </Text>
                    <Text size="xs" c="dimmed">
                      {mediaInfo.playlist
                        ? "保存结构：系列名称 [系列ID]/序号-视频标题 [视频ID].扩展名"
                        : "保存结构：视频标题 [视频ID].扩展名"}
                      。字幕、封面和 JSON 使用相同前缀；缺失的 ID 将省略。
                    </Text>
                    {selection && (
                      <Paper
                        component="section"
                        aria-label="预计输出"
                        withBorder
                        radius="sm"
                        p="sm"
                        mih={mediaInfo.playlist ? 340 : 200}
                        aria-live="polite"
                      >
                        <Text fw={600} size="sm">
                          预计输出：
                          {selection.extension
                            ? `${selection.extension.toUpperCase()}（.${selection.extension}）`
                            : "逐项自动匹配"}
                        </Text>
                        {preview &&
                          (mediaInfo.playlist ? (
                            <>
                              <Text
                                size="sm"
                                lineClamp={2}
                                mih={40}
                                title={preview.directory ?? undefined}
                              >
                                保存子目录：{preview.directory}/
                              </Text>
                              <Text size="sm">
                                已选 {preview.files.length} 个文件，保留系列原始序号：
                              </Text>
                              <Stack
                                gap={4}
                                h={128}
                                style={{ overflowY: "auto" }}
                                aria-label="预计文件列表"
                              >
                                {preview.files.length ? (
                                  preview.files.map((name, index) => (
                                    <Text key={index} size="xs" title={name} truncate>
                                      {name}
                                    </Text>
                                  ))
                                ) : (
                                  <Text size="sm" c="dimmed">
                                    尚未选择下载条目
                                  </Text>
                                )}
                              </Stack>
                            </>
                          ) : (
                            <Text size="sm" lineClamp={2} mih={40} title={preview.files[0]}>
                              预计文件名：{preview.files[0]}
                            </Text>
                          ))}
                        <Text size="sm" c="dimmed">
                          {mediaInfo.playlist
                            ? audioOnly
                              ? "每项自动选择源音频并转换 MP3"
                              : "每项自动选择视频与音频"
                            : audioOnly
                              ? `${codecLabel(selection.audio?.audioCodec ?? null)} → MP3（转换音频）`
                              : `${codecLabel(selection.video?.videoCodec ?? null)}${selection.audio ? ` + ${codecLabel(selection.audio.audioCodec)}` : " · 无音频"}`}
                        </Text>
                        <Text size="sm">
                          预计文件大小：
                          {estimatedBytes !== null
                            ? `约 ${formatBytes(estimatedBytes)}`
                            : mediaInfo.playlist
                              ? "待逐项解析"
                              : audioOnly
                                ? "转换后待定"
                                : "暂无法估算"}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {mediaInfo.playlist
                            ? "输出格式和大小在各项解析后确定。"
                            : audioOnly
                              ? "转换后体积以实际生成的 MP3 为准。"
                              : selection.mergeContainer
                                ? "下载后合并，保留原始音视频编码。"
                                : "保留原始媒体格式。"}
                        </Text>
                        <Text size="xs" c="dimmed">
                          大小不含字幕、封面和 JSON，封装后可能略有差异。
                        </Text>
                        <Text size="xs" c="dimmed">
                          文件名为预览；标题、特殊字符清理和最终后缀以下载时 yt-dlp 解析结果为准。
                        </Text>
                      </Paper>
                    )}
                    <Group justify="flex-end">
                      <Button
                        onClick={handleStartDownload}
                        loading={isStartingDownload}
                        disabled={
                          !selection ||
                          (mediaInfo.playlist &&
                            (!playlistConfirmed || chosenEntries.length === 0)) ||
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
