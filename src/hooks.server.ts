import type { Handle } from '@sveltejs/kit';
import { isBearerHeader, resolveBearerDid } from '$lib/server/app-tokens';
import logger from '$lib/server/logger';

const log = logger.child({ component: 'request' });

export const handle: Handle = async ({ event, resolve }) => {
  // Assign the signed in user's DID for every request, from either credential:
  //
  // - `Authorization: Bearer <token>` for the native wrapper. It loads
  //   cuanto.bio same-origin, so no CORS is involved, but App-Bound Domains
  //   blocks the in-webview OAuth redirect — sign-in happens in the system
  //   browser and the webview authenticates with a bearer token instead of the
  //   cookie.
  // - the `did` cookie, for the web app.
  //
  // A Bearer header decides the outcome with no fallback to the cookie: a
  // revoked or expired token must not quietly succeed because a stale cookie
  // happened to be sitting alongside it. Any other Authorization scheme (a
  // proxy's Basic auth, say) is ignored and leaves the cookie in charge.
  const authorization = event.request.headers.get('authorization');
  event.locals.did = isBearerHeader(authorization)
    ? await resolveBearerDid(authorization)
    : event.cookies.get('did');

  const response = await resolve(event);

  log.info(
    {
      did: event.locals.did ?? undefined,
      method: event.request.method,
      path: event.url.pathname,
      status: response.status,
      bytes: response.headers.get('content-length') ?? undefined,
    },
    'request',
  );

  return response;
};
