import { error } from '@sveltejs/kit';
import sql from '$lib/server/db';
import type { PageServerLoad } from './$types';

interface ProtocolRow {
  at_uri: string;
  rkey: string;
  title: string;
  description: string;
  created_at: string;
  target_count: number;
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
      title,
      description,
      created_at,
      (SELECT COUNT(*) FROM survey_targets WHERE protocol_uri = survey_protocols.at_uri)::int AS target_count
    FROM survey_protocols
    WHERE did = ${user.did}
    ORDER BY created_at DESC
  `;

  return { protocols, handle: params.handle };
};
