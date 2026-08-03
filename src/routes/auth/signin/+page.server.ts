import { fail, redirect } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { sanitizeHandleInput } from '$lib/handle';
import { getClient } from '$lib/server/auth';
import logger from '$lib/server/logger';
import {
  isValidChallenge,
  NATIVE_CHALLENGE_COOKIE,
} from '$lib/server/native-auth';
import type { Actions } from './$types';

const log = logger.child({ component: 'signin' });

// Only reachable from a broken or hostile native client, never from the web
// form, so it does not need to be friendly — just not silent.
const NATIVE_CHALLENGE_ERROR =
  'This app version can’t sign in. Please update the app and try again.';

// Shown when authorize() rejects the handle. Auth can fail for reasons beyond a
// malformed handle (PDS down, network), so the message stays general and points
// at the most common fixes rather than asserting the handle is invalid.
const SIGN_IN_ERROR =
  "We couldn't sign you in with that handle. Check for typos, drop any " +
  '"@" symbols, and use your full handle (e.g. you.bsky.social).';

export const actions: Actions = {
  default: async ({ request, cookies, url }) => {
    const data = await request.formData();

    const returnTo = url.searchParams.get('returnTo');
    if (returnTo?.startsWith('/') && !returnTo.startsWith('//')) {
      cookies.set('return_to', returnTo, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 600,
      });
    }

    // A native client opens this page in the system browser with
    // ?client=native&challenge=<S256(verifier)>. Stashing the challenge in a
    // cookie carries it across the PDS round trip to /oauth/callback, which is
    // where it decides between setting a `did` cookie and handing back a code.
    // Rejecting a malformed challenge here rather than later means a broken
    // client fails before the user has typed anything.
    const challenge = url.searchParams.get('challenge');
    if (url.searchParams.get('client') === 'native') {
      if (!isValidChallenge(challenge)) {
        // `handle` is echoed back for the same reason the other failures do it
        // — the form repopulates from it — and keeping the shape uniform means
        // the page does not have to discriminate between failure kinds.
        return fail(422, {
          handle: (data.get('handle') as string | null) ?? '',
          message: NATIVE_CHALLENGE_ERROR,
        });
      }
      cookies.set(NATIVE_CHALLENGE_COOKIE, challenge as string, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        // The challenge is not secret — PKCE publishes it — but its integrity
        // is what binds the code to the app that started the flow. Without
        // `secure`, an active network attacker on plain HTTP could overwrite it
        // with one derived from their own verifier and then redeem an
        // intercepted code. Matches how the `did` cookie is set in
        // src/routes/oauth/callback/+server.ts.
        secure: new URL(publicEnv.PUBLIC_URL).protocol === 'https:',
        maxAge: 600,
      });
    } else {
      // Clear any leftover from an abandoned native attempt, so a subsequent
      // web sign-in in the same browser cannot be diverted into the app.
      cookies.delete(NATIVE_CHALLENGE_COOKIE, { path: '/' });
    }

    const raw = (data.get('handle') as string | null) ?? '';
    const handle = sanitizeHandleInput(raw);

    if (!handle) {
      return fail(422, {
        handle: raw,
        message: 'Enter your Atmosphere handle to continue.',
      });
    }

    // Get the user's PDS authorization URL and send them there. authorize()
    // throws on handles it can't resolve; turn that into a friendly 422 on the
    // form instead of an unhandled 500.
    let authUrl: URL;
    try {
      authUrl = await (await getClient()).authorize(handle);
    } catch (err) {
      log.error({ err, handle }, 'OAuth authorize failed');
      return fail(422, { handle, message: SIGN_IN_ERROR });
    }
    redirect(302, authUrl.toString());
  },
};
