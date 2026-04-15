# Testing

## Overview

Tests are split into two layers:

- **Unit tests** (`pnpm test:unit`) — Vitest, fast, no I/O. Test individual modules
  in isolation with mocked dependencies.
- **Integration tests** (`pnpm test:integration`) — Playwright, run the full app
  against a real database. Test UI flows and frontend/backend interaction.

Integration tests use a dedicated `cuanto_test` database. Run `pnpm test:db:setup`
once before running them for the first time, or after adding new migrations.

## PDS mocking

Playwright starts the app as a live server process (see `playwright.config.ts`). This
means integration tests cannot mock internal modules from the test layer — there is no
equivalent of `vi.mock` that crosses the process boundary.

The app makes calls to an AT Protocol PDS (Personal Data Server) when creating records.
These calls require a real OAuth session and a reachable PDS endpoint, neither of which
is available in the test environment.

To handle this, `playwright.config.ts` sets `PDS_MOCK=true` in the server's environment.
`src/lib/server/pds.ts` checks this flag and returns a fake AT-URI/CID without making
any HTTP call.

### Why not a mock PDS server?

A local mock PDS would be the more principled alternative: the app makes real HTTP calls,
they just land on a stub. The problem is that `@atproto/oauth-client-node` doesn't just
call a URL — it first restores a stored OAuth session for the DID. Test users have no
stored session, so `restore()` throws before the HTTP call is ever made. A mock PDS would
need to implement DID resolution, OAuth endpoints, and XRPC — essentially a large portion
of the AT Protocol stack. `@atproto/dev-env` exists for this purpose but is heavyweight.

If the test suite grows to need more realistic PDS interaction, `@atproto/dev-env` is the
right starting point.
