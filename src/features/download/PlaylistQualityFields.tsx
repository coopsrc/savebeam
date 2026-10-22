import { Button, Checkbox, Divider, Group, Select, SimpleGrid, Stack, Text } from "@mantine/core";
import type { PlaylistQuality } from "../../types/domain";

const best = { value: "best", label: "Best（最佳可用）" };
const numbers = (values: number[], unit: string) => [
  best,
  ...values.map((value) => ({ value: String(value), label: `${value}${unit}` })),
];
const automatic = (preferred: string) => ({
  value: "auto",
  label: `自动推荐（优先 ${preferred}）`,
});
const extensions = (values: string[], preferred: string) => [
  automatic(preferred),
  ...values.map((value) => ({ value, label: value })),
];

// Selected options reserve room for a checkmark in addition to their full label.
const qualitySelectPresentation = {
  comboboxProps: { withinPortal: true },
  styles: {
    dropdown: { minWidth: 260, maxWidth: "calc(100vw - 24px)" },
    option: { whiteSpace: "nowrap" as const },
  },
};

export function PlaylistQualityFields({
  value,
  onChange,
  audioOnly,
  disabled = false,
}: {
  value: PlaylistQuality;
  onChange: (value: PlaylistQuality) => void;
  audioOnly: boolean;
  disabled?: boolean;
}) {
  const setNumber = (
    key: "resolutionHeight" | "frameRate" | "maxAudioBitrateKbps",
    v: string | null,
  ) => onChange({ ...value, [key]: !v || v === "best" ? null : Number(v) });
  const setText = (
    key: "videoExtension" | "videoCodec" | "audioExtension" | "audioCodec",
    v: string | null,
  ) => onChange({ ...value, automaticRecommendations: true, [key]: !v || v === "auto" ? null : v });
  return (
    <Stack gap="sm">
      <Stack component="section" aria-label="视频选择策略" gap="xs">
        <Group justify="space-between">
          <Text fw={600}>视频</Text>
          <Button
            size="compact-xs"
            variant="subtle"
            aria-label="视频恢复默认"
            disabled={disabled || audioOnly}
            onClick={() =>
              onChange({
                ...value,
                automaticRecommendations: true,
                resolutionHeight: null,
                frameRate: null,
                videoExtension: null,
                videoCodec: null,
                maxHeight: null,
                maxVideoBitrateKbps: null,
              })
            }
          >
            恢复默认
          </Button>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <Select
            {...qualitySelectPresentation}
            label="分辨率"
            data={numbers([4320, 2160, 1440, 1080, 720, 480, 360, 240, 144], "p")}
            value={String(value.resolutionHeight ?? "best")}
            onChange={(v) => setNumber("resolutionHeight", v)}
            allowDeselect={false}
            disabled={disabled || audioOnly}
          />
          <Select
            {...qualitySelectPresentation}
            label="帧率（FPS）"
            data={numbers([240, 144, 120, 100, 90, 60, 50, 48, 30, 25, 24, 15], " fps")}
            value={String(value.frameRate ?? "best")}
            onChange={(v) => setNumber("frameRate", v)}
            allowDeselect={false}
            disabled={disabled || audioOnly}
          />
          <Select
            {...qualitySelectPresentation}
            label="视频格式"
            data={extensions(["mp4", "webm", "mkv", "mov", "flv", "ts", "m4v"], "MP4")}
            value={value.videoExtension ?? "auto"}
            onChange={(v) => setText("videoExtension", v)}
            allowDeselect={false}
            disabled={disabled || audioOnly}
          />
          <Select
            {...qualitySelectPresentation}
            label="视频编码"
            data={[
              automatic("HEVC"),
              { value: "h264", label: "H.264 / AVC" },
              { value: "hevc", label: "H.265 / HEVC" },
              { value: "av1", label: "AV1" },
              { value: "vp9", label: "VP9" },
              { value: "vp8", label: "VP8" },
              { value: "mpeg4", label: "MPEG-4" },
            ]}
            value={value.videoCodec ?? "auto"}
            onChange={(v) => setText("videoCodec", v)}
            allowDeselect={false}
            disabled={disabled || audioOnly}
          />
        </SimpleGrid>
      </Stack>
      <Divider />
      <Stack component="section" aria-label="音频选择策略" gap="xs">
        <Group justify="space-between">
          <Text fw={600}>音频</Text>
          <Button
            size="compact-xs"
            variant="subtle"
            aria-label="音频恢复默认"
            disabled={disabled}
            onClick={() =>
              onChange({
                ...value,
                automaticRecommendations: true,
                audioExtension: null,
                audioCodec: null,
                maxAudioBitrateKbps: null,
              })
            }
          >
            恢复默认
          </Button>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
          <Select
            {...qualitySelectPresentation}
            label="音频格式"
            data={extensions(
              ["m4a", "webm", "mp3", "ogg", "opus", "flac", "wav", "mp4", "aac"],
              "M4A",
            )}
            value={value.audioExtension ?? "auto"}
            onChange={(v) => setText("audioExtension", v)}
            allowDeselect={false}
            disabled={disabled}
          />
          <Select
            {...qualitySelectPresentation}
            label="音频编码"
            data={[
              automatic("AAC"),
              ...["aac", "opus", "vorbis", "mp3", "flac", "alac", "ac3", "eac3", "pcm"].map(
                (codec) => ({ value: codec, label: codec.toUpperCase() }),
              ),
            ]}
            value={value.audioCodec ?? "auto"}
            onChange={(v) => setText("audioCodec", v)}
            allowDeselect={false}
            disabled={disabled}
          />
          <Select
            {...qualitySelectPresentation}
            label="音频码率"
            data={[
              best,
              ...[1536, 512, 320, 256, 192, 160, 128, 96, 64, 32].map((rate) => ({
                value: String(rate),
                label: `≤ ${rate} kbps`,
              })),
            ]}
            value={String(value.maxAudioBitrateKbps ?? "best")}
            onChange={(v) => setNumber("maxAudioBitrateKbps", v)}
            allowDeselect={false}
            disabled={disabled}
          />
        </SimpleGrid>
      </Stack>
      <Checkbox
        label="无匹配时允许回退 Best"
        description="默认严格匹配所选条件，无匹配则跳过。勾选后可忽略条件使用 Best，并在条目标明。"
        checked={value.allowExceed}
        onChange={(event) => onChange({ ...value, allowExceed: event.currentTarget.checked })}
        disabled={disabled}
      />
      <Text size="xs" c="dimmed">
        分辨率按源视频高度匹配；30/60 FPS 包含 29.97/59.94
        等近似帧率。格式和编码指源轨道，不转码；最终容器按音视频兼容性决定。音频码率在上限内选最佳；MP3
        模式只应用音频条件，转换后大小待定。 自动推荐在同等分辨率与 FPS 下优先 MP4、HEVC，音频优先
        M4A、AAC；没有推荐项时自动选其他可用项，不因此跳过。
      </Text>
    </Stack>
  );
}
