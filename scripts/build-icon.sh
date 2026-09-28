#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."
icon_work=$(mktemp -d)
trap 'rm -rf "$icon_work"' EXIT
icon_set="$icon_work/icon.iconset"
mkdir -p "$icon_set"

# macOS requires both standard and Retina representations.
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" build/icon.png --out "$icon_set/icon_${size}x${size}.png" >/dev/null
  retina=$((size * 2))
  sips -z "$retina" "$retina" build/icon.png --out "$icon_set/icon_${size}x${size}@2x.png" >/dev/null
done

iconutil -c icns "$icon_set" -o build/icon.icns
