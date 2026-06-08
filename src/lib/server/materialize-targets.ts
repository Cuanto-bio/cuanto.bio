import type { l } from '@atproto/lex';
import { parseAtUri } from '$lib/atUri';
import * as SurveyTarget from '$lib/lexicons/bio/cuanto/surveyTarget';
import { getFollowByDidAndProtocol } from '$lib/server/db/protocol-follows';
import { getTargetsForProtocols } from '$lib/server/db/survey-protocols';
import {
  deleteSurveyTargetsByDidAndProtocol,
  getSurveyTargetsByDidAndProtocol,
  insertSurveyTarget,
} from '$lib/server/db/survey-targets';
import { countSurveysByDidAndProtocol } from '$lib/server/db/surveys';
import logger from '$lib/server/logger';
import { deleteRecord, putRecord } from '$lib/server/pds';

const log = logger.child({ component: 'materialize-targets' });

// Ensures the surveyor (did) has a bio.cuanto.surveyTarget for each of the
// protocol's protocolTargets, reusing the protocolTarget's rkey so the operation
// is idempotent and the occurrence-repoint mapping is deterministic. The scope is
// copied from the protocolTarget so it survives the author deleting the protocol.
// Source data comes from the local index, so this works regardless of whether the
// protocol author has migrated their own records.
export async function materializeSurveyTargets(
  did: string,
  protocolUri: string,
): Promise<void> {
  const protocolTargets = await getTargetsForProtocols([protocolUri]);
  if (protocolTargets.length === 0) return;

  const existing = await getSurveyTargetsByDidAndProtocol(did, protocolUri);
  const existingRkeys = new Set(existing.map((t) => t.rkey));

  for (const pt of protocolTargets) {
    const { rkey } = parseAtUri(pt.at_uri);
    if (existingRkeys.has(rkey)) continue;

    const record = SurveyTarget.$build({
      protocol: protocolUri as l.AtUriString,
      protocolTargetID: pt.at_uri as l.AtUriString,
      scope: pt.record.scope,
    });
    const { uri } = await putRecord(did, SurveyTarget.$nsid, rkey, record);
    await insertSurveyTarget(did, rkey, record, uri, pt.at_uri);
  }

  log.info(
    { did, protocolUri, count: protocolTargets.length },
    'materialized survey targets',
  );
}

// Deletes the surveyor's materialized surveyTargets for a protocol when they are
// no longer engaged with it (not following AND no surveys remain). Keying on
// survey existence (not occurrence existence) preserves sought-but-not-found
// targets. Call after an unfollow or a survey deletion.
export async function gcSurveyTargetsIfUnused(
  did: string,
  protocolUri: string,
): Promise<void> {
  const [following, surveyCount] = await Promise.all([
    getFollowByDidAndProtocol(did, protocolUri),
    countSurveysByDidAndProtocol(did, protocolUri),
  ]);
  if (following || surveyCount > 0) return;

  const uris = await deleteSurveyTargetsByDidAndProtocol(did, protocolUri);
  for (const uri of uris) {
    try {
      await deleteRecord(uri);
    } catch (err) {
      log.error({ err, uri }, 'Failed to delete surveyTarget from PDS');
    }
  }
  if (uris.length > 0) {
    log.info(
      { did, protocolUri, count: uris.length },
      'garbage-collected survey targets',
    );
  }
}
