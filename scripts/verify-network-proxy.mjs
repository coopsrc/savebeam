// Real yt-dlp, loopback-only HTTP proxy; never requests YouTube or uses Cookies.
// node scripts/verify-network-proxy.mjs /path/to/python-with-yt-dlp
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
if (!process.argv[2]) throw new Error("Pass a Python executable with yt-dlp installed.");
const run = promisify(execFile);
const body = Buffer.from("Savebeam local fixture media\n");
const requests = [];
const server = createServer((request, response) => {
  requests.push({
    method: request.method,
    url: request.url,
    cookie: request.headers.cookie,
    auth: request.headers.authorization,
  });
  response.writeHead(200, { "Content-Type": "video/mp4", "Content-Length": body.length });
  response.end(request.method === "HEAD" ? undefined : body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const directory = await mkdtemp(join(tmpdir(), "savebeam-proxy-fixture-"));
const proxy = `http://127.0.0.1:${server.address().port}`;
const target = "http://savebeam-proxy-test.invalid/media.mp4";
const common = [
  "-m",
  "yt_dlp",
  "--ignore-config",
  "--no-cache-dir",
  "--no-warnings",
  "--socket-timeout",
  "3",
  "--retries",
  "0",
  "--proxy",
  proxy,
];
try {
  const result = await run(
    process.argv[2],
    [...common, "--dump-single-json", "--skip-download", "--", target],
    { timeout: 15000, maxBuffer: 1024 * 1024 },
  );
  const media = JSON.parse(result.stdout);
  assert.ok(media.formats.length);
  assert.ok(requests.length > 0);
  await run(
    process.argv[2],
    [...common, "--no-progress", "--output", join(directory, "fixture.mp4"), "--", target],
    { timeout: 15000 },
  );
  assert.deepEqual(await readFile(join(directory, "fixture.mp4")), body);
  assert.ok(
    requests.every((request) => request.url === target && !request.cookie && !request.auth),
  );
  process.stdout.write(
    `real yt-dlp inspect + download through loopback proxy: passed (${requests.length} requests)\n`,
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true }); // Only this script's mkdtemp fixture.
}
