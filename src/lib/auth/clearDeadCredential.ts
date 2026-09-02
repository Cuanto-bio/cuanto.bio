import type { ActionResult } from '@sveltejs/kit';
import { clearToken } from '$lib/auth/token';
import { isNative } from '$lib/platform';

// Deduped across concurrent callers: when a session dies, several in-flight
// requests can fail at once (offline sync replaying its queue, parallel `load`s)
// and each would otherwise fire its own /auth/signout. The credential only needs
// clearing once, and re-auth reloads this module anyway.
let clearing: Promise<void> | null = null;

/**
 * Drops whichever local credential the client presented, after the server has
 * signalled the underlying PDS/OAuth session is dead — a revoked grant or failed
 * refresh (`pds_session_expired` / `sessionExpired`), or a granted scope that no
 * longer covers what the app needs (`permissionRequired`). The server has
 * already deleted its own session row in every one of those cases
 * (withSessionErrorHandling in src/lib/server/pds.ts), so re-auth is unavoidable.
 *
 * Without this the credential still satisfies our own layer: `/api/me` keeps
 * returning 200 and `/app/+layout.ts`'s guard keeps treating the user as signed
 * in, so the app looks signed in while every write silently fails. Clearing it
 * makes the next `/api/me` return 401, which routes the guard to sign-in.
 *
 * Not meant to be awaited by request-path callers: the point is only that the
 * credential is gone before the next navigation, not before the current request
 * resolves. Returns the shared promise so a test (or a deliberate caller) can.
 *
 * https://tangled.org/cuanto.bio/cuanto.bio/issues/65
 */
export function clearDeadCredential(): Promise<void> {
  clearing ??= runClearDeadCredential();
  return clearing;
}

async function runClearDeadCredential(): Promise<void> {
  if (isNative()) {
    // The bearer token in localStorage. Dropping it locally is enough for the
    // guard; the server already forgot the session.
    clearToken();
    return;
  }
  // Web: the `did` cookie is httpOnly, so only the server can clear it.
  // /auth/signout deletes it (then 302s to `/`, which fetch follows harmlessly).
  await fetch('/auth/signout').catch(() => {});
}

/**
 * The `use:enhance` counterpart of the fetch-wrapper check in hooks.client.ts,
 * called from Form.svelte for every action result. A SvelteKit form action
 * reports a dead session as `fail(401, { sessionExpired: true })`
 * (src/routes/protocols/**), whose action-result envelope the fetch wrapper
 * can't see through.
 */
export function clearDeadCredentialForActionResult(result: ActionResult): void {
  if (result.type !== 'failure') return;
  const data = result.data as { sessionExpired?: boolean } | undefined;
  if (data?.sessionExpired === true) void clearDeadCredential();
}
