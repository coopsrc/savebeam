import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
export function verifyReview(manifestBytes, review) {
  const manifest = JSON.parse(manifestBytes);
  if (createHash("sha256").update(manifestBytes).digest("hex") !== review.manifestSha256)
    throw new Error("Component review is stale; review the exact candidate bytes again");
  if (review.approvedForPublication !== true)
    throw new Error(
      "Component publication is not approved; native-platform and binary-notice reviews remain open",
    );
  const keys = new Set();
  for (const entry of manifest.entries) {
    const key = `${entry.kind}/${entry.targetOs}/${entry.architecture}`;
    if (keys.has(key)) throw new Error("Duplicate component review key");
    keys.add(key);
    const result = review.entries[key];
    if (
      !result ||
      ![
        result.downloadedHashVerified,
        result.nativeSmokePassed,
        result.binaryNoticesReviewed,
      ].every((v) => v === true)
    )
      throw new Error(`Incomplete component release review: ${key}`);
    if (/\/releases\/download\/(latest|nightly)\//.test(entry.url))
      throw new Error("Floating component URL is forbidden");
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename))
  verifyReview(
    fs.readFileSync("release/components.unsigned.json"),
    JSON.parse(fs.readFileSync("release/component-review.json")),
  );
