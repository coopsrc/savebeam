import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import test from "node:test";
import { releaseConfig } from "../scripts/prepare-release.mjs";
import { collect } from "../scripts/collect-release.mjs";
import { assemble } from "../scripts/assemble-update.mjs";
import { verifyReview } from "../scripts/verify-component-review.mjs";

test("component publication refuses missing platform reviews, stale hashes and floating assets", () => {
  const bytes = fs.readFileSync("release/components.unsigned.json");
  const review = JSON.parse(fs.readFileSync("release/component-review.json"));
  assert.throws(() => verifyReview(bytes, review), /not approved/);
  const approved = JSON.parse(JSON.stringify(review));
  approved.approvedForPublication = true;
  assert.throws(() => verifyReview(bytes, approved), /Incomplete/);
  for (const entry of Object.values(approved.entries))
    Object.assign(entry, {
      downloadedHashVerified: true,
      nativeSmokePassed: true,
      binaryNoticesReviewed: true,
    });
  verifyReview(bytes, approved);
  assert.throws(() => verifyReview(Buffer.concat([bytes, Buffer.from(" ")]), approved), /stale/);
  const manifest = JSON.parse(bytes);
  manifest.entries[0].url = "https://github.com/example/binary/releases/download/latest/binary.zip";
  const floating = Buffer.from(JSON.stringify(manifest));
  approved.manifestSha256 = createHash("sha256").update(floating).digest("hex");
  assert.throws(() => verifyReview(floating, approved), /Floating/);
});

test("public signing configuration fails closed while internal candidates stay explicitly unsigned", () => {
  assert.equal(releaseConfig("darwin", false, {}).bundle.macOS.signingIdentity, "-");
  assert.throws(() => releaseConfig("darwin", true, {}), /Developer ID/);
  assert.throws(
    () => releaseConfig("darwin", true, { APPLE_SIGNING_IDENTITY: "Apple Development: test" }),
    /Developer ID/,
  );
  assert.throws(() => releaseConfig("win32", true, {}), /thumbprint/);
  assert.equal(releaseConfig("win32", false, {}).bundle.windows.allowDowngrades, false);
  assert.equal(
    releaseConfig("win32", true, { WINDOWS_CERTIFICATE_THUMBPRINT: "a".repeat(40) }).bundle.windows
      .digestAlgorithm,
    "sha256",
  );
});

test("artifact collection exports installers, signatures, hashes and notices without arbitrary files", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "savebeam-release-"));
  try {
    const root = path.join(temp, "bundle"),
      output = path.join(temp, "public");
    fs.mkdirSync(root);
    const executables = path.join(root, "macos/Savebeam.app/Contents/MacOS");
    fs.mkdirSync(executables, { recursive: true });
    fs.writeFileSync(path.join(executables, "savebeam"), "main");
    fs.writeFileSync(path.join(root, "Savebeam.app.tar.gz"), "fixture");
    fs.writeFileSync(path.join(root, "Savebeam.app.tar.gz.sig"), "signature");
    fs.writeFileSync(path.join(root, "secret.key"), "never export this");
    collect(root, output, "darwin", "unsigned");
    assert.equal(fs.existsSync(path.join(output, "secret.key")), false);
    const info = JSON.parse(fs.readFileSync(path.join(output, "build-info.json")));
    assert.equal(info.osSignatureVerified, false);
    assert.equal(info.signingMode, "unsigned");
    assert.equal(
      info.artifacts.find((a) => a.name === "Savebeam.app.tar.gz").sha256,
      createHash("sha256").update("fixture").digest("hex"),
    );
    assert.ok(fs.existsSync(path.join(output, "THIRD_PARTY_NOTICES.txt")));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("updater manifest requires both verified OS packages and rejects changed or legacy artifacts", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "savebeam-update-manifest-"));
  try {
    const dirs = ["darwin", "win32"].map((platform) => {
      const dir = path.join(temp, platform);
      fs.mkdirSync(dir);
      const name = platform === "darwin" ? "Savebeam.app.tar.gz" : "Savebeam.exe";
      fs.writeFileSync(path.join(dir, name), "fixture");
      fs.writeFileSync(
        path.join(dir, name + ".sig"),
        Buffer.from(
          "untrusted comment: fixture\nsignature\ntrusted comment: timestamp:1\tfile:test\tversion:0.1.0\nglobal\n",
        ).toString("base64"),
      );
      fs.writeFileSync(
        path.join(dir, "build-info.json"),
        JSON.stringify({
          version: "0.1.0",
          platform,
          signingMode: "signed",
          osSignatureVerified: true,
          artifacts: [
            { name, bytes: 7, sha256: createHash("sha256").update("fixture").digest("hex") },
          ],
        }),
      );
      return dir;
    });
    assert.deepEqual(Object.keys(assemble(dirs, "0.1.0").platforms), [
      "darwin-aarch64",
      "windows-x86_64",
    ]);
    assert.throws(() => assemble(dirs.slice(0, 1), "0.1.0"), /Both/);
    fs.writeFileSync(path.join(dirs[0], "Savebeam.app.tar.gz"), "tampered");
    assert.throws(() => assemble(dirs, "0.1.0"), /hash/);
    fs.writeFileSync(path.join(dirs[0], "Savebeam.app.tar.gz"), "fixture");
    fs.writeFileSync(
      path.join(dirs[0], "Savebeam.app.tar.gz.sig"),
      Buffer.from("old signature without signed version").toString("base64"),
    );
    assert.throws(() => assemble(dirs, "0.1.0"), /version-bound/);
    const infoPath = path.join(dirs[1], "build-info.json"),
      info = JSON.parse(fs.readFileSync(infoPath));
    info.signingMode = "unsigned";
    fs.writeFileSync(infoPath, JSON.stringify(info));
    assert.throws(() => assemble(dirs.slice(1), "0.1.0"), /OS-signed/);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
