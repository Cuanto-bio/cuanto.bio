# Phase 0 — Background GPS spike

Part of [the Capacitor iOS plan](2026-07-20-capacitor-ios-overview.md).
**Throwaway code. No branch, no PR, nothing merged.**

Do this first. It costs a weekend and $0, and it can kill the whole plan before
phases 1 and 2 consume weeks.

## Why

Phase 3 rests on assumptions taken from plugin documentation rather than from
observation, and the load-bearing one is: *iOS keeps the app alive, so the
webview's JS keeps running, so fixes arrive one at a time and we persist them as
they come.* If iOS terminates the app 40 minutes into a survey, that promise is
worthless and no free plugin can rescue it.

Nothing about that question requires our app. It needs a Capacitor shell, the
plugin, and a walk.

## Cost: nothing

On-device testing is free with a plain Apple Account
([Apple][memberships]). Xcode gives you a "Personal Team"; you install to the
iPad over USB or Wi-Fi. Crucially, `UIBackgroundModes` is an **Info.plist key,
not an entitlement**, so background location is not gated behind the $99
program.

Constraints, none of which matter for a spike:

- Provisioning profiles expire **7 days** from issuance; the app stops launching
  and you rebuild from Xcode. Plan the long walk inside that window.
- 10 App IDs at a time, 3 test devices per platform, same 7-day clock.
- **No TestFlight** — that needs the paid program. Spike is self-only.

[memberships]: https://developer.apple.com/support/compare-memberships/

## The spike

**Built 2026-07-20. Lives at `~/projects/cuanto-gps-spike`**, outside this repo
so it leaves no dead Xcode project in the tree. Its README covers running it,
reading the screen, and the test protocol. Only findings come back here.

Not validated by a compile: `xcodebuild` hangs at SPM package-graph resolution
in a non-interactive shell, so the first Xcode build is also the first real
compile. Expect to fix something small.

Design decisions worth keeping if it gets rebuilt:

- **Bundle ID: something throwaway**, e.g. `bio.cuanto.spike` — *not* the real
  `bio.cuanto.app`. iOS keys installed apps by bundle ID, so reusing the real
  one means the spike and the eventual app collide on the device. Free
  provisioning allows 10 App IDs at a time, so spending one is free.
- **Both location usage strings go in `Info.plist`**, so the tester can switch
  between When In Use and Always via iOS Settings without a rebuild. Phase 3
  §3.2 wants When In Use, but capgo couples background delivery to an Always
  request — testing which actually works is question 9 below.

- **A 10s heartbeat** is the direct measurement for question 3. Heartbeats stop
  when the JS context is suspended, so a gap much larger than 10s answers "does
  JS keep running while backgrounded" without inference.
- **Two storage keys.** The full log is written on a 3s throttle (re-serialising
  a growing array every fix goes quadratic over two hours); a tiny counter is
  written on *every* fix. The difference on reload is exactly how many fixes a
  kill cost — the same tradeoff the real app makes with its 10s autosave, so the
  number transfers.
- **Auto-resume on boot** when the previous session was still recording. That is
  the behavior phase 3 depends on, so the spike should exercise it rather than
  make the tester tap Start.
- **No `accumulate()` port.** Log raw fixes; the point is to observe what the
  plugin delivers, not to reproduce our windowing on top of it.

## Questions to answer

Ordered by how much a "no" hurts.

1. **Does recording resume cleanly after a relaunch?** Reopen the app after a
   termination and start again. Does the plugin restart without fuss? This is
   the load-bearing question — phase 3's promise rests on resume, not on
   survival.
2. **How long does the app survive backgrounded?** Screen locked, in a pocket,
   walking. Not pass/fail; we need the *number*. A ceiling around 90 minutes is
   acceptable (see phase 3), so this is calibration, not a gate. Run it long
   enough to actually see a termination rather than stopping at 90.
3. **Does JS keep running while backgrounded?** Sections 3.3 and 3.4 assume yes.
   The foreground marker plus fix timestamps will show it directly.
4. **One at a time, or batched?** If fixes arrive in bursts on resume, 3.4 needs
   the batch-folding path rather than persist-per-fix.
5. **Are timestamps stable and monotonic?** Idempotent resume in 3.4 depends on
   a high-water mark. Check for duplicates and out-of-order delivery.
6. **What does the plugin's own filtering do?** Fix rate and accuracy
   distribution determine whether `accumulate()`'s warm-up convergence logic
   (`src/lib/gpsTrackWindow.ts`) still earns its keep or is now redundant.
   Warm-up matters more than before: every resume is a cold GPS start.
7. **Battery drain** over a realistic survey, against the current wake-lock PWA
   doing the same walk. The PWA is the baseline to beat and it should not be
   close.
8. **Does anything come back after a force-quit?** Expected: no. Worth
   confirming rather than assuming.
9. **Does background delivery work under When In Use only?** Grant "While Using
   App", decline the Always escalation, confirm the app shows
   `background: when_in_use`, then background it and walk. Phase 3 §3.2 assumes
   yes on Apple's documented behavior, but capgo requests Always whenever
   background is enabled, so this is assumption rather than fact until walked.
   Repeat under Always to confirm the difference is real either way.

Cheap add-on while you are in there: confirm whether a service worker registers
at all under `capacitor://localhost`. The overview flags that as resting on a
single secondhand source.

## Reading the result

The bar is **90 minutes of survival, plus clean resume** — the accepted
requirement from phase 3. Gaps are fine; silent failure to resume is not.

**Ceiling comfortably past 90 min, resume works** → proceed to phases 1 and 2.
Note a pass here is *not* proof for iPhone: the iPad has a bigger battery and
more RAM headroom, so it faces less memory pressure than a phone with a dozen
apps resident. Re-verify on an iPhone before shipping.

**Ceiling well under 90 min** → gaps become frequent enough to degrade the data
rather than annotate it. Options, in descending order of appeal:

- Tune the plugin. Distance filters and accuracy settings affect how hard the
  app works and therefore how attractive a target it is for jetsam.
- Investigate the iOS 17+ CoreLocation relaunch APIs. Neither free plugin
  documents using them, but capgo is MPL-2.0, so a fork adding native
  persistence plus relaunch is legally and practically open. A real project,
  not an afternoon.
- Revisit the paid plugin decision with a concrete number attached to what it
  buys.
- Abandon the native app and keep the wake-lock PWA.

**Resume does not work reliably** → this kills the plan regardless of the
ceiling, because phase 3's promise now rests on resume rather than survival.
Diagnose before going further.

**A failure on the iPad is conclusive.** If an iPad cannot stay alive, an iPhone
certainly cannot.

## Findings

**Run 1 — 2026-07-21.** iPad Air 5th gen (Wi-Fi + Cellular; real GNSS
confirmed), closed in a backpack, unplugged, capgo 8.3.1, Capacitor 8.4.2.
Mixed trip 2:31–4:36 PM: 43% stationary, 29% walking, 27% vehicular, 36.7 km.
6987 fixes.

- **Q1 resume after relaunch — PASS.** Force-quit at 2:36:58, relaunched
  2:37:00. `boot {wasRecording:true}` followed immediately by
  `start {reason:"auto-resume-after-boot"}`. Recording continued without
  intervention. This is the load-bearing behavior and it works.
- **Q2 survival ceiling — PASS, >1h59m.** Zero kills between the deliberate
  relaunch at 2:37 PM and 4:36 PM. Never hit a ceiling, so the real number is
  unknown and greater than two hours. Comfortably past the 90-minute bar.
- **Q3 JS alive while backgrounded — YES.** Max heartbeat gap 21.9s against a
  10s interval: timer coalescing, not suspension. JS ran continuously for two
  hours backgrounded. **This validates the §3.3/§3.4 design** — fixes arrive in
  a live context, persist-per-fix works, no native buffer needed.
- **Q4 delivery shape — one at a time.** Largest burst 3, and only during
  warm-up. Metronomic 1Hz otherwise (median interval 1000ms, p10 996, p90 1004).
  Keep the batch-folding path as cheap insurance, but it is not the normal path.
- **Q5 timestamp behavior — mostly clean, one trap.** 0 null, 0 out-of-order,
  3 duplicate `time` values out of 6987, all during stationary warm-up. **Two of
  the three are genuinely different positions sharing a timestamp**, so `time`
  alone is not a usable dedupe key. See §3.4.
- **Q6 fix rate / accuracy — 1Hz, median 8.0m, p10 3.4m, 60% under 10m.**
  Replaying through a 10s window gives **699 points from 6987 (10x reduction)
  with median accuracy 7.5m, slightly better than raw**, because it picks
  best-per-window. Raw distance 36.70 km vs 34.66 km windowed — the 2 km
  difference is stationary jitter. **Keep `accumulate()`; do not delegate to the
  plugin's distance filter.**
- **Q7 battery vs PWA — UNRESOLVED.** Device read 100% before and after, which
  is not plausible for two hours of GNSS on a ~28.6 Wh battery. The export
  carries no battery data. Needs Settings → Battery → Last 24 Hours for the
  2:31–4:36 window.
- **Q8 post-kill recovery — not applicable this run.** No unplanned kill
  occurred, so there was nothing to recover.
- **Q9 background under when_in_use — NOT TESTED.** Ran as `granted` (Always).
  The question phase 3 §3.2 depends on is still open.

**Accuracy by movement type**, which matters more than the headline median. The
trip was drive → walk → drive → walk indoors in a store → drive → walk home, so
it spans conditions:

| | n | median | p90 | p99 |
| --- | --- | --- | --- | --- |
| Vehicular | 1863 | 3.8m | 8.2m | 32.9m |
| Walking | 2028 | 7.5m | 18.6m | 63.1m |
| Stationary | 3096 | 14.2m | 21.8m | 42.8m |
| Worst 60-fix stretch (indoors, 3:47 PM) | 60 | 52.2m | — | — |

Recorded as context, not as a finding that changes anything: accuracy under
poor sky view is a property of GNSS, not something the app can fix. Walking in
the open (7.5m) tracks the overall median, and it degrades as expected when
stationary or indoors. `accumulate()`'s existing `WARMUP_TIMEOUT_MS` safety
valve already covers the case where accuracy never converges, which is exactly
the bad-conditions scenario — no change needed.

**Decision: proceed to phases 1 and 2.** The two findings that could have killed
the plan — resume works, JS stays alive backgrounded — both came back clean.
Outstanding items (Q7, Q9, a canopy walk) are calibration, not gates.
