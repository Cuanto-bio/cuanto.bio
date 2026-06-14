import type { Handle } from '@sveltejs/kit';
import logger from '$lib/server/logger';

const log = logger.child({ component: 'request' });

export const handle: Handle = async ({ event, resolve }) => {
  // Assign the signed in user's DID from their cookie to local vars for every
  // request
  event.locals.did = event.cookies.get('did');

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
