import assert from "node:assert/strict";
import test from "node:test";
import { estimateOutputBytes } from "../src/features/download/outputEstimate.ts";

const video = {
  formatId: "137",
  fileSizeBytes: 100 * 1024 * 1024,
  approximateFileSizeBytes: 110 * 1024 * 1024,
};
const audio = { formatId: "140", fileSizeBytes: null, approximateFileSizeBytes: 5 * 1024 * 1024 };

test("merged size adds each selected stream, preferring known sizes over approximations", () => {
  assert.equal(estimateOutputBytes({ video, audio }, false), 105 * 1024 * 1024);
});

test("combined formats count once instead of doubling their included audio", () => {
  assert.equal(estimateOutputBytes({ video, audio: { ...video } }, false), 100 * 1024 * 1024);
});

test("missing either stream size cannot produce a misleading partial total", () => {
  assert.equal(
    estimateOutputBytes(
      { video, audio: { formatId: "140", fileSizeBytes: null, approximateFileSizeBytes: null } },
      false,
    ),
    null,
  );
});

test("video-only output can be estimated while MP3 conversion and playlists remain unknown", () => {
  assert.equal(estimateOutputBytes({ video, audio: null }, false), 100 * 1024 * 1024);
  assert.equal(estimateOutputBytes({ video: null, audio }, true), null);
  assert.equal(estimateOutputBytes({ video: null, audio: null }, false), null);
});

test("invalid upstream byte counts fall back to valid estimates or unknown", () => {
  assert.equal(
    estimateOutputBytes({ video: { ...video, fileSizeBytes: -1 }, audio: null }, false),
    110 * 1024 * 1024,
  );
  assert.equal(
    estimateOutputBytes(
      { video: { ...video, fileSizeBytes: Infinity, approximateFileSizeBytes: 0 }, audio: null },
      false,
    ),
    null,
  );
});
