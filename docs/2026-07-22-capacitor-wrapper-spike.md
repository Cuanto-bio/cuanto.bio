# Capacitor wrapper spike — service worker + app-bound domains

Status: **planning only.** Nothing built.

This spikes an *alternative* architecture to the one in
[the main plan](2026-07-20-capacitor-ios-overview.md). That plan bundles `/app`
into the IPA; this one loads cuanto.bio live over the network, so a web deploy
reaches app users with no App Store round trip. The bundled approach works today
(branches 44–46); the open question is whether the wrapper can match it on
offline launch without giving up arbitrary-PDS support.

## Why this needs a spike rather than a decision

The wrapper wants three things that pull against each other:

- **Auto-update** → load cuanto.bio live (`server.url`), don't bundle.
- **Offline launch** → the service worker must cache and serve the shell, which
  in WKWebView requires App-Bound Domains.
- **Arbitrary PDS** → sign-in can't navigate the app-bound webview off-domain,
  so it happens in the system browser and returns a bearer token (the flow
  already built on branch 46).

Bearer tokens resolve the auth tension cleanly: sign-in in the system browser
reaches any PDS, and the token is attached to same-origin `/api` calls, so no
cookie ever has to cross from the browser into the app-bound webview. That part
is known-good — it is branch 46's flow with the URL rewrite removed.

What is **not** known, and cannot be settled from documentation, is whether
App-Bound Domains actually delivers a working service worker, and whether it
breaks the third-party requests the app depends on. Both were checked against
Apple/WebKit docs and both came back ambiguous. They decide the whole approach,
so they get a device, not an assumption.

## The architecture under test

- One WKWebView, `server.url` → cuanto.bio (or a stand-in — see hosting).
- `ios.limitsNavigationsToAppBoundDomains = true` (a Capacitor config option
  since 3.1.0 — it is not native patching, contra an earlier note in the main
  plan).
- `WKAppBoundDomains` = the content host + `localhost`.
- Sign-in via `@capacitor/browser` + `@capacitor/app` custom-scheme callback →
  PKCE code exchange → bearer token (branch 46, unchanged).
- Token in IndexedDB, not memory: it must survive a webview reload, or an
  offline cold-launch lands on a sign-in screen.
- Background GPS via `@capgo/background-geolocation`, called from the remote JS
  through the injected Capacitor bridge.

## Questions, most-lethal first

1. **Does app-bound mode still allow the app's third-party cross-origin
   requests?** iNaturalist (`api.inaturalist.org`), GBIF (`api.gbif.org`), and
   MapLibre tiles are all cross-origin. If app-bound blocks them this is **dead
   and unpatchable** — you cannot allowlist them inside the 10-domain cap. This
   is the kill switch; test it before anything else.
2. **Does the service worker register, cache, and serve the shell so the app
   launches offline** in an app-bound WKWebView loading remote content? This is
   the entire reason to enable app-bound domains. If it fails, the wrapper gives
   no offline launch and you are back to "offline data yes, launch no."
3. **Does system-browser bearer sign-in work when the web code is served
   remotely?** Lower risk — the bridge is known to inject into `server.url`
   content, and the flow is proven on branch 46 — but confirm it in this config.
4. **Does background GPS record** with the plugin called from remote JS? Also
   low risk (proven in phase 0), confirm in this config.
5. **Does the bearer token survive a webview reload** (IndexedDB), so an offline
   cold-launch stays signed in rather than bouncing to sign-in?

Questions 1–2 are architectural: a failure kills the approach. Questions 3–5 are
integration: a failure is fixable.

## Build it in two stages

Front-load the kill switch. Do not wire up auth and GPS against an architecture
that a 20-line harness could have ruled out in an afternoon.

### Stage A — minimal harness (answers 1, 2, and offline launch)

A throwaway static site, three files, no cuanto.bio code:

- `index.html` — shows service-worker state, a button that `fetch`es a
  cross-origin CORS API (iNaturalist), an `<img>` from a cross-origin tile
  server, and whether each succeeded.
- `sw.js` — caches `index.html` and serves it on fetch failure.
- `manifest.webmanifest`.

Deploy it to a **stable HTTPS host** (GitHub Pages, a Railway static service —
anything with a fixed domain, since app-bound lists it). Then a bare throwaway
Capacitor project (like `cuanto-gps-spike`) with `server.url` → that host and
the app-bound config listing it.

Test on device:

- Service worker reports **active**?
- Cross-origin `fetch` and `<img>` both **succeed**? (Question 1 — the killer.)
- Airplane mode, force-quit, relaunch → the shell **still loads**? (Question 2.)
- Sanity control: turn `limitsNavigationsToAppBoundDomains` **off** and confirm
  the service worker stops registering — proving app-bound domains is what
  enabled it, not something incidental.

**If cross-origin fails, stop here.** The wrapper cannot support this app, and
the only auto-update path left is bundled + OTA (`@capgo/capacitor-updater`) on
the branch-46 architecture.

### Stage B — real integration (answers 3, 4, 5) — only if A passes

Branch off **46** (it already carries the bearer flow, the `GpsSource`
abstraction, and the `@capacitor/browser` / `@capacitor/app` plugins). The delta
from 46 is small and mostly subtractive:

- `server.url` → a cuanto.bio deployment that serves the native-aware web code
  (a staging deploy, or the dev server via a tunnel). The code stays inert for
  ordinary web users behind `isNativePlatform()`.
- Drop the `capacitor://localhost` bundle, the API URL rewrite, and the CORS
  layer — all same-origin now.
- Move the bearer token from memory to IndexedDB.
- App-bound config from Stage A.

Full walk-through on device: sign in (use a non-Bluesky PDS to exercise
arbitrary-PDS), record a short track, airplane mode, force-quit, relaunch —
expect: shell loads offline, still signed in, GPS resumes, draft intact.

## Hosting and setup notes

- **HTTPS is mandatory** — service workers and app-bound domains both need a
  secure context, so `127.0.0.1` is out. Stage A wants a fixed domain; a
  rotating ngrok URL means re-editing the plist every session (and the ngrok
  interstitial, which needs the `ngrok-skip-browser-warning` header the app
  already sends).
- **Device, not simulator.** Phase 0's lesson holds: the simulator misreports
  WebKit and background behavior. App-bound + service-worker support is exactly
  the kind of thing that differs on device.
- Reuse `scripts/ios-smoke.sh`'s pattern — verify the plugin classes are in the
  binary and screenshot the running app — but note it assumes the bundled build;
  Stage A's bare project needs its own minimal version.

## Decision tree

- **Q1 fails** → wrapper impossible for this app. Auto-update means bundled +
  OTA. Stop; do not build Stage B.
- **Q1 passes, Q2 fails** → app-bound gives no offline launch. The wrapper still
  auto-updates and keeps IndexedDB offline *data*, but a cold-launch in a dead
  zone is a white screen. Decide whether that is acceptable for field use before
  going further.
- **Q1 and Q2 pass** → the hybrid is real. Proceed to Stage B, then write a
  production plan. This becomes a genuine alternative to the bundled architecture.
- **Q3–Q5 fail** → integration bugs, fixable; not a reason to abandon.

## What this spike does not decide

- **App Store review.** A remote-content wrapper leans hardest on guideline 4.2;
  background GPS should carry it, but that is a submission-time risk, not
  something a spike settles.
- **Serving native-aware code from production cuanto.bio.** Whether the
  `isNativePlatform()`-guarded auth and GPS glue is clean enough to want in the
  shipping web app is a judgement call for after the spike, not part of it.
- **Security of a remote server driving native plugins.** With `server.url`, a
  compromised or MITM'd cuanto.bio can invoke native APIs. HTTPS and its being
  your own server mitigate it; it is still a larger attack surface than a bundle
  and worth a deliberate look before production.

## Findings

**Stage A — 2026-07-22, on device. Clean pass.** (Simulator agreed but is not
authoritative for app-bound behavior; all reads below are from the iPad.)

- Q1 cross-origin (fetch / img): **PASS.** With app-bound ON, both the
  iNaturalist `fetch` and the OpenStreetMap tile `<img>` succeeded. App-bound
  domains does **not** block cross-origin requests — it only restricts
  navigation. This was the kill switch; it survived.
- Q2 offline launch: **PASS.** SW registered on first launch and controlled the
  page by the second (gray→green, standard SW timing). After force-quit +
  airplane mode + relaunch, the shell rendered from the service worker (the two
  cross-origin cards go red for want of network, as expected).
- Control (app-bound OFF): **PASS — app-bound is load-bearing.** With
  `limitsNavigationsToAppBoundDomains: false` and a fresh install, the SW
  **failed to register**. So the offline capability is genuinely caused by
  app-bound domains, not by a permissive device or a lingering registration.

**What this resolves.** The trilemma the plan feared — arbitrary PDS *vs* offline
*vs* wrapper — dissolves:

- App-bound's 10-domain cap restricts only *navigation*, and the main webview
  only ever navigates to cuanto.bio. Sign-in happens in the system browser
  (bearer), so it never touches the cap regardless of how many PDSes exist.
- Cross-origin *fetch* (iNat, GBIF, tiles) is not navigation and works under
  app-bound anyway (Q1).

So the app-bound list only ever needs `cuanto.bio` + `localhost`, and arbitrary
PDS + offline launch + auto-updating wrapper all coexist. The wrapper is a real
alternative to the bundled architecture. **Proceed to Stage B.**

**Stage B — 2026-07-22, on branch `47-wrapper-prototype`.** Built as a mostly
subtractive change off #46 (net ~500 fewer lines: the static `/app` build, the
API URL rewrite, and the CORS layer all deleted, since loading the site live is
genuinely same-origin). Token persists in `localStorage`, not IndexedDB — it is
synchronous, so the fetch wrapper reads it without racing the first `/api/me`.
Served through a Tailscale funnel to `pnpm build && pnpm preview`; production
cuanto.bio was not touched.

- Q3 bearer sign-in (arbitrary PDS): **PASS on device.** System-browser sign-in,
  callback's native branch, "Return to Cuanto" handoff, back in the app signed
  in. Same flow as #46, now same-origin.
- Q4 background GPS via plugin from remote JS: _pending device walk._
- Q5 token survives webview reload (offline cold-launch stays signed in):
  _pending._

Two gotchas found and fixed on device, worth keeping:

- **The wrapper must load `/app`, not the marketing home page.** Otherwise the
  native sign-in flow (under `/app/signin`) is never entered and the user does a
  dead-end web sign-in with no way back into the app. The path goes in
  `server.url` (`https://host/app`), **not** `appStartPath` — `appStartPath`
  additionally requires a matching *local* file (`public/app`) to exist, which a
  remote wrapper has no reason to ship (Capacitor's `loadWebView` guard fatals
  otherwise).
- Sign-in only bounces back into the app from the native flow; reaching it
  depends on loading `/app` above.

**Decision: the wrapper is the model to refine from.** It matches the bundled
app's functionality with far less code and working offline launch. Remaining:
strip the TEMPORARY sign-in tracing, confirm Q4/Q5 on a walk, then decide whether
to retire #44-#46 and merge the native-aware (isNativePlatform-guarded) code to
`main` so a deploy reaches app users.
