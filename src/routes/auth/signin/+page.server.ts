import { redirect } from '@sveltejs/kit';
import { getClient } from '$lib/server/auth';
import type { Actions } from './$types';

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

    // Get the user's PDS authorization URL and send them there
    const handle = data.get('handle') as string;
    const authUrl = await (await getClient()).authorize(handle);
    redirect(302, authUrl.toString());
  },
};
