// Create an ephemeral release-only Tauri override; never persist signing credentials.
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
export function releaseConfig(platform, signed, env = process.env) {
  if (!["darwin", "win32"].includes(platform)) throw new Error("Unsupported release platform");
  const bundle = {
    createUpdaterArtifacts: true,
    license: "Apache-2.0",
    resources: Object.fromEntries(
      ["LICENSE", "NOTICE", "docs/releases/THIRD_PARTY_NOTICES.txt"].map((file) => [
        path.resolve(file),
        `legal/${path.basename(file)}`,
      ]),
    ),
  };
  if (platform === "darwin") {
    if (signed && !env.APPLE_SIGNING_IDENTITY?.startsWith("Developer ID Application:"))
      throw new Error("A Developer ID Application identity is required");
    bundle.targets = ["app", "dmg"];
    bundle.macOS = {
      signingIdentity: signed ? env.APPLE_SIGNING_IDENTITY : "-",
      hardenedRuntime: signed,
    };
  } else {
    if (signed && !/^[0-9A-Fa-f]{40}$/.test(env.WINDOWS_CERTIFICATE_THUMBPRINT ?? ""))
      throw new Error("A valid Windows signing certificate thumbprint is required");
    bundle.targets = ["nsis"];
    bundle.windows = {
      allowDowngrades: false,
      nsis: {
        installMode: "currentUser",
        languages: ["English", "SimpChinese"],
        displayLanguageSelector: true,
      },
      ...(signed
        ? {
            certificateThumbprint: env.WINDOWS_CERTIFICATE_THUMBPRINT,
            digestAlgorithm: "sha256",
            timestampUrl: "http://timestamp.digicert.com",
            tsp: true,
          }
        : {}),
    };
  }
  return { bundle };
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const [platform, mode, output] = process.argv.slice(2);
  if (!["signed", "unsigned"].includes(mode) || !output)
    throw new Error("Usage: prepare-release.mjs darwin|win32 signed|unsigned output.json");
  fs.writeFileSync(
    output,
    JSON.stringify(releaseConfig(platform, mode === "signed"), null, 2) + "\n",
    { flag: "wx" },
  );
}
