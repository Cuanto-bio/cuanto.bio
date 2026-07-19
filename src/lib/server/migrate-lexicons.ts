import { parseAtUri } from '$lib/atUri';
import sql from '$lib/server/db';
import { insertIdentification } from '$lib/server/db/identifications';
import { reindexFollowSubject } from '$lib/server/db/protocol-follows';
import {
  insertProtocol,
  insertProtocolTarget,
} from '$lib/server/db/survey-protocols';
import { insertSurveyTarget } from '$lib/server/db/survey-targets';
import { insertOccurrence, insertSurvey } from '$lib/server/db/surveys';
import logger from '$lib/server/logger';
import {
  type AtRecord,
  deleteRecord,
  fetchAtRecord,
  listAtRecords,
  putRecord,
} from '$lib/server/pds';
import { surveyTargetUriFor } from '$lib/surveyTargets';

const log = logger.child({ component: 'migrate-lexicons' });

// Collections that move to a new NSID (rkey preserved). Occurrence,
// identification, media keep their NSID and are updated in place.
const OLD_PROTOCOL_NSID = 'bio.lexicons.temp.v0-1.surveyProtocol';
const LEGACY_PROTOCOL_NSID = 'bio.lexicons.temp.surveyProtocol';
const NEW_PROTOCOL_NSID = 'bio.cuanto.surveyProtocol';
const OLD_TARGET_NSID = 'bio.lexicons.temp.v0-1.surveyTarget';
const LEGACY_TARGET_NSID = 'bio.lexicons.temp.surveyTarget';
const NEW_PROTOCOL_TARGET_NSID = 'bio.cuanto.protocolTarget';
const OLD_SURVEY_NSID = 'bio.lexicons.temp.v0-1.survey';
const LEGACY_SURVEY_NSID = 'bio.lexicons.temp.survey';
const NEW_SURVEY_NSID = 'bio.cuanto.survey';
const FOLLOW_NSID = 'bio.cuanto.surveyProtocol.follow';
const SURVEY_TARGET_NSID = 'bio.cuanto.surveyTarget';
const OCCURRENCE_NSID = 'bio.lexicons.temp.v0-1.occurrence';
const IDENTIFICATION_NSID = 'bio.lexicons.temp.v0-1.identification';

const OLD_PROTOCOL_NSIDS = [OLD_PROTOCOL_NSID, LEGACY_PROTOCOL_NSID];
const OLD_TARGET_NSIDS = [OLD_TARGET_NSID, LEGACY_TARGET_NSID];
const OLD_SURVEY_NSIDS = [OLD_SURVEY_NSID, LEGACY_SURVEY_NSID];

const COLLECTION_MOVES: Record<string, string> = {
  [OLD_PROTOCOL_NSID]: NEW_PROTOCOL_NSID,
  [LEGACY_PROTOCOL_NSID]: NEW_PROTOCOL_NSID,
  [OLD_TARGET_NSID]: NEW_PROTOCOL_TARGET_NSID,
  [LEGACY_TARGET_NSID]: NEW_PROTOCOL_TARGET_NSID,
  [OLD_SURVEY_NSID]: NEW_SURVEY_NSID,
  [LEGACY_SURVEY_NSID]: NEW_SURVEY_NSID,
};

type Json = Record<string, unknown>;
type StrongRef = { uri: string; cid: string };

// Rewrites an at-uri whose collection moved to a new NSID, preserving did + rkey.
// at-uris in unmoved collections are returned unchanged.
function migrateUri(uri: string): string {
  const { did, collection, rkey } = parseAtUri(uri);
  const next = COLLECTION_MOVES[collection];
  return next ? `at://${did}/${next}/${rkey}` : uri;
}

// Rewrites a scope-item $type whose base NSID moved, e.g.
// "bio.lexicons.temp.v0-1.surveyTarget#taxonScope" ->
// "bio.cuanto.protocolTarget#taxonScope".
// Types without a fragment or whose NSID didn't move are returned unchanged.
function migrateScopeType(type: string): string {
  const hash = type.indexOf('#');
  if (hash === -1) return type;
  const nsid = type.slice(0, hash);
  const next = COLLECTION_MOVES[nsid];
  return next ? `${next}${type.slice(hash)}` : type;
}

// Writes a record at a known rkey, reusing the existing record if one is already
// there (idempotent re-runs). Returns the resulting uri + cid.
async function upsertPdsRecord(
  did: string,
  collection: string,
  rkey: string,
  record: unknown,
): Promise<StrongRef> {
  const uri = `at://${did}/${collection}/${rkey}`;
  const existing = await fetchAtRecord(uri);
  if (existing) return { uri, cid: existing.cid };
  return putRecord(did, collection, rkey, record);
}

// Resolves the CID of a protocol's migrated record. Works cross-repo: if the
// author has already migrated, use the real CID; otherwise fall back to the old
// CID (the app keys on the URI, so the CID is integrity-only and converges once
// the author migrates).
async function resolveProtocolCid(
  newProtocolUri: string,
  fallbackCid: string,
  protocolMap: Map<string, StrongRef>,
): Promise<string> {
  const own = protocolMap.get(newProtocolUri);
  if (own) return own.cid;
  const fetched = await fetchAtRecord(newProtocolUri);
  return fetched?.cid ?? fallbackCid;
}

// Fetches the full set of a protocol's targets from the author's PDS, regardless
// of whether the author has migrated: reads both the new protocolTarget
// collection and the legacy surveyTarget collection, keyed by rkey (new wins).
// Returns each target's deterministic new protocolTarget uri + scope.
async function fetchProtocolTargets(
  newProtocolUri: string,
): Promise<{ rkey: string; newTargetUri: string; scope: unknown }[]> {
  const { did: authorDid, rkey: protocolRkey } = parseAtUri(newProtocolUri);
  const oldProtocolUri = `at://${authorDid}/${OLD_PROTOCOL_NSID}/${protocolRkey}`;

  const byRkey = new Map<string, { newTargetUri: string; scope: unknown }>();
  const add = (rec: AtRecord) => {
    const { rkey } = parseAtUri(rec.uri);
    byRkey.set(rkey, {
      newTargetUri: `at://${authorDid}/${NEW_PROTOCOL_TARGET_NSID}/${rkey}`,
      scope: (rec.value as Json).scope,
    });
  };

  for (const t of (await listAtRecords(authorDid, OLD_TARGET_NSID)) ?? []) {
    if ((t.value as Json).protocol === oldProtocolUri) add(t);
  }
  // New targets win over legacy for the same rkey.
  for (const t of (await listAtRecords(authorDid, NEW_PROTOCOL_TARGET_NSID)) ??
    []) {
    if ((t.value as Json).protocol === newProtocolUri) add(t);
  }

  return [...byRkey.entries()].map(([rkey, v]) => ({ rkey, ...v }));
}

// Migrates the user's own surveyProtocol records to bio.cuanto.surveyProtocol
// and indexes them in survey_protocols. Returns a map from new protocol URI to
// {uri, cid} used by subsequent steps to resolve CIDs without extra PDS calls,
// plus the old protocol URIs for post-migration DB cleanup.
async function migrateOwnProtocols(
  did: string,
): Promise<{ protocolMap: Map<string, StrongRef>; oldProtocolUris: string[] }> {
  const protocolMap = new Map<string, StrongRef>();
  const oldProtocolUris: string[] = [];
  for (const nsid of OLD_PROTOCOL_NSIDS) {
    for (const p of (await listAtRecords(did, nsid)) ?? []) {
      oldProtocolUris.push(p.uri);
      const { rkey } = parseAtUri(p.uri);
      const record = { ...(p.value as Json), $type: NEW_PROTOCOL_NSID };
      const res = await upsertPdsRecord(did, NEW_PROTOCOL_NSID, rkey, record);
      protocolMap.set(res.uri, res);
      await insertProtocol(did, rkey, record as never, res.uri, res.cid);
    }
  }
  return { protocolMap, oldProtocolUris };
}

// Migrates the user's own surveyTarget records to bio.cuanto.protocolTarget
// and indexes them in protocol_targets.
async function migrateOwnTargets(did: string): Promise<void> {
  for (const nsid of OLD_TARGET_NSIDS) {
    for (const t of (await listAtRecords(did, nsid)) ?? []) {
      const { rkey } = parseAtUri(t.uri);
      const value = t.value as Json;
      const scope = ((value.scope ?? []) as Json[]).map((s) => ({
        ...s,
        $type: migrateScopeType((s as { $type?: string }).$type ?? ''),
      }));
      const record = {
        ...value,
        $type: NEW_PROTOCOL_TARGET_NSID,
        protocol: migrateUri(value.protocol as string),
        scope,
      };
      const res = await upsertPdsRecord(
        did,
        NEW_PROTOCOL_TARGET_NSID,
        rkey,
        record,
      );
      await insertProtocolTarget(did, rkey, record as never, res.uri);
    }
  }
}

// Phase-1 migration: writes the user's own protocol and protocolTarget records
// to the bio.cuanto.* namespace and indexes them locally. Run this for all
// users before migrateUser so cross-author follow re-indexing finds the FK
// target in survey_protocols instead of deferring with a warning.
// Idempotent: already-migrated records are skipped via upsertPdsRecord.
export async function migrateUserProtocols(did: string): Promise<void> {
  log.info({ did }, 'phase 1: migrating own protocols and targets');
  await migrateOwnProtocols(did);
  await migrateOwnTargets(did);
  log.info({ did }, 'phase 1 complete');
}

// Migrates one user's records to the bio.cuanto.* namespace and the two-tier
// target model, in place against their PDS via the stored OAuth session.
// Idempotent and resumable: already-migrated records are skipped.
export async function migrateUser(did: string): Promise<void> {
  log.info({ did }, 'starting lexicon migration');

  const surveyMap = new Map<string, string>(); // old survey uri -> new survey uri
  const engagedProtocols = new Set<string>(); // new protocol uris this user uses

  // 1. Own protocols: surveyProtocol -> bio.cuanto.surveyProtocol.
  const { protocolMap, oldProtocolUris } = await migrateOwnProtocols(did);

  // 2. Own protocol targets: surveyTarget -> bio.cuanto.protocolTarget.
  await migrateOwnTargets(did);

  // 3. Surveys: survey -> bio.cuanto.survey (rewrite protocol strongRef).
  for (const nsid of OLD_SURVEY_NSIDS) {
    for (const s of (await listAtRecords(did, nsid)) ?? []) {
      const { rkey } = parseAtUri(s.uri);
      const value = s.value as Json;
      const oldProtocol = value.protocol as StrongRef;
      const newProtocolUri = migrateUri(oldProtocol.uri);
      engagedProtocols.add(newProtocolUri);
      const record = {
        ...value,
        $type: NEW_SURVEY_NSID,
        protocol: {
          uri: newProtocolUri,
          cid: await resolveProtocolCid(
            newProtocolUri,
            oldProtocol.cid,
            protocolMap,
          ),
        },
      };
      const res = await upsertPdsRecord(did, NEW_SURVEY_NSID, rkey, record);
      surveyMap.set(s.uri, res.uri);
      await insertSurvey(did, rkey, record as never, res.uri);
    }
  }

  // 4. Follows (in-place): rewrite subject to the protocol's new uri. The follow
  // keeps its at-uri while its subject (the indexed protocol_uri) moves, so the
  // index is updated keyed on at_uri, not inserted. Re-index unconditionally:
  // a prior partial run may have already rewritten the PDS subject yet left the
  // index row pointing at the old protocol_uri.
  for (const f of (await listAtRecords(did, FOLLOW_NSID)) ?? []) {
    const { rkey } = parseAtUri(f.uri);
    const value = f.value as Json;
    const newSubject = migrateUri(value.subject as string);
    engagedProtocols.add(newSubject);
    if (newSubject !== value.subject) {
      await putRecord(did, FOLLOW_NSID, rkey, {
        ...value,
        subject: newSubject,
      });
    }
    try {
      await reindexFollowSubject(f.uri, newSubject);
    } catch (err) {
      const pg = err as { code?: string; constraint_name?: string };
      if (pg.code === '23503') {
        // Cross-author: the followed protocol's new record isn't indexed yet
        // (its author hasn't migrated). Leave the index to reconcile once they do.
        log.warn(
          { uri: f.uri, subject: newSubject },
          'follow protocol not indexed yet; deferring follow re-index',
        );
      } else if (
        pg.code === '23505' &&
        pg.constraint_name === 'uq_follow_did_protocol'
      ) {
        // Duplicate follow: another follow for the same protocol is already
        // indexed correctly under a different at_uri. The PDS record is the
        // source of truth; skip re-indexing this duplicate.
        log.warn(
          { uri: f.uri, subject: newSubject },
          'follow protocol already indexed under another follow; skipping duplicate',
        );
      } else {
        throw err;
      }
    }
  }

  // 5. Materialize surveyTargets for every protocol the user engages with,
  // sourcing scope from the author's PDS (works cross-repo, pre- or post their
  // own migration).
  for (const protocolUri of engagedProtocols) {
    for (const tgt of await fetchProtocolTargets(protocolUri)) {
      const record = {
        $type: SURVEY_TARGET_NSID,
        protocol: protocolUri,
        protocolTargetID: tgt.newTargetUri,
        createdAt: new Date().toISOString(),
        scope: tgt.scope,
      };
      const res = await upsertPdsRecord(
        did,
        SURVEY_TARGET_NSID,
        tgt.rkey,
        record,
      );
      await insertSurveyTarget(
        did,
        tgt.rkey,
        record as never,
        res.uri,
        tgt.newTargetUri,
      );
    }
  }

  // 6. Occurrences (in-place), pass A: rewrite eventID + surveyTargetID + the
  // organismQuantityType value, and drop acceptedIdentificationID (re-added in
  // pass C so the occurrence<->identification strongRef cycle resolves the same
  // way it does at creation time).
  const occCid = new Map<string, string>(); // occurrence uri -> pass-A cid
  const occHadAcceptedId = new Map<string, StrongRef>();
  const occBaseRecord = new Map<string, Json>();
  for (const o of (await listAtRecords(did, OCCURRENCE_NSID)) ?? []) {
    const { rkey } = parseAtUri(o.uri);
    const value = o.value as Json;
    const record: Json = { ...value };
    if (typeof value.eventID === 'string') {
      record.eventID =
        surveyMap.get(value.eventID) ?? migrateUri(value.eventID);
    }
    if (typeof value.surveyTargetID === 'string') {
      record.surveyTargetID = surveyTargetUriFor(did, value.surveyTargetID);
    }
    if (value.organismQuantityType === 'individual-count') {
      record.organismQuantityType = 'individuals';
    }
    if (value.acceptedIdentificationID) {
      occHadAcceptedId.set(o.uri, value.acceptedIdentificationID as StrongRef);
      delete record.acceptedIdentificationID;
    }
    // In-place update (same NSID + uri): always write, never skip.
    const res = await putRecord(did, OCCURRENCE_NSID, rkey, record);
    occCid.set(o.uri, res.cid);
    occBaseRecord.set(o.uri, record);
    await insertOccurrence(did, rkey, record as never, o.uri);
  }

  // 7. Identifications (in-place): refresh the occurrence strongRef CID.
  const identCid = new Map<string, string>(); // identification uri -> new cid
  for (const i of (await listAtRecords(did, IDENTIFICATION_NSID)) ?? []) {
    const { rkey } = parseAtUri(i.uri);
    const value = i.value as Json;
    const occRef = value.occurrence as StrongRef | undefined;
    const record: Json = { ...value };
    if (occRef) {
      record.occurrence = {
        uri: occRef.uri,
        cid: occCid.get(occRef.uri) ?? occRef.cid,
      };
    }
    // In-place update (same NSID + uri): always write, never skip.
    const res = await putRecord(did, IDENTIFICATION_NSID, rkey, record);
    identCid.set(i.uri, res.cid);
    try {
      await insertIdentification(did, rkey, record as never, res.uri);
    } catch (err) {
      // Occurrences without an eventID are never written to the occurrences
      // table (insertOccurrence returns early), so their identifications can't
      // satisfy the FK. Skip indexing; the PDS record is still updated above.
      if ((err as { code?: string }).code === '23503') {
        log.warn(
          {
            uri: res.uri,
            occUri: (record.occurrence as StrongRef | undefined)?.uri,
          },
          'identification FK: occurrence has no eventID and is not indexed; skipping',
        );
      } else {
        throw err;
      }
    }
  }

  // 8. Occurrences pass C: re-add acceptedIdentificationID with the refreshed
  // identification CID.
  for (const [occUri, oldAccepted] of occHadAcceptedId) {
    const { rkey } = parseAtUri(occUri);
    const base = occBaseRecord.get(occUri);
    if (!base) continue;
    const record: Json = {
      ...base,
      acceptedIdentificationID: {
        uri: oldAccepted.uri,
        cid: identCid.get(oldAccepted.uri) ?? oldAccepted.cid,
      },
    };
    await putRecord(did, OCCURRENCE_NSID, rkey, record);
    await insertOccurrence(did, rkey, record as never, occUri);
  }

  // The old-NSID records (survey/surveyProtocol/surveyTarget) are intentionally
  // RETAINED on the PDS as a fallback. Their content now lives in the new
  // collections and the app no longer reads them, but deleting them is a separate,
  // explicit step (cleanupMigratedRecords) run only once the migration is verified.

  // 9. Remove stale old-namespace rows from Postgres. PDS records are left intact.

  // Update any occurrences whose PDS records were deleted before step 6 could
  // re-index them, leaving stale survey_uri values. Without this, deleting old
  // survey rows below would cascade-delete those occurrences, which fails
  // because identifications.occurrence_uri has no ON DELETE CASCADE.
  for (const [oldUri, newUri] of surveyMap) {
    await sql`UPDATE occurrences SET survey_uri = ${newUri} WHERE survey_uri = ${oldUri}`;
  }
  const oldSurveyUris = [...surveyMap.keys()];
  if (oldSurveyUris.length > 0) {
    await sql`DELETE FROM surveys WHERE at_uri = ANY(${oldSurveyUris})`;
  }

  // Old protocols: only delete when no surveys or follows still reference them.
  // Another user's unmigrated surveys/follows block the delete until they migrate,
  // at which point their own cleanup removes the row. Cascade deletes old
  // protocol_target rows for any protocol row that is removed.
  if (oldProtocolUris.length > 0) {
    await sql`
      DELETE FROM survey_protocols
      WHERE at_uri = ANY(${oldProtocolUris})
        AND NOT EXISTS (
          SELECT 1 FROM surveys WHERE protocol_uri = survey_protocols.at_uri
        )
        AND NOT EXISTS (
          SELECT 1 FROM protocol_follows WHERE protocol_uri = survey_protocols.at_uri
        )
    `;
  }

  // Clear the staleness flag.
  await sql`UPDATE users SET needs_lexicon_migration = false WHERE did = ${did}`;

  log.info({ did }, 'completed lexicon migration (old records retained)');
}

// Fixes scope item $type values in already-migrated bio.cuanto.protocolTarget
// records on the PDS and in the local index. Idempotent: records whose scope
// $types are already correct are skipped. Run as an explicit step via the
// fix-scope-types admin endpoint after deploying the corrected migration.
export async function fixProtocolTargetScopes(did: string): Promise<void> {
  log.info({ did }, 'fixing protocol target scope types');
  let fixed = 0;
  for (const t of (await listAtRecords(did, NEW_PROTOCOL_TARGET_NSID)) ?? []) {
    const value = t.value as Json;
    const scope = ((value.scope ?? []) as Json[]).map((s) => ({
      ...s,
      $type: migrateScopeType((s as { $type?: string }).$type ?? ''),
    }));
    const alreadyCorrect = scope.every(
      (s, i) =>
        s.$type === ((value.scope as Json[])[i] as { $type?: string }).$type,
    );
    if (alreadyCorrect) continue;
    const { rkey } = parseAtUri(t.uri);
    const record = { ...value, scope };
    await putRecord(did, NEW_PROTOCOL_TARGET_NSID, rkey, record);
    await insertProtocolTarget(did, rkey, record as never, t.uri);
    fixed++;
  }
  log.info({ did, fixed }, 'fixed protocol target scope types');
}

// Deletes the old-NSID records that have a confirmed migrated counterpart in the
// new collection. Run as an explicit step after the migration is verified, so
// the originals remain a fallback until then. Idempotent and safe: an old record
// is removed only once its bio.cuanto.* counterpart exists.
export async function cleanupMigratedRecords(did: string): Promise<void> {
  log.info({ did }, 'cleaning up migrated old records');
  for (const collection of [
    ...OLD_SURVEY_NSIDS,
    ...OLD_TARGET_NSIDS,
    ...OLD_PROTOCOL_NSIDS,
  ]) {
    for (const r of (await listAtRecords(did, collection)) ?? []) {
      const migrated = await fetchAtRecord(migrateUri(r.uri));
      if (!migrated) continue; // counterpart missing — keep the old record
      try {
        await deleteRecord(r.uri);
      } catch (err) {
        log.error({ err, uri: r.uri }, 'failed to delete old record');
      }
    }
  }
}
