import { Checkbox, Stack, TagsInput } from "@mantine/core";
import type { DownloadOptionDefaults } from "../../types/domain";

export function DownloadOptionFields({
  value,
  onChange,
  disabled = false,
  audioOnlyRequired = false,
  subtitleOptions = [],
}: {
  value: DownloadOptionDefaults;
  onChange: (value: DownloadOptionDefaults) => void;
  disabled?: boolean;
  audioOnlyRequired?: boolean;
  subtitleOptions?: { value: string; label: string }[];
}) {
  return (
    <Stack gap="md">
      <Checkbox
        label="仅下载音频（MP3）"
        description="需要 FFmpeg 和 ffprobe 进行音频提取与转换。"
        checked={value.audioOnly}
        disabled={disabled || audioOnlyRequired}
        onChange={(event) => onChange({ ...value, audioOnly: event.currentTarget.checked })}
      />
      <TagsInput
        label="下载字幕"
        placeholder="输入语言代码后回车，如 en、zh-Hans"
        description="留空不下载。最多 10 种；系列按每项提供的字幕匹配，无对应字幕时跳过。"
        data={subtitleOptions.map((item) => item.value)}
        value={value.subtitleLanguages}
        maxTags={10}
        disabled={disabled}
        clearable
        acceptValueOnBlur
        onChange={(languages) =>
          onChange({
            ...value,
            subtitleLanguages: languages,
            writeAutomaticSubtitles: languages.length > 0 && value.writeAutomaticSubtitles,
          })
        }
      />
      <Checkbox
        label="同时下载自动生成的字幕"
        checked={value.writeAutomaticSubtitles}
        disabled={disabled || !value.subtitleLanguages.length}
        onChange={(event) =>
          onChange({ ...value, writeAutomaticSubtitles: event.currentTarget.checked })
        }
      />
      <Checkbox
        label="另存缩略图文件"
        checked={value.writeThumbnail}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, writeThumbnail: event.currentTarget.checked })}
      />
      <Checkbox
        label="另存媒体信息 JSON"
        checked={value.writeInfoJson}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, writeInfoJson: event.currentTarget.checked })}
      />
      <Checkbox
        label="将媒体元数据写入文件"
        checked={value.embedMetadata}
        disabled={disabled}
        onChange={(event) => onChange({ ...value, embedMetadata: event.currentTarget.checked })}
      />
      <Checkbox
        label="保留中间文件"
        checked={value.keepIntermediateFiles}
        disabled={disabled}
        description="保留合并或转换前的源文件，会占用额外空间；分轨文件按格式 ID、编码、分辨率和码率命名。"
        onChange={(event) =>
          onChange({ ...value, keepIntermediateFiles: event.currentTarget.checked })
        }
      />
    </Stack>
  );
}
