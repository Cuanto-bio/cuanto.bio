import { createDidResolver } from '@atproto/oauth-client-node';
import { redirect } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { getClient } from '$lib/server/auth';
import { insertUser } from '$lib/server/db/users';
import { fetchAvatarUrl } from '$lib/server/pds';
import type { RequestHandler } from './$types';

// User has authorized access to their PDS, put their DID in a cookie and show
// them the site
export const GET: RequestHandler = async ({ url, cookies }) => {
  const { session } = await (await getClient()).callback(url.searchParams);
  cookies.set('did', session.did, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: new URL(publicEnv.PUBLIC_URL).protocol === 'https:',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  const didRes = createDidResolver({});
  const didDoc = await didRes.resolve(session.did);

  if (didDoc.alsoKnownAs && didDoc.alsoKnownAs.length > 0) {
    const handle = didDoc.alsoKnownAs[0].replace(/^at:\/\//, '');
    const avatarUrl = await fetchAvatarUrl(session.did);
    await insertUser(session.did, handle, avatarUrl);
  }

  // Register DID with tap so it begins tracking the user's records from the firehose.
  // Fire-and-forget: a tap failure must not break the OAuth flow.
  fetch(`${privateEnv.TAP_URL}/repos/add`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${btoa(`admin:${privateEnv.TAP_ADMIN_PASSWORD}`)}`,
    },
    body: JSON.stringify({ dids: [session.did] }),
  }).catch((err) => console.error('Failed to register DID with tap:', err));

  const returnTo = cookies.get('return_to');
  if (returnTo?.startsWith('/') && !returnTo.startsWith('//')) {
    cookies.delete('return_to', { path: '/' });
    redirect(302, returnTo);
  }

  redirect(302, '/');
};
