import { error, redirect } from '@sveltejs/kit';
import { getFollowerCount } from '$lib/server/db/protocol-follows';
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

  return {
    protocol,
    handle: params.handle,
    followerCount,
  };
};
