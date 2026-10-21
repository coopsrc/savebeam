import { useState, type FormEvent } from "react";
import {
  Alert,
  Button,
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
import type { MediaInfo } from "../../types/domain";
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
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<string | null>(null);
  const [selectedSubtitles, setSelectedSubtitles] = useState<string[]>([]);
  const [requestError, setRequestError] = useState<string | null>(null);
  const validation = hasSubmitted ? validateMediaUrl(url) : null;
  const validationError =
    validation && !validation.valid ? getMediaUrlError(validation.reason) : undefined;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setHasSubmitted(true);
    setRequestError(null);
    setMediaInfo(null);
    setSelectedFormat(null);
    setSelectedSubtitles([]);

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
    setRequestError(null);
    setHasSubmitted(false);
  }

  const formatOptions =
    mediaInfo?.formats.map((format) => ({
      value: format.formatId,
      label: formatLabel(format),
    })) ?? [];
  const subtitleOptions =
    mediaInfo?.subtitles.map((subtitle, index) => ({
      value: `${index}:${subtitle.language}:${subtitle.extension ?? ""}`,
      label: `${subtitle.name ?? subtitle.language} (${subtitle.language})${subtitle.automatic ? " · 自动字幕" : ""}${subtitle.extension ? ` · ${subtitle.extension}` : ""}`,
    })) ?? [];

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
                  aria-live="polite"
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
                    {formatOptions.length > 0 ? (
                      <Select
                        label="可用格式"
                        data={formatOptions}
                        value={selectedFormat}
                        onChange={setSelectedFormat}
                        allowDeselect={false}
                      />
                    ) : (
                      <Alert color="yellow" title="没有可选格式">
                        网站没有返回可供下载的媒体格式。
                      </Alert>
                    )}
                    {subtitleOptions.length > 0 && (
                      <MultiSelect
                        label="字幕（可选）"
                        placeholder="不下载字幕"
                        data={subtitleOptions}
                        value={selectedSubtitles}
                        onChange={setSelectedSubtitles}
                        searchable
                        clearable
                      />
                    )}
                    <Text size="xs" c="dimmed">
                      当前仅完成媒体信息解析和选项展示；下载队列将在后续里程碑接入。
                    </Text>
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
