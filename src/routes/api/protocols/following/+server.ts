import { json } from '@sveltejs/kit';
import type { Protocol } from '$lib/offline/db';
import { getFollowsByDid } from '$lib/server/db/protocol-follows';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });

  const follows = await getFollowsByDid(locals.did);
  const protocols: Protocol[] = follows.map((f) => ({
    atUri: f.protocol_uri,
    rkey: f.protocol_rkey,
    title: f.protocol_title,
    description: f.protocol_description,
    handle: f.handle,
    targets: [],
  }));

  return json(protocols);
};
