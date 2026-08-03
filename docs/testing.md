# Testing

## Overview

Tests are split into three layers:

- **Unit tests** (`pnpm test:unit`) — Vitest, fast, no I/O. Test individual modules
  in isolation with mocked dependencies.
- **Integration tests** (`pnpm test:integration`) — Playwright, run the full app
  against a real database. Test UI flows and frontend/backend interaction.
- **PWA tests** (`pnpm test:pwa`) — Playwright, run against a production build served
  via `vite preview`. Test service worker installation, offline behavior, and IDB
  persistence. Excluded from `test:integration` because they require a built app with
  a registered service worker.

Integration and PWA tests both use a dedicated `cuanto_test` database. Run
`pnpm test:db:setup` once before running them for the first time, or after adding new
migrations.

## PDS mocking

Playwright starts the app as a live server process (see `playwright.config.ts`). This
means integration tests cannot mock internal modules from the test layer — there is no
equivalent of `vi.mock` that crosses the process boundary.

The app makes calls to an AT Protocol PDS (Personal Data Server) when creating records.
These calls require a real OAuth session and a reachable PDS endpoint, neither of which
is available in the test environment.

To handle this, both `playwright.config.ts` and `playwright.pwa.config.ts` set
`PDS_MOCK=true` in the server's environment. `src/lib/server/pds.ts` checks this flag
and returns a fake AT-URI/CID without making any HTTP call.

### Why not a mock PDS server?

A local mock PDS would be the more principled alternative: the app makes real HTTP calls,
they just land on a stub. The problem is that `@atproto/oauth-client-node` doesn't just
call a URL — it first restores a stored OAuth session for the DID. Test users have no
stored session, so `restore()` throws before the HTTP call is ever made. A mock PDS would
need to implement DID resolution, OAuth endpoints, and XRPC — essentially a large portion
of the AT Protocol stack. `@atproto/dev-env` exists for this purpose but is heavyweight.

If the test suite grows to need more realistic PDS interaction, `@atproto/dev-env` is the
right starting point.

## Native wrapper testing

The Capacitor wrapper loads cuanto.bio live, so most of the app is plain web behavior the
suites above already cover. Native-specific code is tested in three layers; only the third
needs a device. The rationale (and why Detox was declined) is in
`docs/2026-07-24-native-e2e-testing-assessment.md`.

- **Layer 1, unit seams** (`pnpm test:unit`) — the native modules with the Capacitor plugins
  mocked at the module boundary: `src/lib/auth/native.test.ts` (the sign-in handoff state
  machine), `token.test.ts`, `signin.test.ts`, `haptics.test.ts`, `gps/nativeSource.test.ts`.
- **Layer 2, faked-bridge E2E** (`pnpm test:integration`) — `tests/native-wrapper.spec.ts`
  drives the real `isNative()`-gated web code (the `/app` auth guard, the native sign-in
  route, the bearer fetch wrapper) in a browser. `tests/nativeBridge.ts` injects a fake
  Capacitor bridge that reports a native platform, records plugin calls, and can fire the
  `appUrlOpen` deep-link callback. Nothing in the app is mocked; only the OS boundary (system
  browser, deep link) is faked. The full return leg is exercised end to end against the real
  server: the app's PKCE challenge is captured, a matching code is seeded the way the OAuth
  callback would mint it, and the deep link drives token exchange through to a bearer-
  authenticated `/api/me`.
- **Layer 3, device smoke** — `docs/native-release-smoke-checklist.md`, plus
  `scripts/ios-smoke.sh` for the build/link/launch sanity. Covers only what a browser or
  simulator cannot prove: the App-Bound service worker, background GPS, the real system-
  browser handoff, and haptics on device.
