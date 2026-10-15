#!/bin/bash
# Run on the matching native GitHub runner. Every downloaded binary is pinned
# and checked before electron-builder copies resources/bin into the app.
set -euo pipefail

release_arch="${1:-}"
case "$release_arch" in
  arm64)
    expected_machine="arm64"
    ffmpeg_arch="arm64"
    uv_target="aarch64"
    ffmpeg_sha="a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584"
    ffprobe_sha="bb2db6f5d8cef919da12fbf592119a987202a8c060a886f3cab091f9cab90b64"
    ffmpeg_license_sha="cb48bf09a11f5fb576cddb0431c8f5ed0a60157a9ec942adffc13907cbe083f2"
    ffmpeg_readme_sha="05ba4b92c96605434b1aaae3eedf5a2c280c9607bf78ffca9a5b536d9af2dc6a"
    uv_sha="4952c6275778fbc7e5cf6b5739ffd944c47063134d6ea43a7037b0a028ef771e"
    ;;
  x64)
    expected_machine="x86_64"
    ffmpeg_arch="x64"
    uv_target="x86_64"
    ffmpeg_sha="ebdddc936f61e14049a2d4b549a412b8a40deeff6540e58a9f2a2da9e6b18894"
    ffprobe_sha="fa3add0ce901f7241abe0dfc0155d958fc834aca3f8ce61f87cc712ae669c1e0"
    ffmpeg_license_sha="2e1d16c72fd74e12063776371da757322f8b77589386532f4fd8634bde7de1af"
    ffmpeg_readme_sha="e88a0325f8e5b75210355e37341824f074d3cd82def2125be54c914b62848a36"
    uv_sha="d336d862694e1c36afea55eb15f5df02aa77c04a168b781df515d641e23285f0"
    ;;
  *)
    echo "Expected release architecture arm64 or x64" >&2
    exit 1
    ;;
esac

if [[ "$(uname -m)" != "$expected_machine" ]]; then
  echo "Runner architecture $(uname -m) does not match $release_arch" >&2
  exit 1
fi

cache_dir=".cache/ci-engines/macos-$release_arch"
bin_dir="resources/bin"
mkdir -p "$cache_dir" "$bin_dir"

download_checked() {
  local url="$1" output="$2" sha="$3"
  if [[ ! -f "$output" ]]; then
    curl --fail --location --retry 3 --retry-all-errors --output "$output" "$url"
  fi
  local actual
  actual="$(shasum -a 256 "$output" | awk '{print $1}')"
  if [[ "$actual" != "$sha" ]]; then
    echo "SHA256 mismatch for $output: $actual" >&2
    exit 1
  fi
}

ffmpeg_base="https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1"
download_checked "$ffmpeg_base/ffmpeg-darwin-$ffmpeg_arch" "$bin_dir/ffmpeg" "$ffmpeg_sha"
download_checked "$ffmpeg_base/ffprobe-darwin-$ffmpeg_arch" "$bin_dir/ffprobe" "$ffprobe_sha"
download_checked "$ffmpeg_base/darwin-$ffmpeg_arch.LICENSE" "$bin_dir/FFmpeg-LICENSE.txt" "$ffmpeg_license_sha"
download_checked "$ffmpeg_base/darwin-$ffmpeg_arch.README" "$bin_dir/FFmpeg-README.txt" "$ffmpeg_readme_sha"
chmod +x "$bin_dir/ffmpeg" "$bin_dir/ffprobe"

uv_archive="uv-$uv_target-apple-darwin.tar.gz"
uv_url="https://github.com/astral-sh/uv/releases/download/0.6.5/$uv_archive"
download_checked "$uv_url" "$cache_dir/$uv_archive" "$uv_sha"
rm -rf "$cache_dir/uv"
mkdir -p "$cache_dir/uv"
tar -xzf "$cache_dir/$uv_archive" -C "$cache_dir/uv" --strip-components=1
cp "$cache_dir/uv/uv" "$bin_dir/uv"
chmod +x "$bin_dir/uv"

cat > "$bin_dir/manifest.json" <<EOF
{
  "platform": "macos",
  "arch": "$release_arch",
  "ffmpeg": {
    "version": "6.1.1",
    "release": "b6.1.1",
    "url": "$ffmpeg_base",
    "sha256": "$ffmpeg_sha"
  },
  "ffprobe": { "sha256": "$ffprobe_sha" },
  "uv": { "version": "0.6.5", "url": "$uv_url", "sha256": "$uv_sha" }
}
EOF

echo "Prepared pinned macOS $release_arch engines"
