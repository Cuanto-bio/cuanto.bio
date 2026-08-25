# Native wrapper release smoke checklist

Run this on a real device before shipping a native build, or before a web deploy
that changes native-aware code (the wrapper loads cuanto.bio live, so a deploy
reaches app users without an App Store round trip).

For getting a build to TestFlight in the first place — archiving, the App
Store Connect dialogs, and verifying an archive before uploading it — see
`docs/testflight-release.md`. This checklist assumes a build already exists.

This checklist covers **only what a browser or simulator cannot prove**. The
handoff state machine, token storage, platform gating, and the sign-in routing
are already covered by fast automated tests that run with no device:

- Layer 1, unit seams: `src/lib/auth/native.test.ts`, `token.test.ts`,
  `signin.test.ts`, `haptics.test.ts`, `gps/nativeSource.test.ts` (`pnpm test:unit`).
- Layer 2, faked-bridge E2E: `tests/native-wrapper.spec.ts` drives the real
  `isNative()`-gated web code through a fake Capacitor bridge in a browser
  (`pnpm test:integration`). See `docs/testing.md`.

So do not re-verify those here. Verify the OS boundary: the Capacitor bridge, the
App-Bound service worker, the system-browser deep link, and background location.
Use a **device, not the simulator**: the simulator misreports WebKit, App-Bound
Domains, and background behavior (see
`docs/2026-07-22-capacitor-wrapper-spike.md`).

## Setup

1. Point the wrapper at the target host and sync. The host comes from
   `PUBLIC_URL`: `capacitor.config.ts` loads it as `server.url`, and `cap:sync`
   regenerates `ios/Env.xcconfig` from the same value, which Xcode substitutes
   into `WKAppBoundDomains` at build time (`Info.plist` itself doesn't change).
   ```
   # in .env, set both to https://<host>
   #   e.g. a Tailscale funnel for dev, https://cuanto.bio for prod
   PUBLIC_URL=https://<host>
   PUBLIC_OAUTH_CLIENT_ID=https://<host>

   pnpm cap:sync                      # syncs iOS + Android
   ```
   Setting `PUBLIC_OAUTH_CLIENT_ID` to the same host keeps OAuth resolving
   against the origin the wrapper loads.
2. Build, install, and launch, and confirm the plugins are actually linked into
   the binary (a missing plugin still builds clean):
   ```
   scripts/ios-smoke.sh
   ```
   This runs in the simulator and catches the build-clean-but-broken failures
   (blank shell, CORS, unlinked plugins). It is a gate, not a substitute for the
   device checks below.

## On a real device (most-lethal first)

### 1. Cross-origin and offline launch (App-Bound Domains)
- [ ] Fresh launch online: the app loads `/app`, the shell renders, and
      cross-origin content works (iNaturalist search, GBIF, map tiles).
- [ ] Force-quit, enable airplane mode, relaunch: the shell **still renders**
      from the service worker. Cross-origin cards may be blank (no network); that
      is expected. A white screen here means offline launch is broken.

### 2. Sign-in (bearer token, system browser, arbitrary PDS)
- [ ] Sign in with a **non-Bluesky PDS** to exercise arbitrary-PDS. Auth happens
      in the **system browser**, not an in-app webview.
- [ ] The "Return to Cuanto" handoff lands back in the app, signed in.
- [ ] Force-quit and relaunch: **still signed in** (the token survived the
      webview reload / relaunch).
- [ ] Sign out returns to the sign-in screen.
- [ ] Deep-link routing sanity (simulator is fine for this one):
      ```
      xcrun simctl openurl booted 'bio.cuanto.app://auth?code=test'
      ```
      Expect an **in-app error**, not silence. It proves the custom scheme routes
      back to the app and the callback handler runs.

### 3. Background GPS
- [ ] Start a survey with GPS tracking. Lock the screen or background the app for
      a few minutes.
- [ ] Fixes keep arriving: the recorded track / distance keeps growing, and the
      app is **not terminated** on return.
- [ ] The persistent "Recording your survey track" notification shows while
      recording.
- [ ] The location permission prompt is **"While Using the App"** only (we
      deliberately do not ship the always-authorization string; see phase 3).

### 4. Haptics
- [ ] Incrementing a count in a survey (`SurveyForm`) produces a short buzz on
      device. On iOS this routes through the Taptic engine via the vibrate
      bridge; on Android it uses the native Vibration API.

## Android parity

The Android app exists (`android/`). Repeat, on an Android device:

- [ ] Sign-in (system browser, non-Bluesky PDS, return handoff, survives
      relaunch).
- [ ] Offline launch after force-quit + airplane mode.
- [ ] Background GPS while backgrounded / screen locked.
- [ ] Haptics on a survey count.

Note the platform differences: Android detects native via `androidBridge`, its
vibration is the real Web API (the iOS-only vibrate bridge stays inert), and
background-location foreground-service behavior differs from iOS.

## Deliberately out of scope

- **App Store / Play review.** A remote-content wrapper leans on guideline 4.2;
  that is a submission-time risk, not a smoke check.
- **Anything the automated layers already cover.** If a native *logic* bug slips
  through, add or fix a Layer 1 / Layer 2 test rather than growing this list. Per
  the assessment (`docs/2026-07-24-native-e2e-testing-assessment.md`), device
  automation (Maestro, not Detox) is deferred until a device-only regression
  actually recurs.
