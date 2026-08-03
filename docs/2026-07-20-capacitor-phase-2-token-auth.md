# Phase 2 — Bearer-token auth

Part of [the Capacitor iOS plan](2026-07-20-capacitor-ios-overview.md).
Own branch, merges to `main` independently. Does not depend on phase 1.

This is the phase people underestimate. Budget accordingly.

## Goal

`/api/*` accepts an `Authorization: Bearer <token>` header as an alternative to
the `did` cookie, and there is a way for a non-browser client to obtain such a
token through the normal atproto OAuth flow.

## Why the cookie fails under Capacitor

The bundled app loads from `capacitor://localhost` and calls
`https://cuanto.bio/api/*`. That is cross-site. WKWebView will not attach a
`cuanto.bio` cookie set with `sameSite: 'lax'`, and loosening it to `none`
is both a CSRF exposure and still unreliable under ITP.

## Current state

The whole auth story is server-side and cookie-shaped:

- `src/routes/auth/signin/+page.server.ts` — form action, resolves a handle and
  redirects to the PDS authorize URL.
- `src/routes/oauth/callback/+server.ts:14` — sets an httpOnly `did` cookie,
  30-day max age, then upserts the user and registers the DID with tap.
- `src/hooks.server.ts:9` — `event.locals.did = event.cookies.get('did')`. This
  single line is the entire authentication check.
- `src/lib/server/auth.ts` — `NodeOAuthClient` with Postgres-backed
  `PgStateStore` / `PgSessionStore`, granular `SCOPE`, and client metadata with
  `application_type: 'web'` and `redirect_uris: [PUBLIC_URL + '/oauth/callback']`.
- `src/routes/auth/signout/+server.ts` — deletes the cookie.

Note what the cookie *is*: it holds a bare DID, not a token. The real OAuth
session (including DPoP keys) lives in Postgres, keyed by DID, and
`src/lib/server/pds.ts` loads it to talk to the PDS. So the cookie is a session
identifier that we fully control. That is convenient — it means we can issue an
opaque token with the same semantics without touching the PDS session layer.

## Two approaches

### A. Server-issued opaque token (recommended)

Keep `NodeOAuthClient` and the Postgres session store exactly as they are. Add
our own token table. The native client runs OAuth in a system browser
(`ASWebAuthenticationSession` on iOS, Custom Tabs on Android), the callback
redirects back to the app with a token, and the app sends it as a bearer header.

Pros: minimal change to atproto plumbing, no DPoP key management on-device, one
authentication model to reason about server-side.

Cons: we are now issuing and revoking our own credentials, with all the care
that implies.

### B. `@atproto/oauth-client-browser`

Move the OAuth session onto the device, with DPoP keys in IndexedDB, and have
the app talk to the PDS directly.

Pros: no bespoke token, no server-side session for app users.

Cons: a much larger rewrite — every `/api/*` route that currently writes to the
PDS on the user's behalf via `src/lib/server/pds.ts` would need a client-side
equivalent, and the Postgres mirror would need a different write path. It also
diverges the web and native auth paths permanently.

**Decision: A.** Revisit B only if issuing our own tokens proves untenable.

## Work items (approach A)

### 2.1 Token storage

Migration (naming per `AGENTS.md`, e.g. `20260721001_create_app_tokens.up.sql`):

```
app_tokens (
  token_hash  text primary key,   -- sha256 of the token, never the token itself
  did         text not null,
  created_at  timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at  timestamptz not null,
  revoked_at  timestamptz
)
```

Store only a hash. Index on `did` so "sign out everywhere" is cheap. Remember to
run `pnpm migrate:up` **and** `pnpm test:db:setup`.

Open question: expiry policy. The `did` cookie is 30 days. A native app that
records surveys in the field should not log people out mid-season, so a longer
window with a refresh-on-use `last_used_at` is probably right. Decide before
implementing; do not just copy 30 days by reflex.

### 2.2 Accept bearer tokens in `hooks.server.ts`

Extend the one line at `src/hooks.server.ts:9` to fall back to the header:

1. If `Authorization: Bearer <t>` is present, hash it, look it up, check
   `revoked_at is null and expires_at > now()`, set `locals.did`, bump
   `last_used_at`.
2. Otherwise use the cookie as today.

Cookie takes precedence or bearer does — pick one and write it down; do not
leave it implicit. Every existing `/api/*` route then works unchanged, because
they all read `locals.did`.

Also check `svelte.config.js` `csrf.trustedOrigins`: bearer-authenticated
requests from `capacitor://localhost` are not cookie-authenticated and so are
not CSRF-exposed, but SvelteKit's origin check may still reject them. Verify
rather than assume.

### 2.3 Native OAuth entry point

The existing flow is a form POST to `/auth/signin` that redirects. The native
client needs a variant that ends by handing a token to the app.

Sketch, to be validated during implementation:

- App opens `https://cuanto.bio/auth/signin?client=native` in a system browser.
- `src/routes/oauth/callback/+server.ts` gains a branch: when the flow was
  started by a native client, mint a token, and redirect to a custom scheme
  (e.g. `bio.cuanto.app://auth?token=…`) instead of setting the cookie.
- `ASWebAuthenticationSession` intercepts that scheme and returns the URL to the
  app, which stores the token in the iOS Keychain — the platform credential
  store, protected at rest and surviving reinstall. Not IndexedDB, which is
  neither.

Carry the `client=native` marker through the OAuth round trip via the existing
state store rather than a cookie, since cookies are exactly what we are avoiding.
`PgStateStore` already persists arbitrary state keyed by the OAuth `state`
parameter; check whether we can attach our own field to it or need a parallel
table.

Security notes that must not be skipped:

- The token must be minted *only* after `client.callback()` succeeds.
- Redirect to the custom scheme exactly once, with the token in the fragment or
  a single-use exchange code rather than a plain query param if feasible —
  query params leak into logs. Prefer a short-lived one-time code the app
  exchanges for the real token over a POST.
- The custom scheme is claimable by other apps on iOS. This is the standard
  argument for PKCE plus a one-time code, not a bare token in the redirect.

### 2.4 Sign-out and revocation

`src/routes/auth/signout/+server.ts` deletes the cookie. Add a bearer path that
sets `revoked_at`. Consider a `/api/tokens` list + revoke for "sign out all
devices" — but per YAGNI, only if it falls out naturally.

## Testing

- Unit tests for token hashing, lookup, expiry, and revocation.
- Server tests that `hooks.server.ts` resolves `locals.did` from a valid bearer
  token, and does not for expired, revoked, or unknown ones. This is the
  security-critical test; write it first.
- Integration test that an `/api/*` route works with a bearer token and no
  cookie.
- The native browser handoff cannot be tested in Playwright. It gets manually
  verified in phase 3.

## Done when

- A bearer token authenticates any `/api/*` route.
- Tokens can be minted through a real OAuth flow and revoked.
- Cookie auth still works unchanged for the web app.
- `pnpm check` and `pnpm test` pass.

## Risks

- **This is auth.** Getting it wrong exposes every user's PDS write access.
  Worth a `/security-review` pass on the branch before merge.
- **`application_type: 'web'`** in `src/lib/server/auth.ts` may need to change,
  or may need a second client metadata document, if the PDS treats native
  clients differently. Verify against a live PDS — note that
  `docs/2026-07-05-issue-18-oauth-scopes.md` records that the current granular
  scopes are themselves *still unverified* against a live PDS. Resolve that
  first or the two unknowns will tangle.
- **Custom scheme vs. universal link for the callback.** Universal links are
  more secure but need the `.well-known` work that is currently deferred to a
  later phase. If we end up needing it here, pull it forward rather than
  shipping a weaker handoff.
