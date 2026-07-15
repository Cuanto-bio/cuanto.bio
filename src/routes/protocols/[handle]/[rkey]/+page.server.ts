import { error, redirect } from '@sveltejs/kit';
import { getProtocolActivity } from '$lib/server/db/protocol-activity';
import {
  getFollowerCount,
  getProtocolFollowerPreview,
} from '$lib/server/db/protocol-follows';
import { getProtocolDetailByHandleAndRkey } from '$lib/server/db/survey-protocols';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
  // If signed in, redirect to /app equivalent
  if (locals.did)
    redirect(
      302,
      `/app/protocols/${params.handle}/${params.rkey}${url.search}`,
    );

  const protocol = await getProtocolDetailByHandleAndRkey(
    params.handle,
    params.rkey,
  );
  if (!protocol) error(404, 'Protocol not found');

  const followerCount = await getFollowerCount(protocol.atUri);
  const followerPreview = await getProtocolFollowerPreview(protocol.atUri);

  const activity = await getProtocolActivity(
    protocol.atUri,
    protocol.targets.map((t) => t.atUri),
  );

  return {
    protocol,
    handle: params.handle,
    followerCount,
    followerPreview,
    activity,
  };
};
