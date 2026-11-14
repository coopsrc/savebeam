#!/usr/bin/env python3
"""Build an offline notices inventory from the installed, locked dependency graphs."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent


def command(args):
    return json.loads(subprocess.check_output(args, cwd=ROOT, text=True))


def npm_packages(root):
    """Follow installed manifests, including peers, independently of pnpm list deduplication."""
    root = root.resolve()
    seen_paths = set()
    packages = {}

    def resolve(name, directory):
        cursor = directory
        while cursor.is_relative_to(root):
            manifest = cursor / "node_modules" / name / "package.json"
            if manifest.is_file():
                return manifest.parent.resolve()
            if cursor == root:
                break
            cursor = cursor.parent
        return None

    def visit(name, directory, required):
        package = resolve(name, directory)
        if package is None:
            if required:
                raise ValueError(f"Missing installed production dependency: {name}")
            return
        if package in seen_paths:
            return
        seen_paths.add(package)
        manifest = json.loads((package / "package.json").read_text())
        if manifest["name"] != name:
            raise ValueError(f"Unexpected package identity for {name}")
        license_name = manifest.get("license") or "metadata unavailable"
        if isinstance(license_name, dict):
            license_name = license_name.get("type", "metadata unavailable")
        packages[(name, manifest["version"])] = (
            "npm", name, manifest["version"], license_name, [package], None
        )
        optional = manifest.get("optionalDependencies", {})
        for dependency in manifest.get("dependencies", {}):
            visit(dependency, package, dependency not in optional)
        for dependency in optional:
            visit(dependency, package, False)
        for dependency in manifest.get("peerDependencies", {}):
            visit(dependency, package, False)

    manifest = json.loads((root / "package.json").read_text())
    for name in manifest.get("dependencies", {}):
        visit(name, root, True)
    return list(packages.values())


def main():
    cargo = command(["cargo", "metadata", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--format-version", "1"])
    packages = npm_packages(ROOT)
    for row in cargo["packages"]:
        if row["name"] == "savebeam":
            continue
        packages.append(("Rust", row["name"], row["version"], row.get("license") or "metadata unavailable", [Path(row["manifest_path"]).parent], row.get("license_file")))
    supplemental = json.loads((ROOT / "docs/releases/supplemental-notices.json").read_text())
    texts = {}
    lines = ["Savebeam third-party dependency notices", "", "Generated from the locked Rust graph (including target/build dependencies) and installed production npm dependencies.", "External yt-dlp, FFmpeg/ffprobe and runtimes are separate programs; consult each installed binary's own provider notices.", "The inventory is not a claim that all target binaries have been tested or that third-party software uses Savebeam's license.", ""]
    missing = []
    for ecosystem, name, version, license_name, paths, explicit in sorted(packages):
        references = set()
        for directory in paths:
            files = [p for p in directory.iterdir() if p.is_file() and p.name.lower().startswith(("license", "licence", "copying", "notice", "copyright"))]
            if explicit:
                files.append(directory / explicit)
            for path in sorted(set(files)):
                if not path.is_file() or path.stat().st_size > 1024 * 1024:
                    continue
                content = path.read_text(errors="replace").strip()
                if not content:
                    continue
                key = hashlib.sha256(content.encode()).hexdigest()[:16]
                texts[key] = content
                references.add(key)
        lines.append(f"{ecosystem}: {name} {version} | {license_name}")
        lines.append("Source archive: " + (
            f"https://crates.io/api/v1/crates/{name}/{version}/download"
            if ecosystem == "Rust" else
            f"https://registry.npmjs.org/{name}/-/{name.rsplit('/', 1)[-1]}-{version}.tgz"
        ))
        for entry in supplemental.get(f"{ecosystem}:{name}@{version}", []):
            content = entry["text"]
            if hashlib.sha256(content.encode()).hexdigest() != entry["sha256"]:
                raise ValueError(f"Supplemental license hash mismatch: {name}")
            key = hashlib.sha256(content.strip().encode()).hexdigest()[:16]
            texts[key] = content.strip()
            references.add(key)
            lines.append("Supplemental source: " + entry["url"])
            if entry.get("note"):
                lines.append("Review note: " + entry["note"])
        lines.append("License texts: " + (", ".join(sorted(references)) if references else "not included in the installed package; release review required"))
        if not references:
            missing.append(f"{ecosystem}:{name}@{version}")
    for key, content in sorted(texts.items()):
        lines.extend(["", "=" * 72, f"License text {key}", "=" * 72, content])
    output = ROOT / "docs/releases/THIRD_PARTY_NOTICES.txt"
    output.write_text("\n".join(lines) + "\n")
    print(f"Wrote {len(packages)} dependencies and {len(texts)} license texts ({output.stat().st_size} bytes).")
    print("Missing packaged license texts: " + (", ".join(missing) if missing else "none"))
    if missing:
        raise SystemExit("Missing license text; review dependencies before releasing.")


if __name__ == "__main__":
    main()
