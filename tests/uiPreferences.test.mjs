import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  DEFAULT_UI_PREFERENCES,
  parseUiPreferences,
  resolveUiLocale,
} from "../src/app/uiPreferences.ts";
import { english } from "../src/i18n/english.ts";
import { t } from "../src/i18n/translate.ts";
import { useUiPreferences } from "../src/stores/uiPreferencesStore.ts";

test("UI preferences have safe defaults and accept only supported theme/language values", () => {
  assert.deepEqual(parseUiPreferences(null), DEFAULT_UI_PREFERENCES);
  assert.deepEqual(parseUiPreferences('{"theme":"dark","language":"en-US","tasks":[]}'), {
    theme: "dark",
    language: "en-US",
  });
  for (const value of [
    "null",
    "{}",
    "[]",
    "bad",
    '{"theme":["dark"],"language":"en-US"}',
    '{"theme":"light","language":"fr"}',
    '{"theme":"auto","language":"system"}',
  ])
    assert.throws(() => parseUiPreferences(value));
});
test("system language matches available locales and explicit choices always win", () => {
  assert.equal(resolveUiLocale("system", ["fr-FR", "zh-TW", "en-US"]), "zh-CN");
  assert.equal(resolveUiLocale("system", ["en-GB", "zh-CN"]), "en-US");
  assert.equal(resolveUiLocale("system", ["ja-JP"]), "en-US");
  assert.equal(resolveUiLocale("zh-CN", ["en-US"]), "zh-CN");
});
test("translation changes UI only and interpolates untrusted parameters as literal strings", () => {
  useUiPreferences.setState({ locale: "en-US" });
  const title = "<script>中文视频 $&</script>";
  assert.equal(t("第 {0} 项 · {1}", [13, title]), `Item 13 · ${title}`);
  assert.equal(t("不属于界面词条的视频标题"), "不属于界面词条的视频标题");
  useUiPreferences.setState({ locale: "zh-CN" });
  assert.equal(t("第 {0} 项", [13]), "第 13 项");
});
test("catalogue covers every literal UI message and preserves interpolation placeholders", () => {
  const visit = (dir) =>
    fs
      .readdirSync(dir, { withFileTypes: true })
      .flatMap((entry) =>
        entry.isDirectory() ? visit(path.join(dir, entry.name)) : [path.join(dir, entry.name)],
      );
  for (const file of visit("src").filter((f) => /\.tsx?$/.test(f))) {
    const source = ts.createSourceFile(
      file,
      fs.readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const scan = (node) => {
      if (
        ts.isCallExpression(node) &&
        node.expression.getText(source) === "t" &&
        ts.isStringLiteral(node.arguments[0])
      )
        assert.ok(
          Object.hasOwn(english, node.arguments[0].text),
          `${file}: missing ${node.arguments[0].text}`,
        );
      ts.forEachChild(node, scan);
    };
    scan(source);
  }
  const tokens = (s) => [...new Set(s.match(/\{\d+\}/g) ?? [])].sort();
  for (const [source, translated] of Object.entries(english))
    assert.deepEqual(tokens(translated), tokens(source), source);
});
