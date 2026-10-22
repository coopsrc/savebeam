// Offline integration for the pinned IDs asserted by Rust's quality matcher tests.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
const run = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), "savebeam-quality-offline-"));
const info = {
  id: "offline",
  title: "Metadata before downloading",
  webpage_url: "https://example.invalid/video",
  extractor: "generic",
  extractor_key: "Generic",
  duration: 10,
  formats: [
    { format_id: "a128", ext: "m4a", vcodec: "none", acodec: "aac", abr: 128, filesize: 10 },
    { format_id: "a256", ext: "m4a", vcodec: "none", acodec: "aac", abr: 256, filesize: 20 },
    {
      format_id: "lower",
      ext: "mp4",
      vcodec: "avc1",
      acodec: "none",
      height: 480,
      vbr: 1000,
      filesize: 100,
    },
    {
      format_id: "higher",
      ext: "mp4",
      vcodec: "avc1",
      acodec: "none",
      height: 2160,
      vbr: 5000,
      filesize: 500,
    },
  ].map((format) => ({
    ...format,
    url: `https://example.invalid/${format.format_id}.${format.ext}`,
  })),
};
try {
  const path = join(directory, "fixture.info.json");
  await writeFile(path, JSON.stringify(info));
  for (const [selector, expected] of [
    ["lower+a128", ["lower", "a128"]],
    ["higher+a256", ["higher", "a256"]],
    ["a128", ["a128"]],
  ]) {
    const { stdout } = await run(
      process.argv[2],
      [
        "-m",
        "yt_dlp",
        "--ignore-config",
        "--no-cache-dir",
        "--proxy",
        "",
        "--simulate",
        "--skip-download",
        "--no-check-formats",
        "--load-info-json",
        path,
        "--format",
        selector,
        "--dump-single-json",
      ],
      { timeout: 15000, maxBuffer: 1024 * 1024 },
    );
    const raw = JSON.parse(stdout);
    assert.deepEqual(
      raw.requested_formats?.map((format) => format.format_id) ?? [raw.format_id],
      expected,
    );
    assert.equal(raw.title, info.title);
    process.stdout.write(
      `${selector}: exact stream IDs and title available without download passed\n`,
    );
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
