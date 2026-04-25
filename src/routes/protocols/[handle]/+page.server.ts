import { error } from '@sveltejs/kit';
import sql from '$lib/server/db';
import type { PageServerLoad } from './$types';

interface ProtocolRow {
  at_uri: string;
  rkey: string;
  title: string;
  description: string;
}

export const load: PageServerLoad = async ({ params }) => {
  const [user] = await sql<{ did: string }[]>`
    SELECT did FROM users WHERE handle = ${params.handle.toLowerCase()}
  `;
  if (!user) error(404, 'User not found');

  const protocols = await sql<ProtocolRow[]>`
    SELECT
      at_uri,
      rkey,
      record->>'title' AS title,
      record->>'description' AS description
    FROM survey_protocols
    WHERE did = ${user.did}
    ORDER BY indexed_at DESC
  `;

  return { protocols, handle: params.handle };
};
