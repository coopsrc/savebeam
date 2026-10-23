import { Checkbox, Group, MultiSelect, Pill, Stack, Text } from "@mantine/core";
import { IconCheck } from "@tabler/icons-react";
import type { DownloadOptionDefaults, SubtitleTrack } from "../../types/domain";
import {
  subtitleChoices,
  subtitleChoiceDescription,
  updateSubtitleSelection,
  type SubtitleScope,
} from "./subtitleSelection";

export function DownloadOptionFields({
  value,
  onChange,
  disabled = false,
  showAudioOnly = true,
  audioOnlyRequired = false,
  subtitleTracks = [],
  subtitleScope = "preferences",
}: {
  value: DownloadOptionDefaults;
  onChange: (value: DownloadOptionDefaults) => void;
  disabled?: boolean;
  showAudioOnly?: boolean;
  audioOnlyRequired?: boolean;
  subtitleTracks?: SubtitleTrack[];
  subtitleScope?: SubtitleScope;
}) {
  const choices = subtitleChoices(subtitleTracks, value.subtitleLanguages, subtitleScope);
  return (
    <Stack gap="md">
      {showAudioOnly && (
        <Checkbox
          label="仅下载音频（MP3）"
          description="需要 FFmpeg 和 ffprobe 进行音频提取与转换。"
          checked={value.audioOnly}
          disabled={disabled || audioOnlyRequired}
          onChange={(event) => onChange({ ...value, audioOnly: event.currentTarget.checked })}
        />
      )}
      <Stack component="section" aria-label="字幕选择" gap="xs">
        <MultiSelect
          label="下载字幕"
          description={`已选 ${value.subtitleLanguages.length}/10。不选则不下载；${subtitleScope === "video" ? "展示本视频字幕，未提供的默认语言会跳过。" : "按各视频实际提供的字幕匹配，无对应语言时跳过。"}`}
          placeholder={
            value.subtitleLanguages.length
              ? undefined
              : choices.length
                ? "选择或搜索字幕语言"
                : "本视频未返回可用字幕"
          }
          data={choices.map((choice) => ({
            value: choice.language,
            label: choice.label,
            disabled:
              value.subtitleLanguages.length >= 10 &&
              !value.subtitleLanguages.includes(choice.language),
          }))}
          value={value.subtitleLanguages}
          maxValues={10}
          searchable
          clearable
          clearButtonProps={{ "aria-label": "清空字幕选择", "aria-hidden": false, tabIndex: 0 }}
          disabled={disabled}
          maxDropdownHeight={220}
          nothingFoundMessage="没有匹配的字幕语言"
          comboboxProps={{ withinPortal: true }}
          styles={{ inputField: { minWidth: 32, flex: "1 1 48px" } }}
          renderPill={({ value: language, option, onRemove, disabled: pillDisabled }) => (
            <Pill
              withRemoveButton
              disabled={pillDisabled}
              onRemove={onRemove}
              removeButtonProps={{
                "aria-label": `移除字幕 ${language}`,
                "aria-hidden": false,
                tabIndex: 0,
              }}
              styles={{ root: { maxWidth: "100%" } }}
            >
              {option?.label ?? language}
            </Pill>
          )}
          renderOption={({ option, checked }) => {
            const choice = choices.find((item) => item.language === option.value)!;
            return (
              <Group gap="xs" wrap="nowrap" align="flex-start">
                <IconCheck
                  size={16}
                  aria-hidden
                  style={{
                    flexShrink: 0,
                    marginTop: 2,
                    visibility: checked ? "visible" : "hidden",
                  }}
                />
                <div>
                  <Text size="sm">{option.label}</Text>
                  <Text size="xs" c="dimmed">
                    {subtitleChoiceDescription(choice, subtitleScope)}
                  </Text>
                </div>
              </Group>
            );
          }}
          onChange={(languages) => {
            onChange({
              ...value,
              ...updateSubtitleSelection(
                choices,
                value.subtitleLanguages,
                languages,
                value.writeAutomaticSubtitles,
              ),
            });
          }}
        />
        {value.subtitleLanguages.length >= 10 && (
          <Text size="xs" c="dimmed">
            已选满 10 种；取消一项后可继续选择。
          </Text>
        )}
      </Stack>
      <Checkbox
        label="同时下载自动生成的字幕"
        description="同一语言优先人工字幕；仅有自动字幕的语言需开启此项。选择仅自动字幕的语言时会自动开启。"
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
