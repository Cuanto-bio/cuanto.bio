# Capacitor iOS app — overview

Status: **planning only.** Nothing implemented. No Tangled issues filed yet.

Goal: ship an iOS app that keeps recording a survey's GPS track while the phone
is locked or the app is backgrounded. Everything else here is either a
prerequisite for that or a cheap bonus once the native shell exists.

## Motivation

The PWA is already good offline, but iOS suspends JavaScript when the screen
locks. `useGpsTrack` works around this by holding a **screen** wake lock
(`src/lib/composables/gpsTrack.svelte.ts:38-42`), i.e. we burn the display to
keep `watchPosition` alive. That is the whole problem: no amount of web platform
work fixes it on iOS, and a meaningful share of prospective users are on iOS.

Secondary wins, in rough order of value:

1. **Deep linking / QR codes.** Show a QR for a protocol; a user with the app
   installed lands directly on that protocol. Needs iOS Universal Links, which
   require a native app. Cheap once Capacitor exists, so it does not justify the
   project on its own.
2. **In-app QR scanning.** `BarcodeDetector` is Chrome-only and absent on iOS
   Safari, so scanning inside the app is native-only. Scanning via the system
   Camera app needs nothing.
3. **Haptics.** The single `navigator.vibrate(10)` at
   `src/lib/components/SurveyForm.svelte:900` is a no-op on iOS. Real, but a
   rounding error in this decision. Explicitly **out of scope** for now.

## Architecture decision

Two ways to use Capacitor. We are choosing the second.

**Rejected — remote URL shell** (`server.url` pointed at cuanto.bio). Trivial to
stand up, but it makes offline *worse*: the SW-cached shell moves into a
WKWebView, and **service workers do not run in WKWebView unless the app enables
App-Bound Domains** (iOS 14+: `limitsNavigationsToAppBoundDomains = true` plus a
`WKAppBoundDomains` list in Info.plist, capped at 10 domains). Capacitor has no
built-in support for configuring this; it is a long-standing open feature
request ([ionic-team/capacitor#4122][cap4122],
[ionic-team/capacitor#7069][cap7069]).

So the failure is not that the cached shell gets evicted — it is that
`src/service-worker.ts` never registers, so there is no cached shell and no
offline story at all.

[cap4122]: https://github.com/ionic-team/capacitor/issues/4122
[cap7069]: https://github.com/ionic-team/capacitor/issues/7069

App Store guideline 4.2 ("minimum functionality") is a secondary consideration
rather than a blocker: an app doing real background geolocation is not a bare
repackaged website.

**Chosen — locally bundled `/app`**, talking to cuanto.bio over HTTPS. The
static build of `/app/*` ships inside the IPA and loads from
`capacitor://localhost`. This is a real project, not a wrapper.

A useful consequence: because assets come from the app bundle, the native build
needs **no service worker at all** for offline shell loading, which sidesteps
the app-bound-domains problem entirely rather than fighting it.

### Correction (2026-07-20)

An earlier draft of this doc claimed iOS evicts WKWebView storage under memory
pressure. That is **not accurate** and has been removed. ITP's seven-day cap on
script-writable storage applies to Safari; a WKWebView in an installed app has
its own day counter that resets on every app launch, so the cap effectively
never fires ([Thinktecture][tt], [WebKit][wk]). Nothing found supports memory
pressure as an eviction trigger for WKWebView website data.

[tt]: https://www.thinktecture.com/en/ios/wkwebview-itp-ios-14/
[wk]: https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/

## Why `/app` is already close

`src/routes/app/+layout.ts:1` sets `ssr = false`. Pages under `/app` use
`+page.ts` client loads, state lives in IndexedDB (`src/lib/offline/db.ts`), and
there is a full `/api/*` JSON surface. `src/service-worker.ts:19-44` already
prerenders the `/app/` shell and rewrites it to serve at any path depth. That is
exactly the shape Capacitor wants.

Note that the SW shell-caching machinery serves the *web* PWA only. In the
native build the shell comes from the app bundle, so that code is inert — see
phase 3 for what to do about registration.

## Why it is still three phases

Two things block a static build of `/app`, and one thing breaks at
`capacitor://localhost`:

- `src/routes/app/protocols/+page.server.ts` has a `load` that queries Postgres
  directly. Despite `ssr = false`, this still round-trips to our server today.
- `src/routes/app/protocols/[handle]/[rkey]/+page.server.ts` is form `actions`
  (follow/unfollow). Form actions need an origin server to POST to.
  `adapter-static` rejects any `+page.server.ts` outright.
- Auth is a server-set `did` cookie (`src/routes/oauth/callback/+server.ts:14`,
  read at `src/hooks.server.ts:9`). From `capacitor://localhost` a `cuanto.bio`
  cookie is cross-site and WKWebView will drop it.

## Phases

0. **Background GPS spike** — **done 2026-07-21, passed.** Two hours
   backgrounded on an iPad Air 5, no kills, JS alive throughout, resume after a
   kill works. [phase 0 doc](2026-07-20-capacitor-phase-0-spike.md)
1. **`/app` as a pure static SPA** — own branch, no dependencies.
   [phase 1 doc](2026-07-20-capacitor-phase-1-static-spa.md)
2. **Bearer-token auth** — own branch, no dependencies.
   [phase 2 doc](2026-07-20-capacitor-phase-2-token-auth.md)
3. **Capacitor iOS + background GPS** — own branch, needs 0, 1, and 2.
   Shell, native sign-in and background recording **confirmed on a real device
   2026-07-22**; the durability work (§3.4) and field findings are the postscript
   at the end of the [phase 3 doc](2026-07-20-capacitor-phase-3-ios-background-gps.md).

Phase 0 exists because phase 3's core promise rests on plugin documentation
rather than observation, and the spike needs none of our app to test it. On-device
testing is free with a plain Apple Account, and `UIBackgroundModes` is an
Info.plist key rather than an entitlement, so background location is not gated
behind the $99 program. Spend the $99 when TestFlight and real distribution are
needed, which is late in phase 3.

Phases 1 and 2 are independent of each other and of Capacitor. Both are
defensible improvements to the web app on their own, and both should merge to
`main` and ship to production before phase 3 starts. Phase 3 branches from a
`main` that already contains both.

Deep linking and haptics are deliberately deferred to a phase 4 that is not
planned here.

## Known unknowns

Flagged so they get verified rather than assumed:

- **~~Which background geolocation plugin.~~ Resolved 2026-07-20:**
  `@capgo/background-geolocation` (MPL-2.0, free, actively maintained, tracks
  Capacitor major versions). Paid options are out by decision. See phase 3 §3.1.
  **Resolved 2026-07-21 by phase 0.** Survival exceeded two hours without ever
  hitting a ceiling, and resume after a kill works. Both risks retired.
- **App Review.** Background location gets scrutiny. Less than feared, though:
  we request **When In Use**, not Always (see phase 3 §3.2), which avoids the
  permission that draws the hardest questions. Still expect to justify in
  writing why a survey app records in the background.
- **Testing hardware.** An iPad mini with GPS (cellular models only; wifi-only
  iPads have no GPS chip) covers a lot, but nobody carries an iPad on a survey,
  and iPad background/termination behavior is not identical to iPhone. The
  asymmetry matters: an iPad has more battery and RAM headroom, so it faces less
  memory pressure than a phone. **A pass on iPad is not proof; a failure on iPad
  is conclusive.** Getting an iPhone, or lining up TestFlight testers (which
  needs the paid program), should happen before phase 3 integration work.
- **Service workers on `capacitor://localhost`.** Reportedly they do not work,
  since SW registration wants http/https rather than a custom scheme. Only one
  secondhand source for this so far; verify early. Either way the native build
  should stop registering the SW explicitly rather than let it fail silently —
  registration happens in `src/routes/+layout.svelte`.
- **Release coupling.** Users pin old bundled shells, so `/api/*` becomes a
  public versioned contract that must stay backward compatible.
- **Cost.** $99/yr Apple Developer account. The geolocation plugin is free
  (MPL-2.0), and paid plugins are out by decision.

## The bug class to design against

A track that looks continuous but is not. Two ways to get there: points
collected and never persisted (the 10s autosave window, widened), or a gap that
gets stitched over instead of disclosed. The second is the more dangerous one
now that termination gaps are an expected part of normal operation — a survey
that silently omits 25 minutes is worse than one that says so, because only the
first is quietly wrong.

`src/lib/gpx.ts` already segments the exported track on 5-minute gaps, which is
the right instinct. `src/lib/distance.ts:42` deliberately bridges them, which
was reasonable for short signal drops and deserves a fresh decision at
termination-gap scale. Phase 3 §3.4 covers both.

An earlier draft framed this as "iOS kills the webview and a native buffer
replays in a batch." That is not the model these plugins use — see phase 3,
"What is actually achievable."
