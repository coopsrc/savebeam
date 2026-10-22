import assert from "node:assert/strict";
import test from "node:test";
import {
  subtitleChoices,
  subtitleChoiceDescription,
  updateSubtitleSelection,
} from "../src/features/download/subtitleSelection.ts";

const track = (language, automatic = false, extension = "vtt") => ({
  language,
  name: null,
  extension,
  automatic,
});
test("subtitle choices aggregate source kinds and formats without duplicates or chat entries", () => {
  const choices = subtitleChoices(
    [
      track("en"),
      track("en", true),
      track("en", false, "srt"),
      track("live_chat"),
      track("bad,tag"),
    ],
    [],
    "video",
  );
  assert.equal(choices.length, 1);
  assert.equal(choices[0].manual, true);
  assert.equal(choices[0].automatic, true);
  assert.deepEqual(choices[0].formats, ["vtt", "srt"]);
  assert.match(subtitleChoiceDescription(choices[0], "video"), /人工字幕.*自动生成.*VTT.*SRT/);
});
test("video availability is not invented and saved missing choices remain explicitly visible", () => {
  const choices = subtitleChoices([track("en")], ["zh-Hans", "custom_tag"], "video");
  assert.equal(choices.length, 3);
  assert.equal(choices[1].available, false);
  assert.equal(subtitleChoiceDescription(choices[1], "video"), "本视频未提供，将跳过");
  assert.deepEqual(subtitleChoices([], [], "video"), []);
});
test("settings and series provide reusable preferences while available series tags are labelled", () => {
  const preferences = subtitleChoices([], [], "preferences");
  assert.ok(preferences.some((choice) => choice.language === "zh-Hans"));
  assert.ok(preferences.every((choice) => !choice.available));
  const series = subtitleChoices([track("ja", true)], [], "series");
  assert.match(subtitleChoiceDescription(series[0], "series"), /已读取条目可用.*自动生成/);
});
test("dropdown selections are immutable, distinct, bounded and cannot create unknown languages", () => {
  const selected = ["en"];
  const choices = subtitleChoices([track("en"), track("ja", true)], [], "preferences");
  assert.deepEqual(updateSubtitleSelection(choices, selected, ["en", "ja"], false), {
    subtitleLanguages: ["en", "ja"],
    writeAutomaticSubtitles: true,
  });
  assert.deepEqual(selected, ["en"]);
  assert.deepEqual(
    updateSubtitleSelection(
      choices,
      selected,
      ["en", "en", "--exec=bad", "not_a_known_option"],
      false,
    ).subtitleLanguages,
    ["en"],
  );
  assert.deepEqual(updateSubtitleSelection(choices, selected, [], true), {
    subtitleLanguages: [],
    writeAutomaticSubtitles: false,
  });
  const ten = Array.from({ length: 10 }, (_, i) => `lang-${i}`);
  const available = subtitleChoices([], ten, "preferences");
  assert.deepEqual(
    updateSubtitleSelection(available, ten, [...ten, "ja"], false).subtitleLanguages,
    ten,
  );
});
