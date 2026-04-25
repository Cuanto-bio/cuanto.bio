import { json } from '@sveltejs/kit';
import { getFollowedProtocolsByDid } from '$lib/server/db/survey-protocols';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });

  const protocols = await getFollowedProtocolsByDid(locals.did);
  return json(protocols);
};
