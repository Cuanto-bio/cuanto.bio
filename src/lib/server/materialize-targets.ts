import type { l } from '@atproto/lex';
import { parseAtUri } from '$lib/atUri';
import * as SurveyTarget from '$lib/lexicons/bio/cuanto/surveyTarget';
import { getFollowByDidAndProtocol } from '$lib/server/db/protocol-follows';
import {
  getProtocolTargetStatusesByProtocol,
  getProtocolTargetsForProtocols,
  type ProtocolTargetStatusRow,
} from '$lib/server/db/survey-protocols';
import {
  deleteSurveyTargetsByDidAndProtocol,
  getSurveyTargetsByDidAndProtocol,
  insertSurveyTarget,
  type SurveyTargetRow,
} from '$lib/server/db/survey-targets';
import { countSurveysByDidAndProtocol } from '$lib/server/db/surveys';
import logger from '$lib/server/logger';
import { deleteRecord, putRecord } from '$lib/server/pds';

const log = logger.child({ component: 'materialize-targets' });

// Builds, writes to the PDS, and indexes a bio.cuanto.surveyTarget record.
// Shared by the forward-materialize loop and reconcileRetirements below so the
// build -> putRecord -> insertSurveyTarget sequence lives in one place.
async function writeSurveyTarget(
  did: string,
  rkey: string,
  protocolTargetUri: string,
  fields: Parameters<typeof SurveyTarget.$build>[0],
): Promise<void> {
  const record = SurveyTarget.$build(fields);
  const { uri } = await putRecord(did, SurveyTarget.$nsid, rkey, record);
  await insertSurveyTarget(did, rkey, record, uri, protocolTargetUri);
}

// Ensures the surveyor (did) has a bio.cuanto.surveyTarget for each of the
// protocol's protocolTargets, reusing the protocolTarget's rkey so the operation
// is idempotent and the occurrence-repoint mapping is deterministic. The scope is
// copied from the protocolTarget so it survives the author deleting the protocol.
// Source data comes from the local index, so this works regardless of whether the
// protocol author has migrated their own records. Also reconciles retirement of
// surveyTargets whose source protocolTarget has been deleted (or un-deleted); see
// reconcileRetirements.
export async function materializeSurveyTargets(
  did: string,
  protocolUri: string,
): Promise<void> {
  const [protocolTargets, targetStatuses, existing] = await Promise.all([
    getProtocolTargetsForProtocols([protocolUri]),
    getProtocolTargetStatusesByProtocol(protocolUri),
    getSurveyTargetsByDidAndProtocol(did, protocolUri),
  ]);

  const existingByRkey = new Map(existing.map((t) => [t.rkey, t]));

  for (const pt of protocolTargets) {
    const { rkey } = parseAtUri(pt.at_uri);
    const existingTarget = existingByRkey.get(rkey);
    // A live row means this target is already materialized. A tombstoned one
    // means the record was deleted on the surveyor's PDS (issue #41), so it gets
    // recreated -- carrying the original adoption time forward rather than
    // stamping "now", which would retroactively suppress the notDetected rows of
    // every survey conducted before the deletion. The row is the only thing that
    // still knows that time, but the recreated record carries it, so the record
    // stays the source of truth. insertSurveyTarget clears the tombstone.
    if (existingTarget && !existingTarget.deleted_at) continue;

    const createdAt = (existingTarget?.record.createdAt ??
      existingTarget?.created_at?.toISOString() ??
      new Date().toISOString()) as l.DatetimeString;

    await writeSurveyTarget(did, rkey, pt.at_uri, {
      protocol: protocolUri as l.AtUriString,
      protocolTargetID: pt.at_uri as l.AtUriString,
      createdAt,
      scope: pt.record.scope,
    });
  }

  await reconcileRetirements(did, protocolUri, existing, targetStatuses);

  log.info(
    { did, protocolUri, count: protocolTargets.length },
    'materialized survey targets',
  );
}

// Retires surveyTargets whose source protocolTarget was deleted (stamps
// retiredAt with the true deletion time), and un-retires ones whose
// protocolTarget is live again under the same rkey (clears retiredAt; a genuine
// re-add gets a new rkey, so same-rkey reappearance is recovery from an
// erroneous or transient delete, not history worth preserving).
//
// Keyed on protocol_targets.deleted_at (a tombstone left by
// tombstoneProtocolTargetsByUris) rather than presence/absence in the live-only
// view, so "deleted" and "not indexed yet" are distinguishable: a target with
// no protocol_targets row at all -- live or tombstoned -- is left untouched,
// because we simply don't have enough information yet (see
// docs/2026-07-16-survey-target-retirement.md).
//
// Failures are per-target and non-fatal (logged, not thrown): this runs inline
// on survey create/edit and protocol follow, so a transient PDS error while
// retiring one orphaned target must not fail the surveyor's actual request.
// Whatever didn't get stamped this time is retried on the next materialize call.
async function reconcileRetirements(
  did: string,
  protocolUri: string,
  existing: SurveyTargetRow[],
  targetStatuses: ProtocolTargetStatusRow[],
): Promise<void> {
  const statusByRkey = new Map(targetStatuses.map((s) => [s.rkey, s]));

  for (const target of existing) {
    const status = statusByRkey.get(target.rkey);
    if (!status) continue; // no signal yet: not indexed, or mid-backfill

    const isDeleted = status.deleted_at !== null;
    const isRetired = target.record.retiredAt != null;
    if (isDeleted === isRetired) continue; // already consistent

    // record.createdAt is required by the lexicon, but rows that predate the
    // field (migration 20260610002 backfilled only the created_at column, not
    // the record JSON) can have it undefined; fall back to that column rather
    // than rewrite the record with a missing required field.
    const createdAt = (target.record.createdAt ??
      target.created_at?.toISOString() ??
      new Date().toISOString()) as l.DatetimeString;

    const retiredAt = status.deleted_at
      ? (status.deleted_at.toISOString() as l.DatetimeString)
      : undefined;

    try {
      await writeSurveyTarget(did, target.rkey, target.protocol_target_uri, {
        protocol: target.record.protocol,
        protocolTargetID: target.record.protocolTargetID,
        createdAt,
        scope: target.record.scope,
        ...(retiredAt ? { retiredAt } : {}),
      });
    } catch (err) {
      log.error(
        { err, did, protocolUri, rkey: target.rkey },
        'failed to reconcile surveyTarget retirement',
      );
    }
  }
}

// Deletes the surveyor's materialized surveyTargets for a protocol when they are
// no longer engaged with it (not following AND no surveys remain). Keying on
// survey existence (not occurrence existence) preserves sought-but-not-found
// targets. Call after an unfollow or a survey deletion.
//
// Still a hard delete, deliberately, even though a PDS-side deletion now only
// tombstones (issue #41). Zero surveys means zero occurrences
// (occurrences.survey_uri is NOT NULL with an FK to surveys), so there is no
// detection to keep joinable and no adoption time worth remembering here, and
// tombstoning would defeat the point of a cleanup path. The PDS deletions below
// come back as delete events, where the tombstone update simply matches no row.
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
