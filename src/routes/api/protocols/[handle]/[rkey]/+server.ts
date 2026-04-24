import { error, json } from '@sveltejs/kit';
import {
  getFollowByDidAndProtocol,
  getFollowerCount,
} from '$lib/server/db/protocol-follows';
import { getProtocolDetailByHandleAndRkey } from '$lib/server/db/survey-protocols';
import type { RequestHandler } from './$types';

// Protocols are publicly readable — no auth required.
export const GET: RequestHandler = async ({ params, locals }) => {
  const protocol = await getProtocolDetailByHandleAndRkey(
    params.handle,
    params.rkey,
  );
  if (!protocol) error(404, 'Protocol not found');

  const followerCount = await getFollowerCount(protocol.atUri);

  let isFollowing = false;
  if (locals.did) {
    const follow = await getFollowByDidAndProtocol(locals.did, protocol.atUri);
    isFollowing = follow !== null;
  }

  return json({
    protocol,
    handle: params.handle,
    followerCount,
    isFollowing,
  });
};
