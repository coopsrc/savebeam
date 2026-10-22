import assert from "node:assert/strict";
import test from "node:test";
import {
  INITIAL_DOWNLOAD_OPTIONS,
  copyDownloadOptions,
  readDownloadOptions,
  validateDownloadOptions,
} from "../src/features/download/downloadOptionDefaults.ts";

test("initial advanced defaults are opt-in with no subtitles", () => {
  assert.equal(validateDownloadOptions(INITIAL_DOWNLOAD_OPTIONS), null);
  assert.ok(
    Object.entries(INITIAL_DOWNLOAD_OPTIONS).every(([key, value]) =>
      key === "subtitleLanguages" ? value.length === 0 : value === false,
    ),
  );
});
test("draft and task copies do not mutate global arrays or other tasks", () => {
  const saved = { ...INITIAL_DOWNLOAD_OPTIONS, subtitleLanguages: ["en"], writeThumbnail: true };
  const draft = copyDownloadOptions(saved);
  draft.subtitleLanguages.push("zh-Hans");
  draft.writeThumbnail = false;
  assert.deepEqual(saved.subtitleLanguages, ["en"]);
  assert.equal(saved.writeThumbnail, true);
  const task = copyDownloadOptions(draft);
  draft.subtitleLanguages.length = 0;
  assert.deepEqual(task.subtitleLanguages, ["en", "zh-Hans"]);
});
test("invalid data and automatic captions with no language cannot silently become defaults", () => {
  for (const value of [
    null,
    [],
    {},
    { ...INITIAL_DOWNLOAD_OPTIONS, audioOnly: "true" },
    { ...INITIAL_DOWNLOAD_OPTIONS, subtitleLanguages: [123] },
    { ...INITIAL_DOWNLOAD_OPTIONS, writeAutomaticSubtitles: true },
  ])
    assert.throws(() => readDownloadOptions(value));
});
test("subtitle language bounds reject option injection and excess length or count", () => {
  for (const languages of [
    ["--exec=bad"],
    ["en,zh"],
    ["en\n"],
    ["x".repeat(65)],
    Array.from({ length: 11 }, (_, index) => `lang-${index}`),
  ])
    assert.ok(
      validateDownloadOptions({ ...INITIAL_DOWNLOAD_OPTIONS, subtitleLanguages: languages }),
    );
  assert.equal(
    validateDownloadOptions({
      ...INITIAL_DOWNLOAD_OPTIONS,
      subtitleLanguages: ["en", "zh-Hans", "en.US"],
      writeAutomaticSubtitles: true,
    }),
    null,
  );
});
