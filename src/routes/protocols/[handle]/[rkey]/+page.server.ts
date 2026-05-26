import { error, redirect } from '@sveltejs/kit';
import { getFollowerCount } from '$lib/server/db/protocol-follows';
import { getProtocolDetailByHandleAndRkey } from '$lib/server/db/survey-protocols';
import {
  getLastSurveyByTargetUris,
  toLastSurveyMap,
} from '$lib/server/db/surveys';
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

  const lastSurveyByTargetUri = toLastSurveyMap(
    await getLastSurveyByTargetUris(protocol.targets.map((t) => t.atUri)),
  );

  return {
    protocol,
    handle: params.handle,
    followerCount,
    lastSurveyByTargetUri,
  };
};
