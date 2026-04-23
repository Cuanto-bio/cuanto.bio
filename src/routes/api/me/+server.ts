import { json } from '@sveltejs/kit';
import sql from '$lib/server/db';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });

  const [user] = await sql<{ handle: string }[]>`
    SELECT handle FROM users WHERE did = ${locals.did}
  `;
  if (!user) return json({ error: 'User not found' }, { status: 404 });

  return json({ did: locals.did, handle: user.handle });
};
