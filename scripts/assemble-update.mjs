// Run after OS signature checks and artifact crypto verification. Does not publish anything.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { execFileSync } from "node:child_process";
export function assemble(directories, version, notes = "") {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error("Invalid version");
  const platforms = {};
  for (const directory of directories) {
    const info = JSON.parse(fs.readFileSync(path.join(directory, "build-info.json"), "utf8"));
    if (!["darwin", "win32"].includes(info.platform)) throw new Error("Unknown updater platform");
    if (
      info.version !== version ||
      info.signingMode !== "signed" ||
      info.osSignatureVerified !== true
    )
      throw new Error(
        "Only verified OS-signed release artifacts can enter the public updater manifest",
      );
    const extension = info.platform === "darwin" ? ".app.tar.gz" : ".exe";
    const key = info.platform === "darwin" ? "darwin-aarch64" : "windows-x86_64";
    if (platforms[key]) throw new Error("Duplicate updater platform");
    const packages = info.artifacts.filter((a) => a.name.endsWith(extension));
    if (packages.length !== 1) throw new Error("Expected exactly one updater package");
    const artifact = packages[0];
    if (path.basename(artifact.name) !== artifact.name)
      throw new Error("Invalid artifact filename");
    const bytes = fs.readFileSync(path.join(directory, artifact.name));
    if (
      createHash("sha256").update(bytes).digest("hex") !== artifact.sha256 ||
      bytes.length !== artifact.bytes
    )
      throw new Error("Artifact hash mismatch");
    const signature = fs.readFileSync(path.join(directory, artifact.name + ".sig"), "utf8").trim();
    const trusted = Buffer.from(signature, "base64").toString("utf8");
    if (
      !trusted
        .split("\n")
        .some(
          (line) =>
            line.startsWith("trusted comment:") && line.split("\t").includes(`version:${version}`),
        )
    )
      throw new Error("Missing version-bound signature");
    platforms[key] = {
      signature,
      url: `https://github.com/coopsrc/savebeam/releases/download/v${version}/${encodeURIComponent(artifact.name)}`,
    };
  }
  if (!platforms["darwin-aarch64"] || !platforms["windows-x86_64"])
    throw new Error("Both release platforms are required");
  return { version, notes, pub_date: new Date().toISOString(), platforms };
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const [mac, windows, output] = process.argv.slice(2);
  if (!output)
    throw new Error("Usage: assemble-update.mjs mac-artifacts windows-artifacts output.json");
  for (const directory of [mac, windows])
    execFileSync(process.execPath, ["scripts/verify-release-signatures.mjs", directory], {
      stdio: "inherit",
    });
  const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
  fs.writeFileSync(output, JSON.stringify(assemble([mac, windows], version), null, 2) + "\n", {
    flag: "wx",
  });
}
