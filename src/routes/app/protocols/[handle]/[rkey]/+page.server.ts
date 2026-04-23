import { error } from '@sveltejs/kit';
import sql from '$lib/server/db';
import {
  createFollow,
  deleteFollow,
  getFollowByDidAndProtocol,
} from '$lib/server/db/protocol-follows';
import { createRecord, deleteRecord } from '$lib/server/pds';
import type { Actions } from './$types';

export const actions: Actions = {
  follow: async ({ params, locals }) => {
    if (!locals.did) error(401, 'Not authenticated');

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
    if (!locals.did) error(401, 'Not authenticated');

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
