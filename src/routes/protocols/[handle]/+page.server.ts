import { error } from '@sveltejs/kit';
import sql from '$lib/server/db';
import { getProtocolsPageByDid } from '$lib/server/db/survey-protocols';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const [user] = await sql<{ did: string }[]>`
    SELECT did FROM users WHERE handle = ${params.handle.toLowerCase()}
  `;
  if (!user) error(404, 'User not found');

  const protocols = await getProtocolsPageByDid(user.did);

  return {
    protocols,
    // Prefixed (not `handle`) because SvelteKit merges page data over the
    // root layout's data by key, and the root layout uses that exact name
    // for the *signed-in visitor's* identity. Reusing it here would make a
    // signed-out visitor viewing someone else's protocols show up in the
    // sidebar as if signed in as them (same bug fixed for /profile/[handle]
    // in 6929a35).
    ownerHandle: params.handle,
  };
};
