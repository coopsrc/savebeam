// Stage tag-bound, already crypto-verified CI artifacts for manual GitHub downloads.
// This never creates latest.json or changes OS-signature/publication review gates.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";

const legal = ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.txt"];
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readFile = (file) => {
  if (!fs.lstatSync(file).isFile()) throw new Error(`Expected regular file: ${file}`);
  return fs.readFileSync(file);
};

export function checkVersion(tag, appVersion, cargo, lock) {
  if (!/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag))
    throw new Error("Release tag must be vMAJOR.MINOR.PATCH");
  const version = tag.slice(1);
  const crate = cargo.split(/^\[/m)[1]?.match(/^package\]\s[\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
  const locked = lock
    .split("[[package]]")
    .find((entry) => /^name = "savebeam"$/m.test(entry))
    ?.match(/^version = "([^"]+)"$/m)?.[1];
  if (version !== appVersion || version !== crate || version !== locked)
    throw new Error("Tag, package.json, Cargo.toml and Cargo.lock versions must match");
  return version;
}

function projectVersion(tag) {
  const version = checkVersion(
    tag,
    JSON.parse(fs.readFileSync("package.json", "utf8")).version,
    fs.readFileSync("src-tauri/Cargo.toml", "utf8"),
    fs.readFileSync("src-tauri/Cargo.lock", "utf8"),
  );
  if (!readFile(`docs/releases/notes/${version}.md`).toString("utf8").trim())
    throw new Error("Release notes must not be empty");
  return version;
}

export function prepare(root, output, tag, commit) {
  const version = projectVersion(tag);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error("Expected full release commit SHA");
  const files = new Map();
  const platforms = [];
  for (const [platform, target, names] of [
    [
      "darwin",
      "aarch64-apple-darwin",
      [`Savebeam_${version}_aarch64.dmg`, "Savebeam.app.tar.gz", "Savebeam.app.tar.gz.sig"],
    ],
    [
      "win32",
      "x86_64-pc-windows-msvc",
      [`Savebeam_${version}_x64-setup.exe`, `Savebeam_${version}_x64-setup.exe.sig`],
    ],
  ]) {
    const matches = fs
      .readdirSync(root)
      .filter((name) =>
        ["unsigned", "signed"].some((mode) => name === `savebeam-${target}-${mode}`),
      );
    if (matches.length !== 1) throw new Error(`Expected exactly one candidate for ${platform}`);
    const dir = path.join(root, matches[0]);
    if (!fs.lstatSync(dir).isDirectory()) throw new Error("Expected regular candidate directory");
    const info = JSON.parse(readFile(path.join(dir, "build-info.json")));
    if (info.version !== version || info.commit !== commit || info.platform !== platform)
      throw new Error("Candidate version, commit or platform mismatch");
    if (
      !["signed", "unsigned"].includes(info.signingMode) ||
      matches[0] !== `savebeam-${target}-${info.signingMode}` ||
      info.osSignatureVerified !== (info.signingMode === "signed")
    )
      throw new Error("Invalid candidate signing provenance");
    const expected = [...names, ...legal, "build-info.json", "SHA256SUMS"].sort();
    if (
      JSON.stringify(fs.readdirSync(dir).sort()) !== JSON.stringify(expected) ||
      !Array.isArray(info.artifacts) ||
      info.artifacts.length !== names.length ||
      JSON.stringify(info.artifacts.map((a) => a.name).sort()) !== JSON.stringify([...names].sort())
    )
      throw new Error("Unexpected or missing candidate files");
    for (const artifact of info.artifacts) {
      const bytes = readFile(path.join(dir, artifact.name));
      if (bytes.length !== artifact.bytes || digest(bytes) !== artifact.sha256)
        throw new Error("Candidate artifact length or hash mismatch");
      files.set(artifact.name, bytes);
    }
    const sums = info.artifacts.map((a) => `${a.sha256}  ${a.name}`).join("\n") + "\n";
    if (readFile(path.join(dir, "SHA256SUMS")).toString("utf8") !== sums)
      throw new Error("Candidate checksum manifest mismatch");
    for (const name of legal) {
      const bytes = readFile(path.join(dir, name));
      const source = name === "THIRD_PARTY_NOTICES.txt" ? `docs/releases/${name}` : name;
      if (!bytes.equals(readFile(source))) throw new Error("Candidate legal resources mismatch");
      files.set(name, bytes);
    }
    platforms.push(info);
  }
  if (platforms[0].signingMode !== platforms[1].signingMode)
    throw new Error("Both platforms must use the same signing mode");
  files.set(
    "build-info.json",
    JSON.stringify({ schemaVersion: 1, tag, version, commit, platforms }, null, 2) + "\n",
  );
  const sums =
    [...files]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, bytes]) => `${digest(bytes)}  ${name}`)
      .join("\n") + "\n";
  files.set("SHA256SUMS", sums);
  fs.mkdirSync(output);
  for (const [name, bytes] of files)
    fs.writeFileSync(path.join(output, name), bytes, { flag: "wx" });
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  if (process.argv[2] === "--check-tag") projectVersion(process.argv[3]);
  else {
    const args = process.argv.slice(2);
    if (args.length !== 4)
      throw new Error(
        "Usage: prepare-github-release.mjs artifacts output tag commit | --check-tag tag",
      );
    prepare(...args);
  }
}
