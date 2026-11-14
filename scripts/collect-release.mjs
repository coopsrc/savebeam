// Collect only known public artifacts, with hashes and signing-mode provenance.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
export function collect(root, output, platform, mode) {
  if (!["darwin", "win32"].includes(platform) || !["signed", "unsigned"].includes(mode))
    throw new Error("Invalid release mode/platform");
  const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
  if (platform === "darwin") {
    const executables = fs.readdirSync(path.join(root, "macos/Savebeam.app/Contents/MacOS"));
    if (executables.length !== 1 || executables[0] !== "savebeam")
      throw new Error("Unexpected executable in macOS application bundle");
  }
  const files = fs
    .readdirSync(root, { recursive: true })
    .filter((f) => /(?:\.dmg|\.app\.tar\.gz|\.exe)(?:\.sig)?$/.test(f));
  const wanted =
    platform === "darwin"
      ? files.filter((f) => /\.dmg$|\.app\.tar\.gz(?:\.sig)?$/.test(f))
      : files.filter((f) => /\.exe(?:\.sig)?$/.test(f));
  if (!wanted.some((f) => f.endsWith(".sig")))
    throw new Error("Missing updater signature artifacts");
  fs.mkdirSync(output, { recursive: false });
  const artifacts = [];
  for (const relative of wanted) {
    const source = path.join(root, relative);
    const name = path.basename(source);
    if (fs.existsSync(path.join(output, name))) throw new Error("Duplicate release filename");
    fs.copyFileSync(source, path.join(output, name));
    const bytes = fs.readFileSync(source);
    artifacts.push({
      name,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
  }
  for (const file of ["LICENSE", "NOTICE", "docs/releases/THIRD_PARTY_NOTICES.txt"])
    fs.copyFileSync(file, path.join(output, path.basename(file)));
  fs.writeFileSync(
    path.join(output, "build-info.json"),
    JSON.stringify(
      {
        version,
        platform,
        signingMode: mode,
        osSignatureVerified: false,
        commit: process.env.GITHUB_SHA ?? "local",
        artifacts,
      },
      null,
      2,
    ) + "\n",
  );
  fs.writeFileSync(
    path.join(output, "SHA256SUMS"),
    artifacts.map((a) => `${a.sha256}  ${a.name}`).join("\n") + "\n",
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename))
  collect(...process.argv.slice(2));
