import { error, json } from '@sveltejs/kit';
import sql from '$lib/server/db';
import {
  getFollowByDidAndProtocol,
  getFollowerCount,
} from '$lib/server/db/protocol-follows';
import type { RequestHandler } from './$types';

interface ProtocolRow {
  at_uri: string;
  title: string;
  description: string;
  required_fields: string[];
  created_at: string;
  cid: string;
}

// Protocols are publicly readable — no auth required.
export const GET: RequestHandler = async ({ params, locals }) => {
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

  let isFollowing = false;
  if (locals.did) {
    const follow = await getFollowByDidAndProtocol(locals.did, protocol.at_uri);
    isFollowing = follow !== null;
  }

  return json({
    protocol,
    targets,
    handle: params.handle,
    followerCount,
    isFollowing,
  });
};
