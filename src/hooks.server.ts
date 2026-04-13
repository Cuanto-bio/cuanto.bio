import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
  // Assign the signed in user's DID from their cookie to local vars for every
  // request
  event.locals.did = event.cookies.get('did');

  return resolve(event);
};
