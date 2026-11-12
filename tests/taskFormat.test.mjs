import assert from "node:assert/strict";
import test from "node:test";
import { selectedFormatDetails, taskFormatLines } from "../src/features/tasks/taskFormat.ts";
import { selectDownload } from "../src/features/download/formatSelection.ts";
import { useUiPreferences } from "../src/stores/uiPreferencesStore.ts";

const video = {
  formatId: "100143",
  extension: "mp4",
  resolution: "1920x1080",
  height: 1080,
  fps: 29.97,
  videoCodec: "hvc1.1.6.L153",
  videoBitrateKbps: 1266.4,
  audioCodec: null,
};
const audio = {
  formatId: "30280",
  extension: "m4a",
  videoCodec: null,
  audioCodec: "mp4a.40.2",
  audioBitrateKbps: 128.1,
};
const selection = selectDownload({ formats: [audio, video] }, "100143", "30280", false);

test("numeric selectors display the actual selected streams, and a saved snapshot stays independent of metadata", () => {
  useUiPreferences.setState({ locale: "zh-CN" });
  const details = selectedFormatDetails(selection, false);
  const task = { formatId: selection.formatId, formatDetails: details };
  assert.deepEqual(taskFormatLines(task), [
    "视频：1920×1080 · 29.97 FPS · HEVC · 1266 kbps · MP4",
    "音频：AAC · 128 kbps · M4A",
  ]);
  const changed = { ...video, fps: 60, videoCodec: "av01" };
  assert.equal(selectedFormatDetails({ ...selection, video: changed }, false).fps, 60);
  assert.equal(details.fps, 29.97);
  assert.ok(!taskFormatLines(task).join(" ").includes("100143"));
  useUiPreferences.setState({ locale: "en-US" });
  assert.match(taskFormatLines(task)[0], /^Video: .*HEVC/);
  useUiPreferences.setState({ locale: "zh-CN" });
});

test("muxed, audio-only and unknown numeric fields never invent separate audio or converted MP3 bitrate", () => {
  const muxed = { ...video, audioCodec: "aac", audioBitrateKbps: 192 };
  const selected = selectDownload({ formats: [muxed] }, "100143", "savebeam:auto", false);
  assert.equal(selectedFormatDetails(selected, false).audioCodec, "aac");
  const mp3 = selectDownload({ formats: [audio] }, null, "30280", true);
  const rows = taskFormatLines({
    formatId: "30280",
    formatDetails: selectedFormatDetails(mp3, true),
  });
  assert.deepEqual(rows, ["输出：MP3", "源音频：AAC · 128 kbps · M4A"]);
  assert.equal(
    taskFormatLines({
      formatId: "v",
      formatDetails: {
        ...selectedFormatDetails(selection, false),
        fps: NaN,
        videoBitrateKbps: 0,
        audioBitrateKbps: null,
      },
    })
      .join(" ")
      .includes("NaN"),
    false,
  );
});

test("automatic and legacy selectors do not guess resolution or codecs from site-specific IDs", () => {
  assert.deepEqual(taskFormatLines({ formatId: "100143+30280" }), ["此旧任务未保存音视频参数"]);
  assert.deepEqual(taskFormatLines({ formatId: "bestvideo+bestaudio/best" }), [
    "自动选择音视频，下载时确定",
  ]);
  assert.deepEqual(taskFormatLines({ formatId: "bestaudio/best" }), ["自动选择音频，下载时确定"]);
});
