import { redirect } from '@sveltejs/kit';
import sql from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.did) redirect(302, '/auth/signin');

  const protocols = await sql<
    {
      at_uri: string;
      title: string;
      description: string;
      created_at: string;
      target_count: number;
    }[]
  >`
    SELECT
      sp.at_uri,
      sp.title,
      sp.description,
      sp.created_at,
      COUNT(st.id)::int AS target_count
    FROM survey_protocols sp
    LEFT JOIN survey_targets st ON st.protocol_uri = sp.at_uri
    WHERE sp.did = ${locals.did}
    GROUP BY sp.at_uri, sp.title, sp.description, sp.created_at
    ORDER BY sp.created_at DESC
  `;

  return { protocols };
};
