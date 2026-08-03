# Native wrapper E2E testing: assessment and recommendation

Status: **implemented (Layers 1-3).** No heavy tooling adopted; Detox declined.
Layer 1 (unit seams) and Layer 2 (faked-bridge Playwright E2E) are built and
green; Layer 3 is a written device checklist
(`docs/native-release-smoke-checklist.md`). CI is deferred to the main-branch
context by decision, not built here.

The question: now that the Capacitor wrapper strategy has settled (remote-URL
shell, bearer tokens, system-browser OAuth), do we need heavy end-to-end device
tooling like Detox, both to prevent regressions and so an agent can verify its
own work?

**Short answer: no to Detox, and no to heavy device E2E as the first
investment.** The remote-URL architecture collapses most native risk into web
risk that the existing Playwright suite already covers. Spend the effort on two
non-device layers that run in CI and that an agent can author and run, and keep
device testing thin and manual via the smoke script we already have.

## Why Detox is the wrong tool specifically

Detox is built for and supported on React Native. Its value is gray-box
synchronization: it hooks the RN bridge and native module queues so it knows
when the app is idle before it asserts. A Capacitor app is a single WebView
loading web content; there is no RN bridge for Detox to synchronize against, and
Capacitor is not a first-class Detox target. The idiomatic E2E tools for a
mobile WebView app are Appium (switch into the `WEBVIEW` context and drive the
DOM) or Maestro, not Detox.

But the tool choice is secondary. The bigger point is that the architecture
makes a Detox-sized investment unnecessary.

## Why this architecture needs far less native E2E than a typical app

For a React Native app the entire UI is native, so Detox is the only way to test
anything at all. That reasoning does not transfer here.

The wrapper loads cuanto.bio live and runs the same web bundle that Safari and
Chrome run. So the whole app surface (surveys, protocols, drafts, records,
offline data, navigation) is already exercisable by the existing Playwright
integration and PWA suites in an ordinary browser. What is *genuinely* native is
a small, enumerable set of seams:

- the bearer sign-in handoff: `src/lib/auth/native.ts` plus the server side in
  `src/lib/server/native-auth.ts`
- token persistence: `src/lib/auth/token.ts` (plain `localStorage`)
- background GPS: `src/lib/gps/nativeSource.ts` (capgo plugin)
- the vibrate bridge: `src/lib/haptics.ts`
- platform gating: `src/lib/platform.ts` (`isNative()`)
- OS-level behaviors: bridge injection into remote content, custom-scheme
  deep-link routing, service-worker offline launch under App-Bound Domains,
  token survival across relaunch

Everything except the last bullet is ordinary JS behind a mockable plugin
boundary. The team already mocks Capacitor plugins cleanly in vitest
(`haptics.test.ts` mocks `@capacitor/haptics`; `fillUserFromCache.test.ts` mocks
`isNative`), and the GPS source is injectable
(`useGpsTrack(source = isNative() ? nativeGpsSource() : webGpsSource())`). The
plumbing for cheap seam testing is already in place.

A subtle risk that *raises* the value of the cheap layers: because the app loads
the web bundle remotely, a plain web deploy can break app users with no app
rebuild. The tests that guard against that run against the web app, in CI, not
on a device. That is Layers 1 and 2 below.

## Why device E2E can't serve the "agent tests its own work" goal

One motivation was letting an agent verify native work. Device and simulator E2E
cannot do that: an agent can't drive a physical iPad, simulator runs are slow
and stateful, and the wrapper spike itself records that the simulator misreports
WebKit and background behavior (see the phase-0 note and
`2026-07-22-capacitor-wrapper-spike.md`). The tests an agent *can* write and run
are exactly the non-device layers. So the goal that motivates tooling is best
served by not going to the device.

## Recommendation: three layers, invest bottom-up

### Layer 1 — Seam unit tests (vitest), mock Capacitor at the module boundary

Do this first. It is where regressions will actually hide, and it costs almost
nothing because the mocking pattern already exists.

Highest-value gap: `src/lib/auth/native.ts` (the sign-in handoff state machine)
has **no test**, and it is the trickiest native code we have. Its own comments
memorialize a past bug where callback errors were swallowed and the user was
left signed out after a successful browser sign-in. Mock `@capacitor/app` and
`@capacitor/browser` and cover:

- `startNativeSignIn` opens `Browser` with
  `.../auth/signin?client=native&challenge=…`, and the challenge is a correct
  `S256(verifier)`
- `appUrlOpen` ignores URLs that are not `bio.cuanto.app://`
- callback with no `code` calls `onError`, never silently returns
- token-exchange HTTP failure calls `onError` with the status
- relaunch (verifier lost) yields the specific "app restarted" error
- success calls `setToken`, fires `onSignedIn`, closes the browser
- `initNativeAuth` is idempotent (second call does not double-attach)
- `token.ts`: set / get / clear round-trip, and SSR-safety (no `localStorage`
  present) does not throw

Runs in `pnpm test:unit`, in CI, authorable and runnable by an agent.

### Layer 2 — Native-path E2E in a browser (Playwright), fake the bridge

Do this next. Playwright can't drive a native app, but it can drive the
native-aware *web* code. Use `addInitScript` to stub `Capacitor.isNativePlatform`
to true and fake the `@capacitor/browser` / `@capacitor/app` surface: capture the
URL that `Browser.open` would receive, and let the test dispatch a synthetic
`appUrlOpen`. That exercises the real `/app/signin` native branch, the
`isNative()`-gated layout and redirect logic, and the
token-in-`localStorage` to authenticated `/api/me` path, end to end, headless,
in CI. The server half is already covered by `tests/bearer-auth.spec.ts`.

This is the closest thing to an E2E of the native flow that runs without a
device, and again an agent can author and run it.

### Layer 3 — Device smoke: thin, manual, automate only on demonstrated need

`scripts/ios-smoke.sh` already exists and is good: it builds, launches, verifies
the plugin classes are actually linked into the binary, screenshots the running
app, and even documents the `simctl openurl` deep-link check. It encodes the
three classes of bug that only show on device.

The addition worth making is a short **written release smoke checklist** for the
genuinely-native, genuinely-manual items that no framework automates reliably:

- sign in on device with a non-Bluesky PDS (exercises arbitrary-PDS + the
  system-browser handoff + deep-link return)
- record a short track with the screen locked / app backgrounded
- airplane mode, force-quit, relaunch: shell loads offline, still signed in,
  draft intact
- confirm the deep link returns to the app (`simctl openurl` for the error path;
  a real sign-in for the success path)

If and when a device-only path earns automation, reach for **Maestro** (light
YAML flows, WebView-aware, near-zero setup, can drive both the WebView DOM and
OS-level gestures) or a small **Appium** suite if you outgrow it. Not Detox.
Defer even that until a device regression actually recurs: today there is one
automatable device path (deep-link to error), and the smoke script already runs
it.

## Also: there is no CI yet

`.github/workflows` does not exist. The real regression backstop is running
`test:unit` + `test:integration` + `test:pwa` on every push. Native tooling is a
small delta on top of that, not a substitute for it. Standing up CI is a higher
priority than any device automation.

## Bottom line

- Do not adopt Detox. Wrong tool for a WebView app, and it cannot serve the
  "agent verifies its own work" goal.
- Invest in Layer 1 (vitest seam tests, starting with the untested `native.ts`)
  and Layer 2 (Playwright with a faked bridge). Both run in CI; both are
  agent-authorable.
- Keep device testing thin and manual via the existing smoke script promoted to
  a release checklist. Use Maestro, not Detox, if a device path later earns
  automation.
- Stand up CI to run the three existing test suites on push.
