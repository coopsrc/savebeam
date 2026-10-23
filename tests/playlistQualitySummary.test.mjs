import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PLAYLIST_QUALITY,
  summarizePlaylistQuality,
} from "../src/features/download/playlistQuality.ts";

test("collapsed policy keeps quality best separate from format and codec recommendations", () => {
  assert.deepEqual(summarizePlaylistQuality(DEFAULT_PLAYLIST_QUALITY, false), {
    video: "Best 分辨率 · Best FPS · 推荐 MP4 · 推荐 HEVC",
    audio: "推荐 M4A · 推荐 AAC · Best 码率",
  });
});

test("collapsed policy reflects specified parameters, legacy constraints and MP3 source choices", () => {
  const policy = {
    ...DEFAULT_PLAYLIST_QUALITY,
    resolutionHeight: 1080,
    frameRate: 60,
    videoExtension: "webm",
    videoCodec: "vp9",
    audioExtension: "webm",
    audioCodec: "opus",
    maxAudioBitrateKbps: 128,
    maxHeight: 2160,
    maxVideoBitrateKbps: 8000,
  };
  assert.deepEqual(summarizePlaylistQuality(policy, false), {
    video: "1080p · 60 FPS · WEBM · VP9 · 高度 ≤ 2160p · 码率 ≤ 8000 kbps",
    audio: "WEBM · OPUS · ≤ 128 kbps",
  });
  assert.deepEqual(summarizePlaylistQuality(policy, true), {
    video: "不下载（仅音频）",
    audio: "WEBM · OPUS · ≤ 128 kbps · 下载后转为 MP3",
  });
  assert.equal(
    summarizePlaylistQuality(
      { ...DEFAULT_PLAYLIST_QUALITY, automaticRecommendations: false },
      false,
    ).audio,
    "不限 · 不限 · Best 码率",
  );
});
