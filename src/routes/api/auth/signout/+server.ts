import { json } from '@sveltejs/kit';
import {
  parseBearer,
  revokeAllTokensForDid,
  revokeToken,
} from '$lib/server/app-tokens';
import type { RequestHandler } from './$types';

// Sign-out for bearer clients. The cookie equivalent is /auth/signout, which
// just deletes the cookie; a token has to be revoked server-side because the
// client cannot make the server forget it by dropping it locally.
//
// hooks.server resolves the header to a DID and discards the token itself, so
// this re-reads the header to know *which* token to revoke.
export const POST: RequestHandler = async ({ request, locals, url }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });

  // ?all=1 revokes every token for the DID ("sign out everywhere"), which is
  // the useful action after a lost or stolen device — the token on that device
  // is exactly the one the user can no longer present.
  if (url.searchParams.get('all') === '1') {
    await revokeAllTokensForDid(locals.did);
    return json({ signedOut: true, scope: 'all' });
  }

  const token = parseBearer(request.headers.get('authorization'));
  if (!token) {
    // Authenticated by cookie, so there is no token to revoke. Not an error:
    // /auth/signout is the right endpoint for that client, and reporting
    // failure here would be misleading.
    return json({ signedOut: false, scope: 'none' });
  }

  await revokeToken(token);
  return json({ signedOut: true, scope: 'token' });
};
