import { error, redirect } from '@sveltejs/kit';
import sql from '$lib/server/db';
import { getFollowerCount } from '$lib/server/db/protocol-follows';
import type { PageServerLoad } from './$types';

interface ProtocolRow {
  at_uri: string;
  title: string;
  description: string;
  required_fields: string[];
  created_at: string;
  cid: string;
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
  // If signed in, redirect to /app equivalent
  if (locals.did)
    redirect(
      302,
      `/app/protocols/${params.handle}/${params.rkey}${url.search}`,
    );
  const [user] = await sql<{ did: string }[]>`
    SELECT did FROM users WHERE handle = ${params.handle.toLowerCase()}
  `;
  if (!user) error(404, 'User not found');

  const [protocol] = await sql<ProtocolRow[]>`
    SELECT at_uri, title, description, required_fields, created_at, cid
    FROM survey_protocols
    WHERE did = ${user.did} AND rkey = ${params.rkey}
    LIMIT 1
  `;
  if (!protocol) error(404, 'Protocol not found');

  const targets = await sql<{ at_uri: string; scope: unknown[] }[]>`
    SELECT at_uri, scope
    FROM survey_targets
    WHERE protocol_uri = ${protocol.at_uri}
    ORDER BY indexed_at ASC
  `;

  const followerCount = await getFollowerCount(protocol.at_uri);

  return {
    protocol,
    targets,
    handle: params.handle,
    followerCount,
  };
};
