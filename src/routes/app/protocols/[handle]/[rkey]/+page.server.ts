import { error, fail } from '@sveltejs/kit';
import sql from '$lib/server/db';
import {
  createFollow,
  deleteFollow,
  getFollowByDidAndProtocol,
} from '$lib/server/db/protocol-follows';
import {
  gcSurveyTargetsIfUnused,
  materializeSurveyTargets,
} from '$lib/server/materialize-targets';
import {
  createRecord,
  deleteRecord,
  PdsScopeInsufficientError,
  PdsSessionExpiredError,
} from '$lib/server/pds';
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
    let uri: string;
    try {
      ({ uri } = await createRecord(
        locals.did,
        'bio.cuanto.surveyProtocol.follow',
        {
          $type: 'bio.cuanto.surveyProtocol.follow',
          subject: protocol.at_uri,
          createdAt,
        },
      ));
    } catch (err) {
      if (err instanceof PdsScopeInsufficientError) {
        return fail(403, { permissionRequired: true });
      }
      if (err instanceof PdsSessionExpiredError) {
        return fail(401, { sessionExpired: true });
      }
      return fail(502, { error: `PDS error: ${String(err)}` });
    }

    await createFollow({
      atUri: uri,
      did: locals.did,
      rkey: uri.split('/').at(-1) ?? '',
      protocolUri: protocol.at_uri,
      createdAt,
    });

    // Adopting a protocol materializes the surveyor's own copies of its targets.
    // Non-fatal: the survey-creation path re-ensures materialization.
    await materializeSurveyTargets(locals.did, protocol.at_uri);

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
    try {
      await deleteRecord(follow.at_uri);
    } catch (err) {
      if (err instanceof PdsScopeInsufficientError) {
        return fail(403, { permissionRequired: true });
      }
      if (err instanceof PdsSessionExpiredError) {
        return fail(401, { sessionExpired: true });
      }
      return fail(502, { error: `PDS error: ${String(err)}` });
    }

    // Clean up materialized surveyTargets if the user is no longer engaged with
    // the protocol (no remaining surveys).
    await gcSurveyTargetsIfUnused(locals.did, protocol.at_uri);

    return { isFollowing: false };
  },
};
