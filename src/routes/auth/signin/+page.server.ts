import { fail, redirect } from '@sveltejs/kit';
import { sanitizeHandleInput } from '$lib/handle';
import { getClient } from '$lib/server/auth';
import logger from '$lib/server/logger';
import type { Actions } from './$types';

const log = logger.child({ component: 'signin' });

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
