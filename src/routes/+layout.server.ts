import sql from '$lib/server/db';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  let handle: string | null = null;

  if (locals.did) {
    const [user] = await sql<{ handle: string }[]>`
      SELECT handle FROM users WHERE did = ${locals.did}
    `;
    handle = user?.handle ?? null;
  }

  return { did: locals.did, handle };
};
