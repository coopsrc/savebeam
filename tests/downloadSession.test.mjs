import assert from "node:assert/strict";
import test from "node:test";
import { resolveDownloadSession } from "../src/features/download/downloadSession.ts";
const route = (pathname = "/download", key = "one", search = "") => ({ pathname, key, search });
test("only started drafts survive sidebar navigation; unedited pages reload fresh defaults", () => {
  assert.equal(resolveDownloadSession(null, route("/settings")), null);
  const empty = resolveDownloadSession(null, route());
  assert.equal(resolveDownloadSession(empty, route("/settings")), null);
  const draft = { ...empty, retained: true };
  for (const path of ["/tasks", "/history", "/settings", "/subscriptions", "/download"])
    assert.equal(resolveDownloadSession(draft, route(path, path)), draft);
});
test("explicit source prefill creates a fresh session but returning to the same entry keeps edits", () => {
  const first = resolveDownloadSession(null, route());
  const draft = { ...first, retained: true };
  const source = route(
    "/download",
    "prefill",
    `?url=${encodeURIComponent("https://example.invalid/watch?id=one&part=2#x")}`,
  );
  const next = resolveDownloadSession(draft, source);
  assert.notEqual(next, draft);
  assert.equal(next.initialUrl, "https://example.invalid/watch?id=one&part=2#x");
  assert.equal(resolveDownloadSession(next, source), next);
  assert.equal(resolveDownloadSession(next, route("/download", "sidebar")), next);
  assert.notEqual(resolveDownloadSession(next, { ...source, key: "reparse-again" }), next);
});
test("completed drafts are consumed only when leaving and fresh prefill can explicitly clear input", () => {
  const draft = { ...resolveDownloadSession(null, route()), retained: true, consumed: true };
  assert.equal(resolveDownloadSession(draft, route()), draft);
  assert.equal(resolveDownloadSession(draft, route("/tasks")), null);
  assert.equal(resolveDownloadSession(draft, route("/settings")), null);
  const blank = resolveDownloadSession(draft, route("/download", "clear", "?url="));
  assert.equal(blank.initialUrl, "");
  assert.equal(blank.retained, true);
  assert.equal(blank.consumed, false);
  const recreated = resolveDownloadSession(null, route());
  assert.notEqual(
    recreated.identity,
    draft.identity,
    "old async callbacks cannot consume a new instance even if a history key is reused",
  );
});
