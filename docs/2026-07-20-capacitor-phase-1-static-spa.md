# Phase 1 — `/app` as a pure static SPA

Part of [the Capacitor iOS plan](2026-07-20-capacitor-ios-overview.md).
Own branch, merges to `main` independently. Does not depend on phase 2.

## Goal

`/app/*` builds and runs with zero server-rendered or server-loaded code, so it
can be bundled into an IPA. Every dynamic thing it needs comes from `/api/*`.

## Why this stands alone

Even without Capacitor this is an improvement: it removes the last hidden
server round-trips from a section of the app that claims to be offline-first,
and it makes the offline story uniform instead of "offline except these two
routes."

## Current state

`src/routes/app/+layout.ts:1` already sets `ssr = false`, and most routes under
`/app` are client-loaded `+page.ts` files that hit `/api/*` and cache into
IndexedDB. `src/routes/app/protocols/[handle]/[rkey]/+page.ts` is the reference
implementation: cache-first render, stream fresh data in, degrade to cache when
the fetch fails.

Two files break the model.

### 1. `src/routes/app/protocols/+page.server.ts`

```ts
export const load: PageServerLoad = async () => {
  return { protocols: await getProtocolsPage() };
};
```

`ssr = false` disables server *rendering*, not server *loads* — SvelteKit still
fetches `__data.json` from our server on navigation. So this route is quietly
online-only today. `adapter-static` refuses to build any `+page.server.ts`.

### 2. `src/routes/app/protocols/[handle]/[rkey]/+page.server.ts`

Form `actions` for `follow` / `unfollow`. Each one resolves the handle to a DID,
looks up the protocol's `at_uri`, writes or deletes a
`bio.cuanto.surveyProtocol.follow` record on the PDS via
`src/lib/server/pds.ts`, mirrors it into Postgres, and then calls
`materializeSurveyTargets` or `gcSurveyTargetsIfUnused`. Non-trivial logic with
real error branches (`PdsScopeInsufficientError`, `PdsSessionExpiredError`).

## Work items

### 1.1 Replace the protocols list load

`GET /api/protocols` already exists (`src/routes/api/protocols/+server.ts`).
Confirm its response shape covers what `getProtocolsPage()` returns; extend it
if not. Then delete `src/routes/app/protocols/+page.server.ts` and add a
`+page.ts` that follows the cache-first pattern from the protocol detail route,
reading and writing through `getCachedProtocols` / `cacheProtocol`.

This route should get *better*, not just equivalent: it currently has no offline
story at all.

### 1.2 Move follow/unfollow to `/api`

Add `POST` and `DELETE` (or a single `POST` with an action body) at
`src/routes/api/protocols/[handle]/[rkey]/follow/+server.ts`, moving the logic
out of the form actions unchanged. Preserve the existing status codes:

- 401 not authenticated / `sessionExpired`
- 403 `permissionRequired` (insufficient OAuth scope)
- 404 user or protocol not found
- 502 PDS error

Per project convention, user-input validation failures are 422, but none of the
current branches are input validation, so nothing changes there.

Then convert the follow button in the page component from a `<form method="POST"
action="?/follow">` to a `fetch` against the new endpoint, and delete the
`+page.server.ts`. Keep the optimistic/cached follow state that
`getCachedFollowedProtocolByRkey` already backs.

Watch for: `addCachedFollowedProtocol` / `removeCachedFollowedProtocol` in
`src/lib/offline/db.ts` should stay in sync exactly as they do now.

### 1.3 Prove it is static-buildable

The web deploy stays on `adapter-node`. We need a *second* build that emits
`/app` as static files, from the same source tree.

Preferred approach: a build-mode flag (env var read in `svelte.config.js`) that
swaps `adapter-node` for `adapter-static` with a fallback of `app.html`, plus
`prerender` restricted to the `/app` shell. Add it as a script, e.g.
`pnpm build:app`.

Open question to resolve during implementation: whether one SvelteKit config can
cleanly emit both, or whether the app build needs its own config file that
imports a shared base. Do not over-engineer this until phase 3 actually consumes
the output; the deliverable for phase 1 is that `pnpm build:app` succeeds and
the result runs from a static file server.

### 1.4 Grep for remaining server dependencies

Before declaring done, confirm nothing under `src/routes/app/**` imports from
`$lib/server/**` at runtime. Note that *type-only* imports are fine and already
exist, e.g. `src/routes/app/protocols/[handle]/[rkey]/+page.ts` imports
`ProtocolActivity` and `FollowerPreview` types from `$lib/server/db/*`. Those
erase at build time. Check that any such import is `import type`.

## Testing

- Unit tests for any logic extracted out of the form actions.
- Integration: the existing Playwright suites must stay green
  (`pnpm test:integration`, `pnpm test:pwa`).
- New PWA integration coverage for follow/unfollow offline, and for the
  protocols list rendering from cache with the network down. `playwright.pwa.config.ts`
  is the right home for these.
- Manual: `pnpm build:app`, serve the output statically, confirm sign-in
  redirect, protocol list, and follow all work against a running dev server.

## Done when

- No `+page.server.ts` or `+layout.server.ts` under `src/routes/app/**`.
- `pnpm build:app` produces a static bundle that runs from a plain file server.
- Protocols list and protocol detail both render from cache while offline.
- Follow/unfollow works, with the same error handling as before.
- `pnpm check` and `pnpm test` pass.

## Risks

- **The `/app/` shell rewrite in the service worker.**
  `src/service-worker.ts:19-44` rewrites `new URL(".", location)` and
  `"./_app/"` in the prerendered shell so it serves at any depth. A static build
  may produce a shell that needs the same or different treatment. Phase 3 will
  revisit this for `capacitor://localhost`; phase 1 only needs to not make it
  worse.
- **Scope creep into phase 2.** The follow endpoints still authenticate via the
  `did` cookie after this phase. That is correct and intentional — leave it.
