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
import { checkVersion, prepare } from "../scripts/prepare-github-release.mjs";

test("release tags must match all application source versions", () => {
  const cargo = fs.readFileSync("src-tauri/Cargo.toml", "utf8");
  const lock = fs.readFileSync("src-tauri/Cargo.lock", "utf8");
  assert.equal(checkVersion("v0.1.0", "0.1.0", cargo, lock), "0.1.0");
  for (const tag of ["0.1.0", "v01.1.0", "v0.1.0;echo bad", "v0.1.0-beta.1"])
    assert.throws(() => checkVersion(tag, "0.1.0", cargo, lock), /tag/);
  assert.throws(() => checkVersion("v0.2.0", "0.1.0", cargo, lock), /versions must match/);
  assert.throws(
    () =>
      checkVersion(
        "v0.1.0",
        "0.1.0",
        cargo.replace('version = "0.1.0"', 'version = "0.2.0"'),
        lock,
      ),
    /versions must match/,
  );
  assert.throws(
    () =>
      checkVersion(
        "v0.1.0",
        "0.1.0",
        cargo,
        lock.replace(
          /name = "savebeam"\nversion = "[^"]+"/,
          'name = "savebeam"\nversion = "0.2.0"',
        ),
      ),
    /versions must match/,
  );
});

function publicCandidates() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "savebeam-public-release-"));
  const root = path.join(temp, "candidates");
  fs.mkdirSync(root);
  const commit = "a".repeat(40);
  const dirs = [
    [
      "darwin",
      "aarch64-apple-darwin",
      ["Savebeam_0.1.0_aarch64.dmg", "Savebeam.app.tar.gz", "Savebeam.app.tar.gz.sig"],
    ],
    [
      "win32",
      "x86_64-pc-windows-msvc",
      ["Savebeam_0.1.0_x64-setup.exe", "Savebeam_0.1.0_x64-setup.exe.sig"],
    ],
  ].map(([platform, target, names]) => {
    const bundle = path.join(temp, platform);
    fs.mkdirSync(bundle);
    if (platform === "darwin") {
      const exe = path.join(bundle, "macos/Savebeam.app/Contents/MacOS");
      fs.mkdirSync(exe, { recursive: true });
      fs.writeFileSync(path.join(exe, "savebeam"), "main");
    }
    for (const name of names) fs.writeFileSync(path.join(bundle, name), "fixture");
    const dir = path.join(root, `savebeam-${target}-unsigned`);
    collect(bundle, dir, platform, "unsigned");
    const info = JSON.parse(fs.readFileSync(path.join(dir, "build-info.json")));
    info.commit = commit;
    fs.writeFileSync(path.join(dir, "build-info.json"), JSON.stringify(info));
    return dir;
  });
  return { temp, root, dirs, commit, output: path.join(temp, "public") };
}

test("manual-download release stages both exact-tag platforms and preserves unsigned provenance", () => {
  const f = publicCandidates();
  try {
    prepare(f.root, f.output, "v0.1.0", f.commit);
    assert.equal(fs.existsSync(path.join(f.output, "latest.json")), false);
    const info = JSON.parse(fs.readFileSync(path.join(f.output, "build-info.json")));
    assert.equal(info.commit, f.commit);
    assert.equal(info.tag, "v0.1.0");
    assert.ok(
      info.platforms.every((p) => p.signingMode === "unsigned" && p.osSignatureVerified === false),
    );
    for (const line of fs
      .readFileSync(path.join(f.output, "SHA256SUMS"), "utf8")
      .trim()
      .split("\n")) {
      const [hash, name] = line.split("  ");
      assert.equal(
        createHash("sha256")
          .update(fs.readFileSync(path.join(f.output, name)))
          .digest("hex"),
        hash,
      );
    }
    assert.equal(fs.readdirSync(f.output).length, 10);
    assert.throws(() => prepare(f.root, f.output, "v0.1.0", f.commit), /EEXIST/);
  } finally {
    fs.rmSync(f.temp, { recursive: true, force: true });
  }
});

test("publication rejects stale builds, tampering, missing platforms, unexpected files and legal drift before staging", () => {
  const mutations = [
    (f) => {
      const p = path.join(f.dirs[0], "build-info.json"),
        j = JSON.parse(fs.readFileSync(p));
      j.commit = "b".repeat(40);
      fs.writeFileSync(p, JSON.stringify(j));
    },
    (f) => fs.rmSync(f.dirs[1], { recursive: true }),
    (f) => fs.writeFileSync(path.join(f.dirs[1], "Savebeam_0.1.0_x64-setup.exe"), "tampered"),
    (f) => fs.rmSync(path.join(f.dirs[1], "Savebeam_0.1.0_x64-setup.exe.sig")),
    (f) => fs.writeFileSync(path.join(f.dirs[0], "secret.key"), "never publish"),
    (f) => fs.writeFileSync(path.join(f.dirs[0], "LICENSE"), "different license"),
    (f) => fs.writeFileSync(path.join(f.dirs[0], "SHA256SUMS"), "different hashes"),
    (f) => {
      const p = path.join(f.dirs[0], "build-info.json"),
        j = JSON.parse(fs.readFileSync(p));
      j.artifacts[0].name = "../../secret.key";
      fs.writeFileSync(p, JSON.stringify(j));
    },
    (f) => {
      const p = path.join(f.dirs[0], "build-info.json"),
        j = JSON.parse(fs.readFileSync(p));
      j.osSignatureVerified = true;
      fs.writeFileSync(p, JSON.stringify(j));
    },
  ];
  for (const mutate of mutations) {
    const f = publicCandidates();
    try {
      mutate(f);
      assert.throws(() => prepare(f.root, f.output, "v0.1.0", f.commit));
      assert.equal(fs.existsSync(f.output), false);
    } finally {
      fs.rmSync(f.temp, { recursive: true, force: true });
    }
  }
});

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
