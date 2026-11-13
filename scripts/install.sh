#!/bin/sh
set -eu

version=
prefix=
defer_start=
download_base=${LOCAL_AI_AGENT_DOWNLOAD_BASE_URL:-https://github.com/zhuxian89/idea-ai-agent/releases/download}
# Downloads and their redirects must stay on HTTPS: the checksum travels with the archive,
# so a downgrade to plain HTTP would let a tampered archive come with a matching checksum.
# Only an explicit local override (used by the tests) may relax this.
if [ -n "${LOCAL_AI_AGENT_DOWNLOAD_BASE_URL:-}" ]; then
  https_only=
else
  https_only='--proto =https --proto-redir =https'
fi

usage() {
  printf '%s\n' 'Usage: install.sh [--version VERSION] [--prefix DIRECTORY] [--defer-start]'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --defer-start) defer_start=--defer-start; shift ;;
    --version|--prefix)
      if [ "$#" -lt 2 ]; then usage >&2; exit 1; fi
      case "$1" in
        --version) version=$2 ;;
        --prefix) prefix=$2 ;;
      esac
      shift 2
      ;;
    --help|-h) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 1 ;;
  esac
done

case "$(uname -s)" in
  Darwin) platform=macos ;;
  Linux) platform=linux ;;
  *) printf '%s\n' 'Supported systems: macOS and Linux.' >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=amd64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) printf '%s\n' 'Supported architectures: x64 and ARM64.' >&2; exit 1 ;;
esac

if [ -z "$version" ]; then
  version=$(curl -fsSL $https_only https://raw.githubusercontent.com/zhuxian89/idea-ai-agent/main/scripts/standalone/version.txt)
fi
case "$version" in
  ''|[!0-9]*|*[!0-9A-Za-z.+-]*) printf 'Invalid standalone version: %s\n' "$version" >&2; exit 1 ;;
esac

bundle="local-ai-agent-$version-$platform-$arch"
archive="$bundle.tar.gz"
url="${download_base%/}/standalone-v$version/$archive"
work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' 0
trap 'exit 1' HUP INT TERM

printf 'Installing Local AI Agent %s (%s/%s)\nDownloading %s\n' "$version" "$platform" "$arch" "$url"
curl -fsSL $https_only "$url" -o "$work_dir/$archive"
curl -fsSL $https_only "$url.sha256" -o "$work_dir/checksum"
expected=$(awk 'NR == 1 {print $1}' "$work_dir/checksum")
if [ "$platform" = macos ]; then
  actual=$(shasum -a 256 "$work_dir/$archive" | awk '{print $1}')
else
  actual=$(sha256sum "$work_dir/$archive" | awk '{print $1}')
fi
if [ "$expected" != "$actual" ]; then
  printf '%s\n' 'SHA-256 verification failed; installation was not changed.' >&2
  exit 1
fi

tar -xzf "$work_dir/$archive" -C "$work_dir"
sh "$work_dir/$bundle/install.sh" "$prefix" "$defer_start"
