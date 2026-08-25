# Publishing to TestFlight

The mechanical steps to get a build from this repo onto a device via
TestFlight, and the pitfalls that have each cost a full Apple-processing
round-trip (10+ minutes each) to discover. **Verify locally first** (see the
bottom section) — every pitfall below except TestFlight visibility itself can
be caught before you ever upload.

## 1. Point the wrapper at the right host

```
# in .env, uncomment the Production block (or whichever target host), then:
pnpm cap:sync
```

See `docs/native-release-smoke-checklist.md` for the full host-switching
mechanics. Confirm it took:

```
cat ios/Env.xcconfig   # should show WK_APP_BOUND_DOMAIN = <your host>
```

## 2. Bump the build number

`CURRENT_PROJECT_VERSION` in `project.pbxproj` (Xcode: target App → General →
Build). Apple rejects re-uploading a version+build combo that's already been
used — including a combo you uploaded and later found broken. There's no
`agvtool` set up (`VERSIONING_SYSTEM` isn't configured), so this is manual;
bump it before every archive, not just version releases.

## 3. Archive

Product → Archive. Uses the `Release` configuration — **not** the same config
your everyday Run/Debug session uses, and historically the less-exercised one
(see the pitfall below).

## 4. Verify the archive locally before uploading

This is the step that would have saved most of a day's debugging once
already. Don't skip it.

```
ARCHIVE=~/Library/Developer/Xcode/Archives/<date>/<name>.xcarchive
PLIST="$ARCHIVE/Products/Applications/App.app/Info.plist"
/usr/libexec/PlistBuddy -c "Print :WKAppBoundDomains" "$PLIST"
```

Confirm it lists your actual target host (e.g. `cuanto.bio`), not just
`localhost` or an empty entry. An empty/missing host here means the WKWebView
will silently refuse to load anything — a white screen — and no amount of
deleting and reinstalling the app fixes it, because it's baked into the
binary, not cached on the device.

Then install straight to a connected device and check it renders, with no
TestFlight upload at all:

```
xcrun devicectl device install app --device <device-name> \
  "$ARCHIVE/Products/Applications/App.app"
xcrun devicectl device process launch --device <device-name> bio.cuanto.app
```

(`--device` takes the name shown in `xcrun devicectl list devices`, not just a
UUID. Archive folder names contain a narrow no-break space before AM/PM, not a
regular space — use a glob like `*.xcarchive` rather than typing the name.)

## 5. Upload, and get past App Store Connect's dialogs

- **"App Encryption Documentation"**: this app only uses HTTPS via Apple's own
  networking stack, nothing custom. Select **"None of the algorithms mentioned
  above."** `ITSAppUsesNonExemptEncryption = false` is already set in
  `Info.plist` so this shouldn't even prompt going forward.
- **"Missing purpose string" warning (90683) for
  `NSLocationAlwaysAndWhenInUseUsageDescription`**: expected, not a bug. We
  deliberately don't declare it — see
  `docs/2026-07-20-capacitor-phase-3-ios-background-gps.md` §3.2 — so the
  background-geolocation plugin's internal Always-authorization escalation
  stays a silent no-op. It's a warning, not an error; the build still ships.

## 6. Make the build visible to testers

A build showing "Ready to Test" is **not** visible to anyone yet. TestFlight →
Internal Testing → create a group → add testers by Apple ID email (they must
already be a user on the App Store Connect team, under Users and Access).
Sign into TestFlight on the device with that same Apple ID.

## Known pitfall: Release config isn't wired the same as Debug

`ios/Env.xcconfig` (and therefore `WK_APP_BOUND_DOMAIN`) only reaches the app
via `ios/debug.xcconfig`, included through each build configuration's
`baseConfigurationReference` in `project.pbxproj`. If a future Xcode project
regeneration or manual edit ever drops that reference from the `Release`
configs (it did once — Debug had it, Release didn't, silently, for who knows
how long), you get exactly this symptom: works everywhere you'd normally test
(Debug builds, simulator, Safari) and white-screens only in what you actually
ship. Step 4's `-showBuildSettings` check catches this in seconds:

```
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release \
  -showBuildSettings | grep WK_APP_BOUND_DOMAIN
```

Empty output means it's broken.
