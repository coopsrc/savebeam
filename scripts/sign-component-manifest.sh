#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  printf 'Usage: %s <unsigned-manifest.json> <private-key.pem> <signed-output.json>\n' "$0" >&2
  exit 2
fi

manifest_path=$1
key_path=$2
output_path=$3

if [[ ! -f "$manifest_path" || ! -f "$key_path" ]]; then
  printf 'Manifest or signing key file does not exist.\n' >&2
  exit 2
fi
if [[ -e "$output_path" ]]; then
  printf 'Refusing to overwrite existing output: %s\n' "$output_path" >&2
  exit 2
fi

temp_dir=$(mktemp -d)
cleanup() {
  for file in payload.bin signature.bin output.json; do
    if [[ -e "$temp_dir/$file" ]]; then
      unlink "$temp_dir/$file"
    fi
  done
  rmdir "$temp_dir"
}
trap cleanup EXIT HUP INT TERM

cargo run --quiet --locked --features release-tools --manifest-path src-tauri/Cargo.toml \
  --bin component_manifest_payload -- "$manifest_path" > "$temp_dir/payload.bin"
openssl pkeyutl -sign -rawin -inkey "$key_path" \
  -in "$temp_dir/payload.bin" -out "$temp_dir/signature.bin"
signature_hex=$(xxd -p -c 64 "$temp_dir/signature.bin" | tr -d '\n')
jq --arg signature "$signature_hex" '.signature = $signature' \
  "$manifest_path" > "$temp_dir/output.json"
cargo run --quiet --locked --features release-tools --manifest-path src-tauri/Cargo.toml \
  --bin verify_component_manifest -- "$temp_dir/output.json"

output_parent=$(dirname "$output_path")
if [[ ! -d "$output_parent" ]]; then
  printf 'Output directory does not exist: %s\n' "$output_parent" >&2
  exit 2
fi
mv "$temp_dir/output.json" "$output_path"
