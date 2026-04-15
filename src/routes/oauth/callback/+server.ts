import { createDidResolver } from '@atproto/oauth-client-node';
import { redirect } from '@sveltejs/kit';
import { TAP_ADMIN_PASSWORD, TAP_URL } from '$env/static/private';
import { PUBLIC_URL } from '$env/static/public';
import { client } from '$lib/server/auth';
import { insertUser } from '$lib/server/users';
import type { RequestHandler } from './$types';

// User has authorized access to their PDS, put their DID in a cookie and show
// them the site
export const GET: RequestHandler = async ({ url, cookies }) => {
  const { session } = await client.callback(url.searchParams);
  cookies.set('did', session.did, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: new URL(PUBLIC_URL).protocol === 'https:',
  });

  const didRes = createDidResolver({});
  const didDoc = await didRes.resolve(session.did);

  if (didDoc.alsoKnownAs && didDoc.alsoKnownAs.length > 0) {
    const handle = didDoc.alsoKnownAs[0].replace(/^at:\/\//, '');
    await insertUser(session.did, handle);
  }

  // Register DID with tap so it begins tracking the user's records from the firehose.
  // Fire-and-forget: a tap failure must not break the OAuth flow.
  fetch(`${TAP_URL}/repos/add`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`admin:${TAP_ADMIN_PASSWORD}`)}`,
    },
    body: JSON.stringify({ dids: [session.did] }),
  }).catch((err) => console.error('Failed to register DID with tap:', err));

  redirect(302, '/');
};
