import { createDidResolver } from '@atproto/oauth-client-node';
import { redirect } from '@sveltejs/kit';
import { env as privateEnv } from '$env/dynamic/private';
import { env as publicEnv } from '$env/dynamic/public';
import { getClient } from '$lib/server/auth';
import { insertUser } from '$lib/server/db/users';
import logger from '$lib/server/logger';
import {
  issueCode,
  isValidChallenge,
  NATIVE_CHALLENGE_COOKIE,
  sweepExpiredCodes,
} from '$lib/server/native-auth';
import { nativeHandoffPage } from '$lib/server/native-handoff';
import { fetchAvatarUrl } from '$lib/server/pds';
import type { RequestHandler } from './$types';

const log = logger.child({ component: 'oauth-callback' });

// User has authorized access to their PDS, put their DID in a cookie and show
// them the site
export const GET: RequestHandler = async ({ url, cookies }) => {
  const { session } = await (await getClient()).callback(url.searchParams);

  // A native sign-in started at /auth/signin?client=native and left its PKCE
  // challenge in this cookie. Those clients get a single-use code handed back
  // through the app's custom URL scheme instead of a cookie, because a
  // cuanto.bio cookie is cross-site from capacitor://localhost and WKWebView
  // drops it. Consume the cookie either way so it cannot leak into a later
  // web sign-in in the same browser.
  const nativeChallenge = cookies.get(NATIVE_CHALLENGE_COOKIE);
  cookies.delete(NATIVE_CHALLENGE_COOKIE, { path: '/' });
  const isNative = isValidChallenge(nativeChallenge);

  // Deliberately not set for native clients: the whole point is that the app
  // authenticates with a bearer token, and leaving a session cookie in the
  // system browser would be an extra credential nobody uses.
  if (!isNative) {
    cookies.set('did', session.did, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: new URL(publicEnv.PUBLIC_URL).protocol === 'https:',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  }

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

  // Hand the native app a single-use code through its custom scheme. The code
  // is bound to the PKCE challenge from the cookie, so intercepting this
  // redirect (any app can claim a custom scheme on iOS) is not enough to
  // redeem it — see src/lib/server/native-auth.ts.
  if (isNative) {
    const code = await issueCode(session.did, nativeChallenge as string);
    // Fire-and-forget housekeeping; the flow does not depend on it.
    sweepExpiredCodes().catch((err) =>
      log.warn({ err }, 'Failed to sweep expired auth codes'),
    );
    return nativeHandoffPage(code);
  }

  const returnTo = cookies.get('return_to');
  if (returnTo?.startsWith('/') && !returnTo.startsWith('//')) {
    cookies.delete('return_to', { path: '/' });
    redirect(302, returnTo);
  }

  redirect(302, '/');
};
