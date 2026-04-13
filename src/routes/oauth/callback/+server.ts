import { redirect } from '@sveltejs/kit';
import { PUBLIC_URL } from '$env/static/public';
import { client } from '$lib/server/auth';
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
  redirect(302, '/');
};
