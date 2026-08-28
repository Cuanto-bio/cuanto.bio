# Issue #18 — Narrower OAuth scopes

Replaces the broad `atproto transition:generic` request with a granular
permission scope so the PDS consent screen names only what Cuanto actually
touches, instead of "do anything in your repo."

Status: **implemented but NOT yet verified against a live PDS.** The granular
permission spec is new; the client library passes the scope straight through to
the authorization server, so the only real test is a live OAuth flow. Do the
manual verification below before deploying.

## What changed

`src/lib/server/auth.ts`: `SCOPE` is now built from the app's collection list:

```
atproto
repo:bio.cuanto.surveyProtocol
repo:bio.cuanto.surveyProtocol.follow
repo:bio.cuanto.protocolTarget
repo:bio.cuanto.survey
repo:bio.cuanto.surveyTarget
repo:bio.lexicons.temp.v0-1.occurrence
repo:bio.lexicons.temp.v0-1.identification
repo:bio.lexicons.temp.v0-1.media
repo:bio.lexicons.temp.v0-1.surveyProtocol?action=delete
repo:bio.lexicons.temp.surveyProtocol?action=delete
repo:bio.lexicons.temp.v0-1.surveyTarget?action=delete
repo:bio.lexicons.temp.surveyTarget?action=delete
repo:bio.lexicons.temp.v0-1.survey?action=delete
repo:bio.lexicons.temp.survey?action=delete
blob:*/*
```

The `?action=delete` grants exist only so the admin lexicon cleanup
(`cleanupMigratedRecords`) can remove old-namespace records after they are
migrated to `bio.cuanto.*`. Once every user is migrated and cleaned up, drop
both the cleanup and these grants.

## Reasoning

Scope syntax: https://atproto.com/specs/permission

- `atproto` — required base scope (session + identity resolution).
- `repo:<nsid>` — record create/update/delete for that collection. Every PDS
  write in the app goes through `com.atproto.repo.{create,put,delete}Record` /
  `listRecords` / `getRecord` (see `src/lib/server/pds.ts`), all covered by
  `repo` scope for the listed collections.
- `blob:*/*` — `com.atproto.repo.uploadBlob` for GPX tracks and photos.

The collection list is the full set of `$nsid`s under
`src/lib/lexicons/bio/**` that the app writes to the *user's* repo.

### Why not `identity` / `rpc` (which the issue guessed)

- `identity` governs changing the user's handle/DID document. Cuanto never does
  this, so it should not be needed.
- `rpc` governs calling service (appview) XRPC methods. Cuanto only calls
  `com.atproto.repo.*` and `com.atproto.sync.getBlob` (public) — no appview
  RPC — so it should not be needed either.

Add them only if live testing shows an operation failing that maps to them.

## Open questions to resolve during live testing

1. **Default actions.** Does bare `repo:<nsid>` grant create+update+delete, or
   must actions be explicit (`repo:<nsid>?action=create&action=update&action=delete`)?
   If writes 403, switch to the explicit form. `surveyProtocol.follow` and
   `surveyTarget` realistically need only create+delete.
2. **PDS support.** Older PDS deployments may only understand
   `transition:generic`. Confirm the target PDS (bsky.social and self-hosted)
   accepts granular scopes; otherwise this must wait or feature-flag.
3. **`blob:*/*` breadth.** Could tighten to
   `blob:application/gpx+xml` + `blob:image/*` once the exact upload MIME types
   are confirmed.

## Re-authorization when SCOPE grows

Adding a new `repo:<nsid>` (e.g. for a future comment lexicon) means every
already-signed-in user's stored session was granted under the old, narrower
scope. Per OAuth refresh-grant rules a refresh can never widen a token's
scope, and atproto's OAuth profile defines no incremental/step-up mechanism —
the only way to get the new scope onto an existing session is a fresh
`/authorize` round trip.

`src/lib/server/pds.ts` already detects this: `withSessionErrorHandling` (the
choke point used by `createRecord`/`putRecord`/`deleteRecord`/`uploadBlob`/
`assertActiveSession`) compares the session's actually-granted scope — read
from `oauth_sessions.value->tokenSet->scope`, which `@atproto/oauth-client-node`
already persists — against the current `SCOPE` via `isScopeSufficient()` in
`auth.ts`, *before* attempting the PDS call. A missing token throws
`PdsScopeInsufficientError` (a `PdsSessionExpiredError` subclass), which
flows through the existing "please sign in again" pipeline (401
`pds_session_expired` → client toast) without any changes needed at the route
or UI layer. This also incidentally covers a user who only partially
consented to the requested scopes, which the spec permits.

This is a local, proactive check — it does not depend on parsing whatever
error shape a live PDS returns for an actual insufficient-scope XRPC call
(still unverified, see below). One assumption worth confirming during live
testing: this only stays accurate if the PDS includes `scope` in *refresh*
token responses too, not just the initial code exchange. The spec text says
the AS "always returns the scopes approved for the session ... even if they
are the same as the request" as an atproto-specific profile requirement, so
this should hold — but hasn't been confirmed against a live PDS.

**Rollout note:** the first deploy of this check will force every existing
signed-in user to re-authenticate on their next write, since their sessions
predate this issue's scope change entirely (`atproto transition:generic`
grants none of the new `repo:` tokens). That's the intended behavior — it's
what gets everyone onto the narrower grant — but is worth knowing about
before deploying.

## Update (2026-08-27): granted scope is not a literal echo of the request

Live behavior, confirmed against real `oauth_sessions` rows:

- **Bare `repo:<nsid>` grants create+update+delete** (open question 1 above),
  per the spec: "If not defined, all operations are allowed."
- **The authorization server rewrites the scope it grants.** It resolves
  `include:bio.cuanto.authFull` and returns the expansion as the compact
  `repo?collection=a&collection=b&…` form; it never echoes the `include:`
  token itself. So a granted scope and the requested `SCOPE` legitimately
  differ token-for-token while representing the same permissions.

`isScopeSufficient()` originally did a literal `granted.has(token)` check for
every requested token, so once `SCOPE` switched to `include:bio.cuanto.authFull`
(commit `5f13578`) it returned `false` for **every** session — new ones
included — and every PDS write threw `PdsScopeInsufficientError`, surfacing as
a "Session expired" loop that re-authenticating could not clear.

It now normalizes both sides before comparing: `include:<set>` is expanded via
`PERMISSION_SETS`, the compact `repo?collection=` form is expanded per
collection, bare `repo:<nsid>` is treated as all three actions, `repo:*` and
`blob` globs are honored. `PERMISSION_SETS` is built from the generated
permission-set lexicon (`$lib/lexicons/bio/cuanto/authFull`), so it tracks the
consent-screen definition automatically — run `pnpm lex:gen` after editing
`lexicons/bio/cuanto/authFull.json`.

## Manual verification checklist

1. Local dev (loopback client): `pnpm dev`, sign in with a test account, confirm
   the consent screen lists the granular permissions (not "everything").
2. Exercise every write path and confirm none 403:
   - create/edit/delete a protocol (+ targets)
   - follow/unfollow a protocol (surveyProtocol.follow, surveyTarget materialize)
   - submit a survey with occurrences + an incidental (occurrence, identification)
   - upload a GPX track and a photo (blob)
3. Repeat against a production-style discoverable client + real PDS.
4. If any step 403s, consult the failing XRPC method and widen the scope
   minimally (explicit actions, or add `rpc:`/`identity:` as needed).
