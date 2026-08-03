# Phase 3 — Capacitor iOS shell with background GPS

Part of [the Capacitor iOS plan](2026-07-20-capacitor-ios-overview.md).
Branches from a `main` that already contains **phase 1 and phase 2**.

## Goal

An iOS app, installed from TestFlight, that records a survey's GPS track
continuously while the screen is locked and the app is backgrounded, and loses
no points when iOS terminates the webview.

Scope discipline: background geolocation is the *only* native plugin in this
phase. Deep linking, QR scanning, and haptics are deferred.

## Prerequisites

- **Phase 0 run, with findings recorded.** Its results decide whether this phase
  is worth doing and settle several design questions below (delivery shape,
  timestamp stability, whether `accumulate()`'s warm-up still earns its keep).
  Do not start here on assumptions phase 0 exists to replace.
- Phase 1 merged: `pnpm build:app` emits a static `/app` bundle.
- Phase 2 merged: `/api/*` accepts bearer tokens.
- A real iOS device. The cellular iPad mini works for most testing; see
  "Hardware reality" below.
- Apple Developer account ($99/yr) — needed for TestFlight and distribution, but
  **not** for on-device testing. Defer the spend until 3.6.

## Current GPS implementation

Read these before starting; the design below is shaped by them.

- `src/lib/composables/gpsTrack.svelte.ts` — `useGpsTrack()`. Holds a
  `$state` points array, a `watchPosition` watch id, a **screen** wake lock, and
  a `WindowState`. `start()` / `stop()` / `flushWindow()`.
- `src/lib/gpsTrackWindow.ts` — `accumulate(state, point)`, a pure reducer.
  Two phases: an elastic warm-up window that commits the best-so-far once
  accuracy converges (`WARMUP_IMPROVE_M`, `WARMUP_STABLE_FIXES`) or
  `WARMUP_TIMEOUT_MS` elapses, then fixed `RECORD_INTERVAL_MS` (10s) windows
  emitting the lowest-accuracy fix per window.
- `src/lib/components/SurveyForm.svelte` — `useGpsTrack` at :285. Autosaves the
  draft every 10s (:473), on `beforeunload` (:478), and on `beforeNavigate`
  (:491). Persists a `trackRecording` flag and calls
  `shouldResumeTrackRecording()` on mount (:461) to pick recording back up.
- `src/lib/offline/db.ts` — `PendingSurvey.gpsTrack`, plus a `gps-tracks` store
  keyed by `atUri` for finished surveys.

**The good news:** the resume machinery largely exists. A draft already survives
navigation and reload, and already knows whether it was recording.

**The property that makes this tractable:** `accumulate()` is a pure reducer
over a sequence of fixes. Replaying a batch of buffered fixes through it yields
the same result as if they had arrived live, *provided* `WindowState` is
persisted alongside the draft so replay resumes mid-window instead of
restarting warm-up. Getting this right is most of the correctness work.

## What is actually achievable (revised 2026-07-20)

An earlier draft of this doc assumed the plugin buffers fixes natively while JS
is dead and delivers them in a batch on resume, and set "recover the track after
iOS terminates the app" as a done criterion. Research into the actual plugins
says that is the wrong model and the wrong target.

**Backgrounded but alive — the real target, and achievable. Confirmed on device
2026-07-21** (phase 0 run 1): two hours in a backpack, screen off, unplugged, no
termination, fixes at a metronomic 1Hz, and a max heartbeat gap of 21.9s against
a 10s interval — timer coalescing, not suspension.

With `UIBackgroundModes: location` and an active location session the app keeps
running, so the webview's JS keeps executing. Fixes arrive one at a time into a
running context, exactly as `watchPosition` delivers them today. This is the
actual pain point — lock the phone, walk the transect — and the thing the screen
wake lock is currently a bad substitute for.

**Terminated — mostly not achievable, and out of scope for v1.** On iOS,
location services do not resume after the app is terminated, short of
significant-location-change or region monitoring (coarse, useless for a survey
track) or the iOS 17+ CoreLocation relaunch APIs, which neither free plugin
documents using. Neither plugin documents any local persistence of fixes either.

So the honest v1 promise is: **continuous recording while the app is alive and
backgrounded; a termination pauses the track, and reopening the app resumes it
with an honest gap.**

That second clause is the accepted requirement (confirmed 2026-07-20): surveys
can run for hours, and a survival ceiling around 90 minutes is fine *provided
recording picks back up when the app returns to the foreground*. A gap in the
track is acceptable. A survey that silently stops recording is not.

This reframes the phase. The hard part is no longer squeezing more survival out
of iOS — it is **resuming cleanly and representing the gap honestly**, which is
our code, not the plugin's. See 3.4.

Defensive note: if the plugin *does* ever deliver a batch (on resume from a
long background stretch, say), the drain path must still handle it correctly.
Design for one-at-a-time, but do not assume it.

## Work items

### 3.1 Plugin choice

`@capacitor/geolocation` does not do background. Paid options (Transistor
Software) are out of scope by decision — we are not paying for this.

**Chosen: [`@capgo/background-geolocation`][capgo]** (MPL-2.0, free).

Compared with [`@capacitor-community/background-geolocation`][community]:

| | capgo | community |
| --- | --- | --- |
| Licence | MPL-2.0, free | MIT, free |
| Latest | v8.3.1, 2026-07-11 | v1.2.26 |
| Capacitor | tracks major versions (v8 → Cap 8) | v1 branch covers Cap 3–7 |
| Cap 8 | supported | [crashes on background][cap8] |

The deciding factor is maintenance, not features. The community plugin has an
open crash-on-backgrounding report against Capacitor 8 ([issue #156][cap8],
filed 2026-04-17) with **no maintainer response, no assignee, and no PR** three
months on. That crash trace is Android-specific
(`java.lang.NullPointerException` in `handleOnPause`), so it may not bite an
iOS-first build directly, but three months of silence on a crash report is the
signal that matters for something this load-bearing.

Ignore the feature comparison table in capgo's README that calls the community
plugin "not accurate" — that is a vendor comparing itself to a competitor, not
a finding.

[capgo]: https://github.com/Cap-go/capacitor-background-geolocation
[community]: https://github.com/capacitor-community/background-geolocation
[cap8]: https://github.com/capacitor-community/background-geolocation/issues/156

**What neither plugin gives us**, and this could not be verified from either
project's docs: local on-device persistence of fixes across app termination.
Capgo's docs page does not address local buffering, queueing, or termination at
all. Assume it does not exist until proven otherwise on a device.

Capgo does offer **native HTTP POST delivery** — fixes POSTed as JSON straight
from native code, bypassing the webview. Do not be tempted. There is no
documented offline retry or queue, and surveys happen in the field with no
signal. Streaming a user's live location to our server during a survey is also
a privacy posture we have not chosen. **We are not using this feature.**

### 3.2 Capacitor scaffolding

> **Adding a plugin requires deleting DerivedData.** Not a clean build — that
> is not enough, and neither is `xcodebuild -resolvePackageDependencies`, which
> reports the new package resolved while the build still omits it. Xcode caches
> the *local* `CapApp-SPM/Package.swift` manifest, so `cap sync ios` rewriting
> that file has no effect on the build graph until the cache is purged:
> `rm -rf ~/Library/Developer/Xcode/DerivedData/App-*` (or Xcode → File →
> Packages → Reset Package Caches).
>
> The symptom is a runtime `"<Name>" plugin is not implemented on ios` from a
> plugin that is plainly installed, which reads like a plugin bug. A clean build
> *appears* to fix it and then regresses on the next incremental build, which is
> worse than a consistent failure. Verify the fix took by checking the module
> was compiled at all, not just that the build succeeded:
>
> ```
> ls ~/Library/Developer/Xcode/DerivedData/App-*/Build/Intermediates.noindex/
> strings ios/.../App.app/App.debug.dylib | grep <PluginClassName>
> ```
>
> `-ObjC` in OTHER_LDFLAGS is *not* the fix; the plugin is never compiled, so
> there is nothing for the linker to strip. Cost two debugging cycles on
> 2026-07-22.

- Add `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`.
- `capacitor.config.ts` with `webDir` pointing at the phase-1 static output and
  an explicit `appId` (e.g. `bio.cuanto.app`).
- `Info.plist`: `UIBackgroundModes: [location]` plus
  `NSLocationWhenInUseUsageDescription`. Write the usage string carefully —
  App Review reads it.
- Decide whether the `ios/` directory is committed. Recommend yes; it holds
  signing config and plist edits that are painful to regenerate.

**Request "When In Use", not "Always"** (decided 2026-07-20). iOS allows
background location updates under *either* authorization, given
`allowsBackgroundLocationUpdates = true` and the location background mode
([Apple][abgl]). "Always" buys exactly one thing: the system relaunching a
terminated app via significant-location-change, visits, or region monitoring —
which we have already decided not to rely on.

So "Always" would be asking for a scarier permission, with a materially lower
grant rate and the App Review scrutiny that comes with it, to enable a
capability we do not use. When In Use is strictly better here.

Consequence: iOS shows a persistent blue status-bar indicator while recording in
the background. That is honest and worth keeping rather than something to
design around.

**Caveat found while building the spike: capgo does not support this cleanly.**
Reading `ios/Sources/.../CapgoCapacitorBackgroundGeolocationPlugin.swift`:

```swift
let background = call.getString("backgroundMessage") != nil
...
manager.allowsBackgroundLocationUpdates = background
manager.showsBackgroundLocationIndicator = background
...
if background { manager.requestAlwaysAuthorization() }
else { manager.requestWhenInUseAuthorization() }
// and, if already When In Use: "Attempt to escalate."
if background && status == .authorizedWhenInUse {
    manager.requestAlwaysAuthorization()
}
```

`backgroundMessage` is the only switch for background delivery, and setting it
also makes the plugin request Always and re-attempt escalation. So we cannot
simply ask for When In Use through the plugin's own API.

The reason to think it still works: `allowsBackgroundLocationUpdates` is set
from the *option*, not from the *granted* status. A user who declines the
escalation should keep getting background updates under When In Use, matching
Apple's documented behavior. **Unverified.** Phase 0's permission experiment
exists to settle it — decline the escalation, confirm `when_in_use`, walk.

If it holds, the real app requests the softer permission and lets users decline
the escalation prompt. If it does not, either patch the plugin (MPL-2.0, and
the change is a few lines) or accept Always and reinstate the App Review
concern above. Do not treat "When In Use" as settled until the walk says so.

[abgl]: https://developer.apple.com/documentation/corelocation/cllocationmanager/allowsbackgroundlocationupdates

### 3.2a Disable the service worker on native

The shell comes from the app bundle, so the SW is unnecessary natively — and
probably non-functional, since service workers do not run in WKWebView without
App-Bound Domains, and reportedly do not register on a `capacitor://` custom
scheme at all. We are deliberately *not* enabling app-bound domains; the whole
point of bundling is to not need them.

Make this explicit rather than incidental: gate the whole
`if ('serviceWorker' in navigator)` block at `src/routes/+layout.svelte:49-87`
on `!Capacitor.isNativePlatform()`. A silently failing `register()` is a
debugging trap for whoever hits it next.

Two things inside that block are not merely dead code on native, they are
*wrong*:

- The "A new version is available / Reload" toast (:61-73) and the
  `controllerchange` reload (:82-86) are the **web** update mechanism. Native
  app updates come through the App Store. Leaving this active would be a second,
  conflicting update path. This is the concrete form of the release-coupling
  risk noted in the overview: once shells ship in an IPA, `/api/*` has to stay
  backward compatible because there is no SW to force a client refresh.
- `install.init()` (:47) drives the PWA install prompt. Prompting someone to
  install the PWA from inside the installed native app is nonsense; suppress it
  too. See `docs/2026-05-30-pwa-install-prompt.md` for what that machinery does.

Confirm while doing this that nothing under `/app` depends on the SW being
present — offline data goes through IndexedDB (`src/lib/offline/db.ts`), so it
should not, but the offline banner's ping check and anything reading the
`public-pages` cache are worth grepping for.

### 3.3 Native track source behind the existing interface

Do **not** fork `SurveyForm.svelte`. `useGpsTrack()` already exposes a narrow
surface: `points`, `isRecording`, `start()`, `stop()`. Keep it, and swap the
fix *source* underneath based on platform.

Shape to aim for:

- Extract the current `watchPosition` wiring into a web source module.
- Add a native source module wrapping capgo's `addWatcher`-style API, emitting
  the same shape of fix.
- `useGpsTrack` selects a source at construction (`Capacitor.isNativePlatform()`)
  and otherwise behaves identically.

Because fixes arrive in a live JS context on native too (see "What is actually
achievable"), the source interface is a callback per fix, the same as
`watchPosition`. No buffer-draining API is needed on the happy path.

The screen wake lock should be **dropped on native** — that is the entire point.
Keep it on web. `acquireWakeLock` already no-ops when `wakeLock` is absent, but
make the native case explicit rather than incidental.

Check whether the plugin's own distance/time filtering makes the `accumulate()`
warm-up logic redundant before porting it wholesale. It may be better to
configure the plugin to deliver raw fixes and keep our windowing, so web and
native produce comparable tracks. Prefer that unless there is a battery reason
not to.

### 3.4 Durable points and honest resume

The heart of the phase, and mostly existing code plus one genuine gap.

**Persist as you go.**

- Persist each emitted point to IndexedDB as `accumulate()` emits it, rather
  than waiting for the 10s autosave at `SurveyForm.svelte:473`. That interval
  keeps its job for the rest of the draft; the track stops depending on it.
- Keep the write cheap: one put per *emitted* point at `RECORD_INTERVAL_MS`
  (10s), not per raw fix, which arrives far more often.
- Handle batch delivery defensively — fold an array through `accumulate()` and
  persist once at the end, so a burst is not one write per fix.
- Idempotency: if the app dies mid-write, resuming must not duplicate points.
  **Do not use a high-water mark on fix timestamp.** Phase 0 measured 3
  duplicate `time` values across 6987 fixes, and two of the three carried
  *different positions* — so `>` drops real fixes and `>=` fails to dedupe.
  Compare the full tuple (time, lat, lng, accuracy) instead. Timestamps are
  otherwise well-behaved: zero null, zero out-of-order.

**Do *not* persist `WindowState`.** An earlier draft called for this so a
resumed draft could continue mid-window. On reflection it is not worth it: a
fresh `useGpsTrack` calls `emptyWindow()`, which sets `warmingUp: true`, and
after a termination that is exactly right — the GPS is cold again and warm-up
convergence is precisely the logic for that situation. The cost of not
persisting is the in-progress window's best point, at most one 10s interval.
Against an accepted multi-minute gap, that is noise. YAGNI.

**Getting the user back to the draft — the real gap.** After a cold relaunch,
Capacitor opens at the app's entry URL, not wherever the user was. So the user
lands on the home screen with an in-progress recording draft sitting in
IndexedDB and no indication it exists. `shouldResumeTrackRecording()`
(`SurveyForm.svelte:461`) resumes recording once they are *in* the form; nothing
gets them there.

Needed:

- On app start, check for a `PendingSurvey` with `trackRecording: true`.
- Surface it prominently — either auto-navigate to the draft, or a persistent
  "Survey in progress" banner. Auto-navigation is probably right for a recording
  draft, since the user's intent is unambiguous; confirm the interaction.
- This belongs in a module initialized from `src/routes/app/+layout.ts`, not the
  form component, since the whole point is that the form is not mounted.

**Tell the user about the gap.** On resume, compare the last point's timestamp
to now. If the gap exceeds a threshold, say so: "Recording was interrupted for
about 25 minutes." Silent resumption lets someone believe they have a continuous
track when they do not, which is a data-integrity problem, not a UX nicety.

Reuse `GAP_THRESHOLD_MS` from `src/lib/gpx.ts:9` (5 minutes) as the threshold so
the notice and the GPX segmentation agree. A gap that splits a `<trkseg>` should
be a gap the user was told about.

**Open question for the user, not for the implementer.** `trackDistanceMeters`
(`src/lib/distance.ts:42`) deliberately bridges gaps, on the documented
reasoning that the surveyor walked that ground regardless. That holds for a
short signal drop. A 30-minute termination gap is a different magnitude of
assumption, and on a loop transect a straight-line bridge can understate the
distance badly. Since track length is plausibly a sampling-effort denominator,
decide explicitly whether to keep bridging, stop counting across `trkseg`
boundaries, or report distance with a caveat. **Do not change this silently —
the current behavior is deliberate and its comment says so.**

### 3.5 Auth wiring

Use the phase-2 bearer flow: system browser via `ASWebAuthenticationSession`,
token into the **iOS Keychain**, attached to every `/api/*` call. Keychain
rather than IndexedDB because it is the platform-idiomatic credential store,
survives reinstall, and is protected at rest — not because of any storage
eviction risk (see the correction in the overview doc).

`src/routes/app/+layout.ts` currently redirects to `/auth/signin` when
`/api/me` 401s or no IDB user exists. On native that redirect must open the
system browser flow instead of navigating the webview.

### 3.6 Build and release

- A `pnpm` script chain: build the static app, `npx cap sync ios`, open Xcode.
- TestFlight before App Store. Recruit iOS testers early.
- `PUBLIC_URL` / API base must be configurable per build so a dev build can
  point at a local server.

## Testing

Automated coverage is limited here, so be deliberate about what *is* automatable:

- **Unit** — a track survives being interrupted at an arbitrary point and
  resumed from IndexedDB with no loss or duplication, including mid-window.
  Highest-value test in the phase; write it first. Also: folding a batch of
  fixes through `accumulate()` matches the same fixes delivered one at a time,
  and `WindowState` round-trips through IndexedDB.
- **Integration** — existing Playwright suites must stay green; the web source
  path is unchanged.
- **Manual on device**, none of which can be faked in the simulator:
  1. Start a survey, lock the screen, walk 15+ minutes, unlock. Points
     continuous, with no gap at the lock boundary? **This is the phase.**
  2. Same, but with the app backgrounded behind another app rather than locked.
  3. Force-quit mid-walk, keep walking for 10+ minutes, then reopen the app.
     **This is the second half of the phase.** Verify: the draft is surfaced
     without hunting for it, recording resumes, the user is told about the gap,
     the exported GPX has two `<trkseg>` elements, and no points are lost or
     duplicated at either edge of the gap.
  4. Airplane mode throughout, then reconnect. Does sync still work?
  5. Deny location permission outright, and separately grant it then revoke it
     mid-survey. Does the app degrade honestly rather than claiming to record?
  6. Battery drain over a realistic survey length, compared against the current
     wake-lock PWA.
  7. Long survey (2+ hours), backgrounded, without intervening. Expect one or
     more termination gaps. Verify the track is a coherent multi-segment record
     rather than a mess, and that repeated resume cycles do not accumulate
     drift, duplicates, or a runaway IndexedDB draft.

Track these as a written checklist; they will be re-run every time the plugin or
its config changes.

## Hardware reality

The cellular iPad mini has real GPS and will catch most bugs. It will not tell
you the truth about: iPhone-specific background scheduling, how aggressively iOS
terminates under real phone memory pressure, or how the app behaves in a pocket
during an actual survey. Get an iPhone or TestFlight testers before 3.4
integration work, not after.

## Done when

- Screen-locked and backgrounded recording verified on a real device across the
  manual scenarios above.
- After a termination, reopening the app surfaces the in-progress draft without
  the user having to go looking for it, and recording resumes.
- Gaps are represented honestly: the user is told, and the GPX segments.
- No point loss or duplication at gap boundaries, across repeated cycles.
- The distance-across-gaps question is decided and recorded, whichever way.
- Battery drain is meaningfully better than the wake-lock PWA.
- App accepted to TestFlight.
- `pnpm check` and `pnpm test` pass.

## Risks

- **Resume is now the single point of failure.** Phase 0 questions 1 and 2 cover
  it; if phase 0 was skipped, stop and run it. Survival being shorter than hoped
  is survivable. Resume being unreliable is not, because every survey longer
  than the ceiling depends on it and the failure is silent — the user believes
  they are still recording.
- **Gap disclosure is a data-integrity feature, not polish.** If it slips to
  "later," the app ships quietly producing tracks that omit time without saying
  so. Treat it as part of 3.4, not a follow-up.
- **App Review rejection** over background location. Expect a round. Have the
  scientific-survey justification written before submitting.
- **capgo is one project's output.** MPL-2.0 means we can fork and patch if it
  goes unmaintained, which is the practical insurance. Keep the native source
  module thin so a plugin swap touches one file.
- **Silent data corruption** is the worst outcome and the least visible. Favor
  over-testing 3.4.
- **Scope creep.** Deep linking will be tempting once the shell exists. Defer it.

## Postscript — first device test (2026-07-22)

**Background GPS recording works on a real device.** A survey walk (counting
butterflies) recorded a track through screen-lock and backgrounding, which is
the outcome the whole plan was built to reach. The central bet paid off.

### What it took to get the shell working, and the lesson

Five bugs stood between "compiles" and "signs in and records". **None was
catchable by the test suite or the build log.** Every one surfaced only by
running the app and looking at it — which is why `scripts/ios-smoke.sh` exists
and why "it builds" stopped counting as "it works" partway through.

1. **Capacitor serves the root `index.html` for every extensionless path**
   (`ios/.../Router.swift`), so a shell at `/app/index.html` with a redirect
   from `/` looped forever. Fixed by putting the shell at the root and
   correcting the path to `/app/` in an inline script before hydration.
2. **CORS blocked every `/api` response.** The app is cross-origin
   (`capacitor://localhost`); the server logged 200 while WebKit refused to hand
   the body to JS. Looks exactly like being offline. See `src/lib/server/cors.ts`.
3. **The fetch rewrite missed SvelteKit's own `load` requests**, which arrive
   with an already-resolved absolute URL rather than the relative path our call
   sites use. Also exposed that `URL.origin` is the string `"null"` for
   `capacitor:`. See `rewriteTarget` in `src/lib/apiBase.ts`.
4. **SFSafariViewController drops redirects to custom schemes** without user
   interaction (Apple's own documentation), so the OAuth callback silently never
   reached the app. Fixed with a tappable handoff page — `nativeHandoffPage` —
   rather than a 302. `ASWebAuthenticationSession` would remove the tap but needs
   native code; deferred.
5. **The exchange-code TTL (2 min) assumed an automatic redirect.** With a page
   the user reads and taps through, codes expired into a 401 that read as a
   broken exchange. Now 10 min.

Plus: free ngrok returns an HTML interstitial to browser User-Agents (the app
sends `ngrok-skip-browser-warning`); `Access-Control-Max-Age` cut to 10 min so a
cached preflight cannot outlive a fix to the allow-list; `viewport-fit` + safe
areas, which also fixed a latent PWA bug where mobile-nav's bottom inset was
always 0.

### State at the end of the first test

- **Bearer token is in memory only.** A cold launch requires signing in again.
  Pending the Keychain-plugin decision (§3.5). Not a security compromise;
  persisting to `@capacitor/preferences` would be, which is why it was not done.
- **Diagnostic tracing is still in the tree, marked TEMPORARY**
  (`src/lib/auth/authTrace.ts`, the trace UI on `/app/signin`, `onTrace` in
  `native.ts`). Kept deliberately — it is what located each of the five bugs.
  Remove once sign-in is confirmed stable.
- **§3.4 is not started.** Today proved recording *works*; it did not build
  persist-each-point, resume-after-kill, or gap disclosure. That is the next
  substantive chunk, and it should be shaped by the field findings below.

### Field findings from the walk

Recording worked; several other problems surfaced during real use. **To be
filled in** from field notes — captured here rather than lost, because problems
found on an actual survey are the right input for §3.4 and for whatever UX work
follows, more than anything predicted from a desk.

- _(pending detail)_
