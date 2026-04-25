import sql from '$lib/server/db';
import type { PageServerLoad } from './$types';

interface ProtocolRow {
  at_uri: string;
  rkey: string;
  title: string;
  description: string;
  handle: string;
}

export const load: PageServerLoad = async () => {
  const protocols = await sql<ProtocolRow[]>`
    SELECT
      sp.at_uri,
      sp.rkey,
      sp.record->>'title' AS title,
      sp.record->>'description' AS description,
      u.handle
    FROM survey_protocols sp
    JOIN users u ON u.did = sp.did
    ORDER BY sp.indexed_at DESC
  `;

  return { protocols };
};
