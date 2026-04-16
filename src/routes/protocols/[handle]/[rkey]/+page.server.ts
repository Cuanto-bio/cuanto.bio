import { error, redirect } from '@sveltejs/kit';
import sql from '$lib/server/db';
import {
  createFollow,
  deleteFollow,
  getFollowByDidAndProtocol,
  getFollowerCount,
} from '$lib/server/db/protocol-follows';
import { createRecord, deleteRecord } from '$lib/server/pds';
import type { Actions, PageServerLoad } from './$types';

interface ProtocolRow {
  at_uri: string;
  title: string;
  description: string;
  required_fields: string[];
  created_at: string;
  cid: string;
}

export const load: PageServerLoad = async ({ params, locals }) => {
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

  return {
    protocol,
    targets,
    handle: params.handle,
    followerCount,
    isFollowing,
    isAuthenticated: !!locals.did,
  };
};

export const actions: Actions = {
  follow: async ({ params, locals }) => {
    if (!locals.did) redirect(302, '/auth/signin');

    const [user] = await sql<{ did: string }[]>`
      SELECT did FROM users WHERE handle = ${params.handle.toLowerCase()}
    `;
    if (!user) error(404, 'User not found');

    const [protocol] = await sql<{ at_uri: string }[]>`
      SELECT at_uri FROM survey_protocols
      WHERE did = ${user.did} AND rkey = ${params.rkey}
      LIMIT 1
    `;
    if (!protocol) error(404, 'Protocol not found');

    const existing = await getFollowByDidAndProtocol(
      locals.did,
      protocol.at_uri,
    );
    if (existing) return { isFollowing: true };

    const createdAt = new Date().toISOString();
    const { uri } = await createRecord(
      locals.did,
      'bio.cuanto.surveyProtocol.follow',
      {
        $type: 'bio.cuanto.surveyProtocol.follow',
        subject: protocol.at_uri,
        createdAt,
      },
    );

    await createFollow({
      atUri: uri,
      did: locals.did,
      rkey: uri.split('/').at(-1) ?? '',
      protocolUri: protocol.at_uri,
      createdAt,
    });

    return { isFollowing: true };
  },

  unfollow: async ({ params, locals }) => {
    if (!locals.did) redirect(302, '/auth/signin');

    const [user] = await sql<{ did: string }[]>`
      SELECT did FROM users WHERE handle = ${params.handle.toLowerCase()}
    `;
    if (!user) error(404, 'User not found');

    const [protocol] = await sql<{ at_uri: string }[]>`
      SELECT at_uri FROM survey_protocols
      WHERE did = ${user.did} AND rkey = ${params.rkey}
      LIMIT 1
    `;
    if (!protocol) error(404, 'Protocol not found');

    const follow = await getFollowByDidAndProtocol(locals.did, protocol.at_uri);
    if (!follow) return { isFollowing: false };

    await deleteFollow(follow.at_uri);
    await deleteRecord(follow.at_uri);

    return { isFollowing: false };
  },
};
