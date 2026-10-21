import assert from "node:assert/strict";
import test from "node:test";
import {
  AUTOMATIC_AUDIO,
  audioFormats,
  selectDownload,
  videoFormats,
} from "../src/features/download/formatSelection.ts";

const stream = (formatId, extension, videoCodec, audioCodec, overrides = {}) => ({
  formatId,
  extension,
  videoCodec,
  audioCodec,
  resolution: null,
  fps: null,
  audioBitrateKbps: null,
  language: null,
  formatNote: null,
  fileSizeBytes: null,
  approximateFileSizeBytes: null,
  ...overrides,
});
const aac = stream("140", "m4a", null, "mp4a.40.2");
const opus = stream("251", "webm", null, "opus");
const h264 = stream("137", "mp4", "avc1.640028", null);
const vp9 = stream("248", "webm", "vp9", null);
const muxed = stream("18", "mp4", "avc1", "mp4a.40.2");
const media = (formats) => ({ formats, playlist: null });

test("default video excludes audio and storyboards, preserving yt-dlp quality preference", () => {
  const formats = [aac, opus, stream("storyboard", "mhtml", "images", null), muxed, h264];
  const videos = videoFormats(formats);
  assert.deepEqual(
    videos.map((item) => item.formatId),
    ["137", "18"],
  );
  assert.equal(formats[0], aac);
});

test("automatic audio preserves MP4 compatibility even when another codec is ranked higher", () => {
  const result = selectDownload(media([aac, opus, h264]), "137", AUTOMATIC_AUDIO, false);
  assert.equal(result.formatId, "137+140");
  assert.equal(result.mergeContainer, "mp4");
  assert.equal(result.extension, "mp4");
});

test("manual audio selection changes the persisted combination and expected container", () => {
  const result = selectDownload(media([aac, opus, h264]), "137", "251", false);
  assert.equal(result.formatId, "137+251");
  assert.equal(result.mergeContainer, "mkv");
  assert.equal(result.extension, "mkv");
});

test("VP9 selects compatible Opus audio and predicts WebM", () => {
  const result = selectDownload(media([opus, aac, vp9]), "248", AUTOMATIC_AUDIO, false);
  assert.equal(result.formatId, "248+251");
  assert.equal(result.mergeContainer, "webm");
});

test("muxed video uses its included audio and original extension without another merge", () => {
  const result = selectDownload(media([opus, muxed]), "18", AUTOMATIC_AUDIO, false);
  assert.equal(result.formatId, "18");
  assert.equal(result.mergeContainer, null);
  assert.equal(result.extension, "mp4");
  assert.equal(result.audio.formatId, "18");
});

test("MP3 conversion honors the manually selected source audio", () => {
  const result = selectDownload(media([aac, opus, h264]), "137", "140", true);
  assert.equal(result.formatId, "140");
  assert.equal(result.extension, "mp3");
  assert.equal(result.mergeContainer, null);
  assert.equal(result.video, null);
});

test("audio extraction can use a muxed source when no independent audio exists", () => {
  assert.deepEqual(audioFormats([muxed]), []);
  assert.deepEqual(audioFormats([muxed], true), [muxed]);
  const result = selectDownload(media([muxed]), "18", AUTOMATIC_AUDIO, true);
  assert.equal(result.formatId, "18");
  assert.equal(result.extension, "mp3");
});

test("missing audio is explicit and stale format choices cannot start downloads", () => {
  const result = selectDownload(media([h264]), "137", AUTOMATIC_AUDIO, false);
  assert.equal(result.audio, null);
  assert.equal(result.formatId, "137");
  assert.equal(selectDownload(media([aac, h264]), "137", "missing", false), null);
  assert.equal(selectDownload(media([h264]), "137", AUTOMATIC_AUDIO, true), null);
});

test("playlist selections are automatic per item instead of reusing one item's IDs", () => {
  const result = selectDownload(
    { formats: [], playlist: { downloadCount: 2 } },
    null,
    AUTOMATIC_AUDIO,
    false,
  );
  assert.equal(result.formatId, "bestvideo+bestaudio/best");
  assert.equal(result.extension, null);
});
