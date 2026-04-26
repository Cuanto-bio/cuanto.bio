import { error } from '@sveltejs/kit';
import sql from '$lib/server/db';
import { getSurveysPageByDid } from '$lib/server/db/surveys';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const [user] = await sql<{ did: string }[]>`
    SELECT did FROM users WHERE handle = ${params.handle.toLowerCase()}
  `;
  if (!user) error(404, 'User not found');

  const surveys = await getSurveysPageByDid(user.did);

  return { surveys, handle: params.handle };
};
