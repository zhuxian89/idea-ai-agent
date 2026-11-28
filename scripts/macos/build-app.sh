#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD="$ROOT/build/macos"
SPEC="$ROOT/macos/project.yml"
VERSION_FILE="$ROOT/macos/Version.xcconfig"
VERSION="$(awk '/^MARKETING_VERSION[[:space:]]*=/ {print $3}' "$VERSION_FILE")"
BUILD_NUMBER="$(awk '/^CURRENT_PROJECT_VERSION[[:space:]]*=/ {print $3}' "$VERSION_FILE")"
XCODEGEN="${XCODEGEN:-xcodegen}"

"$XCODEGEN" generate --spec "$SPEC"
xcodebuild build -project "$ROOT/macos/LocalAIAgentMac.xcodeproj" -scheme LocalAIAgentMac \
  -configuration Release -destination 'generic/platform=macOS' -derivedDataPath "$BUILD/DerivedData" \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=NO CONFIGURATION_BUILD_DIR="$BUILD/Release"

APP="$BUILD/Release/LocalAIAgentMac.app"
EXECUTABLE="$APP/Contents/MacOS/LocalAIAgentMac"
[[ "$(xcrun lipo -archs "$EXECUTABLE")" == 'arm64' ]]
codesign --verify --strict --deep "$APP"
codesign --display --verbose=2 "$APP" > "$BUILD/signature.txt" 2>&1
grep -qx 'Signature=adhoc' "$BUILD/signature.txt"

python3 -I - "$APP" "$VERSION" "$BUILD_NUMBER" <<'PY'
from pathlib import Path
import plistlib
import sys

app = Path(sys.argv[1])
with (app / 'Contents' / 'Info.plist').open('rb') as source:
    info = plistlib.load(source)
assert info['CFBundleIdentifier'] == 'com.localaiagent.mac'
assert info['CFBundleExecutable'] == 'LocalAIAgentMac'
assert info['CFBundleShortVersionString'] == sys.argv[2]
assert info['CFBundleVersion'] == sys.argv[3]
assert info['LSMinimumSystemVersion'] == '13.0'
assert info['CFBundleURLTypes'][0]['CFBundleURLSchemes'] == ['localaiagent']
assert info.get('CFBundleIconName') == 'AppIcon' and info.get('CFBundleIconFile') == 'AppIcon'
# The shell ships no web pages, web icons, manifests or Service Worker: only the native skeleton and its compiled app icon are allowed.
allowed = {'Contents/Info.plist', 'Contents/PkgInfo', 'Contents/_CodeSignature/CodeResources',
           'Contents/Resources/AppIcon.icns', 'Contents/Resources/Assets.car',
           f"Contents/MacOS/{info['CFBundleExecutable']}"}
bundled = {str(path.relative_to(app)) for path in app.rglob('*') if path.is_file()}
assert bundled == allowed, f'Unexpected bundle contents: {sorted(bundled ^ allowed)}'
executable = app / 'Contents' / 'MacOS' / info['CFBundleExecutable']
assert b'/mindfs-assets/' not in executable.read_bytes(), 'Unexpected Relay web asset reference'
PY

ZIP="$BUILD/LocalAIAgentMac-$VERSION-arm64.zip"
# Create a fresh ZIP so an earlier build cannot leave stale entries behind.
ARCHIVE_DIR="$(mktemp -d "$BUILD/archive.XXXXXX")"
trap '[[ ! -f "$ARCHIVE_DIR/app.zip" ]] || unlink "$ARCHIVE_DIR/app.zip"; rmdir "$ARCHIVE_DIR"' EXIT
ditto -c -k --sequesterRsrc --keepParent "$APP" "$ARCHIVE_DIR/app.zip"
unzip -tq "$ARCHIVE_DIR/app.zip"
mv -f "$ARCHIVE_DIR/app.zip" "$ZIP"
(cd "$BUILD" && shasum -a 256 "$(basename "$ZIP")" > "$(basename "$ZIP").sha256")
echo "Verified arm64 app: $APP"
cat "$ZIP.sha256"
