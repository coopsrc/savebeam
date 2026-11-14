import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
const root = process.argv[2];
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const signatures = fs
  .readdirSync(root, { recursive: true })
  .filter((f) => /(?:\.app\.tar\.gz|\.exe)\.sig$/.test(f));
if (!signatures.length) throw new Error("No updater signatures found");
for (const sig of signatures) {
  const file = path.join(root, sig.slice(0, -4));
  execFileSync(
    "cargo",
    [
      "run",
      "--locked",
      "--features",
      "release-tools",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--bin",
      "verify_app_artifact",
      "--",
      file,
      file + ".sig",
      version,
    ],
    { stdio: "inherit" },
  );
}
