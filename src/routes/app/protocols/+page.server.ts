import sql from '$lib/server/db';
import type { PageServerLoad } from './$types';

interface ProtocolRow {
  at_uri: string;
  rkey: string;
  title: string;
  description: string;
  created_at: string;
  handle: string;
  target_count: number;
}

// Protocol list is publicly readable — no auth required.
export const load: PageServerLoad = async () => {
  const protocols = await sql<ProtocolRow[]>`
    SELECT
      sp.at_uri,
      sp.rkey,
      sp.title,
      sp.description,
      sp.created_at,
      u.handle,
      COUNT(st.id)::int AS target_count
    FROM survey_protocols sp
    JOIN users u ON u.did = sp.did
    LEFT JOIN survey_targets st ON st.protocol_uri = sp.at_uri
    GROUP BY sp.at_uri, sp.rkey, sp.title, sp.description, sp.created_at, u.handle
    ORDER BY sp.created_at DESC
  `;

  return { protocols };
};
