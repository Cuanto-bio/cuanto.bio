#!/usr/bin/env bash
# Build, install and launch the iOS app in a simulator, then report enough state
# to tell whether it actually works — rather than whether it merely compiled.
#
# Exists because every native bug in this project so far passed `BUILD
# SUCCEEDED` and looked fine until someone ran it:
#
#   - Capacitor's router served the root index.html for every extensionless
#     path, so the shell redirect looped forever and the screen stayed blank.
#   - Every /api response was blocked by CORS. The server logged 200s; the app
#     saw failures and reported itself offline.
#   - Two plugins were never compiled into the binary. `cap sync` and
#     `-resolvePackageDependencies` both reported success.
#
# None of those are caught by a test suite, and none are visible from the build
# log. They are caught by looking at the running app and at what the server
# actually received.
#
# Usage: scripts/ios-smoke.sh [simulator-name]
set -euo pipefail

SIM="${1:-iPhone 16}"
APP_ID="bio.cuanto.app"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${TMPDIR:-/tmp}/cuanto-ios-smoke"
mkdir -p "$OUT"

cd "$ROOT"

# No web bundle to build: the wrapper loads the site from server.url. The web
# app updates by deploying, not by rebuilding the shell.
echo "==> Syncing to iOS"
pnpm exec cap sync ios >/dev/null

echo "==> Building app"
(cd ios/App && xcodebuild -scheme App -sdk iphonesimulator -configuration Debug \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build \
  >"$OUT/xcodebuild.log" 2>&1) || { tail -30 "$OUT/xcodebuild.log"; exit 1; }

# Several DerivedData dirs can exist for projects that share the name "App"
# (Capacitor's default), so match on the recorded workspace path rather than
# taking the newest. A plain glob loop, not `ls | while`: `break` inside a
# pipeline sends SIGPIPE upstream, which under `pipefail` empties the
# assignment and makes every later check silently examine a path that does not
# exist — reporting all plugins missing when they are all present.
DD=""
for d in "$HOME"/Library/Developer/Xcode/DerivedData/App-*; do
  [ -d "$d" ] || continue
  wp=$(/usr/libexec/PlistBuddy -c "Print :WorkspacePath" "$d/info.plist" 2>/dev/null || true)
  case "$wp" in "$ROOT"/*) DD="$d"; break ;; esac
done
if [ -z "$DD" ]; then
  echo "Could not find DerivedData for $ROOT" >&2
  exit 1
fi
APP="$DD/Build/Products/Debug-iphonesimulator/App.app"
DYLIB="$APP/App.debug.dylib"
if [ ! -f "$DYLIB" ]; then
  echo "No built app at $DYLIB" >&2
  exit 1
fi

# The check that would have saved two debugging cycles. A plugin missing from
# the binary still builds clean and only fails at runtime, with a message that
# reads like a plugin bug rather than a stale Xcode package cache. If this
# fails: rm -rf ~/Library/Developer/Xcode/DerivedData/App-*
echo "==> Verifying plugins are linked (not just installed)"
# Read the symbols once into a variable and match with `case`, rather than
# piping into `grep -q`: grep exits on the first match, strings takes SIGPIPE,
# and under `pipefail` the pipeline reports failure — so the check would say
# MISSING exactly when the class *is* present. A verification script that lies
# in the reassuring direction would be bad enough; this one lied in the alarming
# direction and cost a debugging cycle chasing a build that was already correct.
SYMS=$(strings "$DYLIB" 2>/dev/null || true)
MISSING=0
for cls in CAPBrowserPlugin AppPlugin BackgroundGeolocation; do
  case "$SYMS" in
    *"$cls"*) echo "    ok      $cls" ;;
    *) echo "    MISSING $cls"; MISSING=1 ;;
  esac
done
if [ "$MISSING" = 1 ]; then
  echo
  echo "One or more plugins were not compiled into the binary."
  echo "Xcode caches the local CapApp-SPM/Package.swift manifest; clean and"
  echo "-resolvePackageDependencies do NOT invalidate it. Fix with:"
  echo "  rm -rf ~/Library/Developer/Xcode/DerivedData/App-*"
  exit 1
fi

echo "==> Booting $SIM"
xcrun simctl list devices booted | grep -q "$SIM" || xcrun simctl boot "$SIM" >/dev/null 2>&1 || true
xcrun simctl bootstatus booted -b >/dev/null 2>&1 || true

echo "==> Installing and launching"
xcrun simctl terminate booted "$APP_ID" >/dev/null 2>&1 || true
xcrun simctl install booted "$APP"
xcrun simctl launch booted "$APP_ID" >/dev/null

sleep 12
SHOT="$OUT/screen.png"
xcrun simctl io booted screenshot "$SHOT" >/dev/null 2>&1

echo
echo "Screenshot: $SHOT"
echo
echo "Now check, in this order — each has hidden a real bug:"
echo "  1. Does the screen render at all? (blank = routing or a JS throw)"
echo "  2. Does the app agree with the server? Watch the dev server log while"
echo "     using it. A 200 the app treats as a failure means CORS, not offline."
echo "  3. Is the error on screen the real one, or a guess? Generic messages"
echo "     hid a missing plugin and a bad API origin."
echo
echo "To exercise the sign-in callback without a real PDS:"
echo "  xcrun simctl openurl booted '$APP_ID://auth?code=test'"
echo "  (expects an error — it proves the deep link routes and the handler runs)"
