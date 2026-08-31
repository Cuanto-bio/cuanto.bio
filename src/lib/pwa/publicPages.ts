/** SvelteKit appends this to a route's path when fetching its `load` data. */
const DATA_SUFFIX = '/__data.json';

/**
 * Whether `pathname` is one of the public, read-only protocol pages: the index
 * (`/protocols`), an owner's list (`/protocols/<handle>`), or a single protocol
 * (`/protocols/<handle>/<rkey>`), or the `__data.json` request for any of them.
 *
 * Used by src/service-worker.ts to decide what it may serve
 * stale-while-revalidate. Deliberately excludes `/protocols/new` and
 * `/protocols/<handle>/<rkey>/edit`, which sit under the same prefix but are
 * authenticated forms: their loads redirect to sign-in when there is no
 * session, and a cache hit ignores request headers, so a cached redirect gets
 * replayed to a visitor who has since signed in — bouncing them to sign in
 * again on a page they own. That was how the native wrapper behaved for the
 * whole editor, since the bearer token it authenticates with never reached
 * these routes to begin with.
 *
 * Pure and string-in/boolean-out so it can be tested without a service worker.
 */
export function isPublicProtocolPath(pathname: string): boolean {
  const path = pathname.endsWith(DATA_SUFFIX)
    ? pathname.slice(0, -DATA_SUFFIX.length)
    : pathname;

  const segments = path.split('/').filter(Boolean);
  if (segments[0] !== 'protocols') return false;
  if (segments.length === 1) return true;
  if (segments.length === 2) return segments[1] !== 'new';
  return segments.length === 3;
}
