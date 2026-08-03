import { json } from '@sveltejs/kit';
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
import type { RequestHandler } from './$types';

// Moved here from the `follow`/`unfollow` form actions on
// src/routes/app/protocols/[handle]/[rkey]/+page.server.ts so that /app can be
// built statically. Behaviour and status codes are unchanged; the only
// difference is that failures come back as JSON bodies with a status rather
// than SvelteKit ActionFailures.

async function resolveProtocolUri(
  handle: string,
  rkey: string,
): Promise<string | null> {
  const [user] = await sql<{ did: string }[]>`
    SELECT did FROM users WHERE handle = ${handle.toLowerCase()}
  `;
  if (!user) return null;

  const [protocol] = await sql<{ at_uri: string }[]>`
    SELECT at_uri FROM survey_protocols
    WHERE did = ${user.did} AND rkey = ${rkey}
    LIMIT 1
  `;
  return protocol?.at_uri ?? null;
}

// PDS writes fail in ways the UI needs to tell apart: an expired session means
// "sign in again", while insufficient scope means "re-authorize" — different
// explanations, so they keep distinct flags rather than collapsing into 502.
function pdsErrorResponse(err: unknown): Response {
  if (err instanceof PdsScopeInsufficientError) {
    return json({ permissionRequired: true }, { status: 403 });
  }
  if (err instanceof PdsSessionExpiredError) {
    return json({ sessionExpired: true }, { status: 401 });
  }
  return json({ error: `PDS error: ${String(err)}` }, { status: 502 });
}

export const POST: RequestHandler = async ({ params, locals }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });

  const protocolUri = await resolveProtocolUri(params.handle, params.rkey);
  if (!protocolUri) return json({ error: 'Not found' }, { status: 404 });

  const existing = await getFollowByDidAndProtocol(locals.did, protocolUri);
  if (existing) return json({ isFollowing: true });

  const createdAt = new Date().toISOString();
  let uri: string;
  try {
    ({ uri } = await createRecord(
      locals.did,
      'bio.cuanto.surveyProtocol.follow',
      {
        $type: 'bio.cuanto.surveyProtocol.follow',
        subject: protocolUri,
        createdAt,
      },
    ));
  } catch (err) {
    return pdsErrorResponse(err);
  }

  await createFollow({
    atUri: uri,
    did: locals.did,
    rkey: uri.split('/').at(-1) ?? '',
    protocolUri,
    createdAt,
  });

  // Adopting a protocol materializes the surveyor's own copies of its targets.
  // Non-fatal: the survey-creation path re-ensures materialization.
  await materializeSurveyTargets(locals.did, protocolUri);

  return json({ isFollowing: true });
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
  if (!locals.did) return json({ error: 'Unauthorized' }, { status: 401 });

  const protocolUri = await resolveProtocolUri(params.handle, params.rkey);
  if (!protocolUri) return json({ error: 'Not found' }, { status: 404 });

  const follow = await getFollowByDidAndProtocol(locals.did, protocolUri);
  if (!follow) return json({ isFollowing: false });

  await deleteFollow(follow.at_uri);
  try {
    await deleteRecord(follow.at_uri);
  } catch (err) {
    return pdsErrorResponse(err);
  }

  // Clean up materialized surveyTargets if the user is no longer engaged with
  // the protocol (no remaining surveys).
  await gcSurveyTargetsIfUnused(locals.did, protocolUri);

  return json({ isFollowing: false });
};
