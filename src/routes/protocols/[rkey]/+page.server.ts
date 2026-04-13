import { error, redirect } from '@sveltejs/kit';
import sql from '$lib/server/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
  if (!locals.did) redirect(302, '/auth/signin');

  const [protocol] = await sql<
    {
      at_uri: string;
      title: string;
      description: string;
      required_fields: string[];
      created_at: string;
    }[]
  >`
    SELECT at_uri, title, description, required_fields, created_at
    FROM survey_protocols
    WHERE did = ${locals.did} AND rkey = ${params.rkey}
    LIMIT 1
  `;

  if (!protocol) error(404, 'Protocol not found');

  const targets = await sql<{ at_uri: string; scope: unknown[] }[]>`
    SELECT at_uri, scope
    FROM survey_targets
    WHERE protocol_uri = ${protocol.at_uri}
    ORDER BY indexed_at ASC
  `;

  return { protocol, targets };
};
