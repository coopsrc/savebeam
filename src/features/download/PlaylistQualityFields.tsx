import { Checkbox, Select, Stack, Text } from "@mantine/core";
import type { PlaylistQuality } from "../../types/domain";

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
  const options = (values: number[], unit: string) => [
    { value: "auto", label: "不限（最佳可用）" },
    ...values.map((v) => ({ value: String(v), label: `${v} ${unit}` })),
  ];
  const set = (
    key: "maxHeight" | "maxVideoBitrateKbps" | "maxAudioBitrateKbps",
    v: string | null,
  ) => onChange({ ...value, [key]: !v || v === "auto" ? null : Number(v) });
  return (
    <Stack gap="sm">
      <Select
        label="分辨率上限"
        data={options([4320, 2160, 1440, 1080, 720, 480, 360, 240, 144], "p")}
        value={String(value.maxHeight ?? "auto")}
        onChange={(v) => set("maxHeight", v)}
        allowDeselect={false}
        disabled={disabled || audioOnly}
      />
      <Select
        label="视频码率上限"
        data={options([50000, 20000, 12000, 8000, 5000, 3000, 2000, 1000, 500], "kbps")}
        value={String(value.maxVideoBitrateKbps ?? "auto")}
        onChange={(v) => set("maxVideoBitrateKbps", v)}
        allowDeselect={false}
        disabled={disabled || audioOnly}
      />
      <Select
        label="音频码率上限"
        data={options([1536, 512, 320, 256, 192, 160, 128, 96, 64, 32], "kbps")}
        value={String(value.maxAudioBitrateKbps ?? "auto")}
        onChange={(v) => set("maxAudioBitrateKbps", v)}
        allowDeselect={false}
        disabled={disabled}
      />
      <Checkbox
        label="无匹配时允许超限回退"
        description="默认只选上限内最佳格式，缺档向下；无匹配则跳过。允许超限后使用最佳可用格式，并在条目标明。"
        checked={value.allowExceed}
        onChange={(event) => onChange({ ...value, allowExceed: event.currentTarget.checked })}
        disabled={disabled}
      />
      <Text size="xs" c="dimmed">
        仅筛选源格式，不转码降分辨率或压制码率。码率未知不视为符合上限；MP3
        模式只应用音频上限，转换后大小待定。
      </Text>
    </Stack>
  );
}
