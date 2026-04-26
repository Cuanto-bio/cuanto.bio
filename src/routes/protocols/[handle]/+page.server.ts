import { error } from '@sveltejs/kit';
import sql from '$lib/server/db';
import { getProtocolsPageByDid } from '$lib/server/db/survey-protocols';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params }) => {
  const [user] = await sql<{ did: string }[]>`
    SELECT did FROM users WHERE handle = ${params.handle.toLowerCase()}
  `;
  if (!user) error(404, 'User not found');
  console.log('[+page.server.ts] here');

  const protocols = await getProtocolsPageByDid(user.did);
  console.log('[+page.server.ts] protocols: ', protocols);

  return {
    protocols,
    handle: params.handle,
  };
};
