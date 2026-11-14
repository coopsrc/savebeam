#!/usr/bin/env python3
"""Build an offline notices inventory from the installed, locked dependency graphs."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent


def command(args):
    return json.loads(subprocess.check_output(args, cwd=ROOT, text=True))


def main():
    npm = command(["pnpm", "list", "--prod", "--depth", "Infinity", "--json"])
    cargo = command(["cargo", "metadata", "--manifest-path", "src-tauri/Cargo.toml", "--locked", "--format-version", "1"])
    packages = []
    seen=set()
    def visit(node):
        for name,row in node.get("dependencies",{}).items():
            path=Path(row["path"])
            if path in seen:
                continue
            seen.add(path)
            manifest=json.loads((path/"package.json").read_text())
            license_name=manifest.get("license") or "metadata unavailable"
            if isinstance(license_name,dict):
                license_name=license_name.get("type","metadata unavailable")
            packages.append(("npm",name,row["version"],license_name,[path],None))
            visit(row)
    for project in npm:
        visit(project)
    for row in cargo["packages"]:
        if row["name"] == "savebeam":
            continue
        packages.append(("Rust", row["name"], row["version"], row.get("license") or "metadata unavailable", [Path(row["manifest_path"]).parent], row.get("license_file")))
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
        lines.append("License texts: " + (", ".join(sorted(references)) if references else "not included in the installed package; release review required"))
        if not references:
            missing.append(f"{ecosystem}:{name}@{version}")
    for key, content in sorted(texts.items()):
        lines.extend(["", "=" * 72, f"License text {key}", "=" * 72, content])
    output = ROOT / "docs/releases/THIRD_PARTY_NOTICES.txt"
    output.write_text("\n".join(lines) + "\n")
    print(f"Wrote {len(packages)} dependencies and {len(texts)} license texts ({output.stat().st_size} bytes).")
    print("Missing packaged license texts: " + (", ".join(missing) if missing else "none"))


if __name__ == "__main__":
    main()
