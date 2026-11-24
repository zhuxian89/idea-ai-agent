#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD="$ROOT/build/ios"
XCODEGEN="${XCODEGEN:-/opt/homebrew/bin/xcodegen}"
[[ -x "$XCODEGEN" ]] || XCODEGEN="$(command -v xcodegen)"
git -C "$ROOT" check-ignore -q build/ios/x || { echo 'build/ios/ must be git-ignored' >&2; exit 1; }
mkdir -p "$BUILD"
VERSION="$(awk '/^MARKETING_VERSION[[:space:]]*=/ {print $3}' "$ROOT/ios/Version.xcconfig")"
BUILD_NUMBER="$(awk '/^CURRENT_PROJECT_VERSION[[:space:]]*=/ {print $3}' "$ROOT/ios/Version.xcconfig")"
[[ "$BUILD_NUMBER" =~ ^[0-9]+$ ]] || { echo 'Invalid build number' >&2; exit 1; }
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo 'Invalid marketing version' >&2; exit 1; }
ARCHIVE="$BUILD/LocalAIAgent.xcarchive"
STAGING="$(mktemp -d "$BUILD/payload.XXXXXX")"
VERIFY="$(mktemp -d "$BUILD/verify.XXXXXX")"
trap 'rm -rf "$STAGING" "$VERIFY"' EXIT

"$XCODEGEN" generate --spec "$ROOT/ios/project.yml"
# No account, signing identity, exportArchive or provisioning profile is needed.
rm -rf "$ARCHIVE"
xcodebuild archive -project "$ROOT/ios/LocalAIAgent.xcodeproj" -scheme LocalAIAgent \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -archivePath "$ARCHIVE" -derivedDataPath "$BUILD/DerivedData" \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY=""
mkdir -p "$STAGING/Payload"
ditto "$ARCHIVE/Products/Applications/LocalAIAgent.app" "$STAGING/Payload/LocalAIAgent.app"
IPA="$BUILD/LocalAIAgent-$VERSION-unsigned.ipa"
# Fixed ZIP timestamps, sorted entries and no host-specific extra fields. The SDK/compiler
# must also match for reproducible build inputs; this does not promise cross-Xcode byte identity.
python3 -I - "$STAGING" "$IPA" <<'PY'
import os
from pathlib import Path
import stat
import sys
import zipfile
root, output = Path(sys.argv[1]), Path(sys.argv[2])
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    for source in sorted(root.rglob('*')):
        name = source.relative_to(root).as_posix()
        if source.is_dir():
            name += '/'
        entry = zipfile.ZipInfo(name, date_time=(2001, 1, 1, 0, 0, 0))
        entry.create_system = 3
        entry.external_attr = source.lstat().st_mode << 16
        entry.compress_type = zipfile.ZIP_DEFLATED
        data = os.readlink(source).encode() if source.is_symlink() else b'' if source.is_dir() else source.read_bytes()
        archive.writestr(entry, data)
PY
# Verify the final IPA, not only the archive's source app.
unzip -q "$IPA" -d "$VERIFY"
APP="$VERIFY/Payload/LocalAIAgent.app"
xcrun lipo -info "$APP/LocalAIAgent"
[[ "$(xcrun lipo -archs "$APP/LocalAIAgent")" == 'arm64' ]]
file "$APP/LocalAIAgent" | grep -q 'Mach-O 64-bit executable arm64'
xcrun vtool -show-build "$APP/LocalAIAgent" | tee "$BUILD/ipa-platform.txt"
grep -Eq 'platform IOS$' "$BUILD/ipa-platform.txt"
if find "$APP" \( -name '*.mobileprovision' -o -name '*.entitlements' -o -name '*.xcent' \) -print | grep -q .; then
  echo 'Unexpected provisioning profile or entitlement file' >&2; exit 1
fi
if codesign -d --entitlements :- "$APP" > "$BUILD/ipa-entitlements.txt" 2> "$BUILD/ipa-codesign.txt"; then
  echo 'Expected an unsigned app, but found a signature' >&2; exit 1
fi
grep -q 'not signed at all' "$BUILD/ipa-codesign.txt"
! grep -q 'aps-environment' "$BUILD/ipa-entitlements.txt"
python3 -I - "$APP/Info.plist" "$VERSION" "$BUILD_NUMBER" <<'PY'
import plistlib
import sys
with open(sys.argv[1], 'rb') as source:
    info = plistlib.load(source)
assert info['CFBundleIdentifier'] == 'com.localaiagent.app'
assert info['CFBundleDisplayName'] == 'Local AI Agent'
assert info['CFBundleShortVersionString'] == sys.argv[2]
assert info['CFBundleVersion'] == sys.argv[3]
assert info['MinimumOSVersion'] == '16.0'
assert info['UIDeviceFamily'] == [1]
assert info['CFBundleURLTypes'][0]['CFBundleURLSchemes'] == ['localaiagent']
for key in ('NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSPhotoLibraryUsageDescription', 'NSPhotoLibraryAddUsageDescription'):
    assert info[key]
assert info['UILaunchScreen']['UIColorName'] == 'LaunchBackground'
assert info['UIViewControllerBasedStatusBarAppearance'] is True
assert info['UIApplicationSceneManifest']['UIApplicationSupportsMultipleScenes'] is False
scenes = info['UIApplicationSceneManifest']['UISceneConfigurations']
assert scenes['UIWindowSceneSessionRoleApplication'] == [{'UISceneDelegateClassName': 'LocalAIAgent.SceneDelegate'}]
assert 'WKAppBoundDomains' not in info
assert 'aps-environment' not in info
assert 'remote-notification' not in info.get('UIBackgroundModes', [])
assert set(info['UISupportedInterfaceOrientations']) == {'UIInterfaceOrientationPortrait', 'UIInterfaceOrientationLandscapeLeft', 'UIInterfaceOrientationLandscapeRight'}
PY
(cd "$BUILD" && shasum -a 256 "$(basename "$IPA")" > "$(basename "$IPA").sha256")
echo "Verified unsigned arm64 iOS IPA: $IPA"
cat "$IPA.sha256"
