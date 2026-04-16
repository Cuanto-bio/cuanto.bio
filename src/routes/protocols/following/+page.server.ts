import { redirect } from '@sveltejs/kit';
import { getFollowsByDid } from '$lib/server/db/protocol-follows';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.did) redirect(302, '/auth/signin');

  const follows = await getFollowsByDid(locals.did);
  return { follows };
};
