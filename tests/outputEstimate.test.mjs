import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPlaylistSizes,
  estimateOutputBytes,
  summarizePlaylistBytes,
} from "../src/features/download/outputEstimate.ts";

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

test("series totals follow only selected original indices, preserving unknown counts", () => {
  const requested = [
    { index: 2, id: "two" },
    { index: 9, id: "nine" },
  ];
  const cache = applyPlaylistSizes({}, requested, [
    { index: 2, id: "two", bytes: 100 },
    { index: 9, id: "nine", bytes: null },
    { index: 1, id: "extra", bytes: 9999 },
  ]);
  assert.deepEqual(summarizePlaylistBytes(requested, cache), {
    knownBytes: 100,
    unknownCount: 1,
    knownCount: 1,
  });
  assert.deepEqual(summarizePlaylistBytes([requested[0]], cache), {
    knownBytes: 100,
    unknownCount: 0,
    knownCount: 1,
  });
  assert.deepEqual(summarizePlaylistBytes([], cache), {
    knownBytes: null,
    unknownCount: 0,
    knownCount: 0,
  });
});

test("changed IDs, duplicate responses, unsafe byte counts and total overflow stay unknown", () => {
  const entries = [
    { index: 1, id: "a" },
    { index: 2, id: "b" },
  ];
  for (const responses of [
    [{ index: 1, id: "changed", bytes: 100 }],
    [
      { index: 1, id: "a", bytes: 100 },
      { index: 1, id: "a", bytes: 100 },
    ],
    [{ index: 1, id: "a", bytes: Number.MAX_SAFE_INTEGER + 1 }],
  ])
    assert.equal(
      summarizePlaylistBytes(entries, applyPlaylistSizes({}, entries, responses)).knownBytes,
      null,
    );
  const cache = applyPlaylistSizes(
    {},
    entries,
    entries.map((item) => ({ ...item, bytes: Number.MAX_SAFE_INTEGER })),
  );
  assert.deepEqual(summarizePlaylistBytes(entries, cache), {
    knownBytes: null,
    unknownCount: 2,
    knownCount: 0,
  });
});
