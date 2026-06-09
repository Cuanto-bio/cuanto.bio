import { beforeEach, describe, expect, test, vi } from 'vitest';

// In-memory fake PDS. CIDs are content hashes so identical content yields the
// same CID (matches real content-addressed behavior and makes re-runs stable).
interface StoreRecord {
  uri: string;
  cid: string;
  value: Record<string, unknown>;
}
const store = new Map<string, StoreRecord>();

function cidFor(value: unknown): string {
  const s = JSON.stringify(value);
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return `cid${h >>> 0}`;
}

vi.mock('$lib/server/pds', () => ({
  listAtRecords: vi.fn(async (did: string, collection: string) =>
    [...store.values()].filter((r) =>
      r.uri.startsWith(`at://${did}/${collection}/`),
    ),
  ),
  fetchAtRecord: vi.fn(async (uri: string) => store.get(uri) ?? null),
  putRecord: vi.fn(
    async (
      did: string,
      collection: string,
      rkey: string,
      record: Record<string, unknown>,
    ) => {
      const uri = `at://${did}/${collection}/${rkey}`;
      const cid = cidFor(record);
      store.set(uri, { uri, cid, value: record });
      return { uri, cid };
    },
  ),
  deleteRecord: vi.fn(async (uri: string) => {
    store.delete(uri);
  }),
}));

vi.mock('$lib/server/db/survey-protocols', () => ({
  insertProtocol: vi.fn(),
  insertTarget: vi.fn(),
}));
vi.mock('$lib/server/db/surveys', () => ({
  insertSurvey: vi.fn(),
  insertOccurrence: vi.fn(),
}));
vi.mock('$lib/server/db/identifications', () => ({ insertIdentification }));
vi.mock('$lib/server/db/survey-targets', () => ({
  insertSurveyTarget: vi.fn(),
}));
const { reindexFollowSubject, insertIdentification } = vi.hoisted(() => ({
  reindexFollowSubject: vi.fn(),
  insertIdentification: vi.fn(),
}));
vi.mock('$lib/server/db/protocol-follows', () => ({ reindexFollowSubject }));
vi.mock('$lib/server/db', () => ({
  default: Object.assign(
    vi.fn(async () => []),
    {
      json: (v: unknown) => v,
      array: (v: unknown) => v,
    },
  ),
}));
vi.mock('$lib/server/logger', () => ({
  default: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import { cleanupMigratedRecords, migrateUser } from './migrate-lexicons';

const DID = 'did:plc:surveyor';
const oldProtocol = `at://${DID}/bio.lexicons.temp.v0-1.surveyProtocol/proto1`;
const oldTarget = `at://${DID}/bio.lexicons.temp.v0-1.surveyTarget/tgt1`;
const oldSurvey = `at://${DID}/bio.lexicons.temp.v0-1.survey/svy1`;
const occUri = `at://${DID}/bio.lexicons.temp.v0-1.occurrence/occ1`;
const identUri = `at://${DID}/bio.lexicons.temp.v0-1.identification/id1`;
const followUri = `at://${DID}/bio.cuanto.surveyProtocol.follow/flw1`;

const newProtocol = `at://${DID}/bio.cuanto.surveyProtocol/proto1`;
const newProtocolTarget = `at://${DID}/bio.cuanto.protocolTarget/tgt1`;
const newSurvey = `at://${DID}/bio.cuanto.survey/svy1`;
const surveyorTarget = `at://${DID}/bio.cuanto.surveyTarget/tgt1`;

function seed(uri: string, value: Record<string, unknown>) {
  store.set(uri, { uri, cid: cidFor(value), value });
}

beforeEach(() => {
  reindexFollowSubject.mockClear();
  insertIdentification.mockReset();
  store.clear();
  seed(oldProtocol, {
    $type: 'bio.lexicons.temp.v0-1.surveyProtocol',
    title: 'Oaks',
    description: 'd',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  seed(oldTarget, {
    $type: 'bio.lexicons.temp.v0-1.surveyTarget',
    protocol: oldProtocol,
    scope: [
      {
        $type: 'bio.lexicons.temp.v0-1.surveyTarget#taxonScope',
        scientificName: 'Quercus',
        taxonRank: 'genus',
      },
    ],
  });
  seed(oldSurvey, {
    $type: 'bio.lexicons.temp.v0-1.survey',
    protocol: { uri: oldProtocol, cid: 'oldprotocid' },
    createdAt: '2026-02-01T00:00:00.000Z',
    eventDate: '2026-02-01',
    location: { $type: 'org.atgeo.place', name: 'Park' },
  });
  seed(occUri, {
    $type: 'bio.lexicons.temp.v0-1.occurrence',
    eventID: oldSurvey,
    surveyTargetID: oldTarget,
    organismQuantity: '2',
    organismQuantityType: 'individual-count',
    acceptedIdentificationID: { uri: identUri, cid: 'oldidentcid' },
  });
  seed(identUri, {
    $type: 'bio.lexicons.temp.v0-1.identification',
    occurrence: { uri: occUri, cid: 'oldocccid' },
    scientificName: 'Quercus agrifolia',
    taxonRank: 'species',
  });
  seed(followUri, {
    $type: 'bio.cuanto.surveyProtocol.follow',
    subject: oldProtocol,
    createdAt: '2026-01-15T00:00:00.000Z',
  });
});

describe('migrateUser', () => {
  test('moves survey/protocol/target collections and materializes surveyTargets', async () => {
    await migrateUser(DID);

    expect(store.get(newProtocol)?.value.$type).toBe(
      'bio.cuanto.surveyProtocol',
    );
    expect(store.get(newProtocolTarget)?.value.protocol).toBe(newProtocol);
    expect(store.get(newSurvey)?.value.$type).toBe('bio.cuanto.survey');
    // survey.protocol strongRef rewritten to the migrated protocol
    const survey = store.get(newSurvey)?.value as {
      protocol: { uri: string; cid: string };
    };
    expect(survey.protocol.uri).toBe(newProtocol);
    expect(survey.protocol.cid).toBe(store.get(newProtocol)?.cid);

    // surveyor's own surveyTarget materialized, pointing back at the protocolTarget
    const st = store.get(surveyorTarget)?.value as {
      protocol: string;
      protocolTargetID: string;
    };
    expect(st.protocol).toBe(newProtocol);
    expect(st.protocolTargetID).toBe(newProtocolTarget);

    // old moved records are RETAINED as a fallback (deletion is a separate step)
    expect(store.has(oldProtocol)).toBe(true);
    expect(store.has(oldTarget)).toBe(true);
    expect(store.has(oldSurvey)).toBe(true);
  });

  test('cleanupMigratedRecords deletes old records only after migration', async () => {
    // Before migration: cleanup is a no-op (no migrated counterparts yet).
    await cleanupMigratedRecords(DID);
    expect(store.has(oldProtocol)).toBe(true);
    expect(store.has(oldSurvey)).toBe(true);

    await migrateUser(DID);
    // Still present right after migration.
    expect(store.has(oldProtocol)).toBe(true);

    await cleanupMigratedRecords(DID);
    expect(store.has(oldProtocol)).toBe(false);
    expect(store.has(oldTarget)).toBe(false);
    expect(store.has(oldSurvey)).toBe(false);
    // migrated records remain
    expect(store.has(newProtocol)).toBe(true);
    expect(store.has(newSurvey)).toBe(true);
  });

  test('updates occurrence in place with rewritten refs and synced quantity type', async () => {
    await migrateUser(DID);

    const occ = store.get(occUri)?.value as {
      eventID: string;
      surveyTargetID: string;
      organismQuantityType: string;
      acceptedIdentificationID: { uri: string; cid: string };
    };
    expect(store.has(occUri)).toBe(true); // same uri, in place
    expect(occ.eventID).toBe(newSurvey);
    expect(occ.surveyTargetID).toBe(surveyorTarget);
    expect(occ.organismQuantityType).toBe('individuals');
    // acceptedIdentificationID cid refreshed to the migrated identification
    expect(occ.acceptedIdentificationID.uri).toBe(identUri);
    expect(occ.acceptedIdentificationID.cid).toBe(store.get(identUri)?.cid);
    expect(occ.acceptedIdentificationID.cid).not.toBe('oldidentcid');
  });

  test('refreshes identification occurrence strongRef', async () => {
    await migrateUser(DID);
    const ident = store.get(identUri)?.value as {
      occurrence: { uri: string; cid: string };
    };
    expect(ident.occurrence.uri).toBe(occUri);
    expect(ident.occurrence.cid).not.toBe('oldocccid');
  });

  test('rewrites follow subject in place and re-indexes by at-uri', async () => {
    await migrateUser(DID);
    expect(store.get(followUri)?.value.subject).toBe(newProtocol);
    // The follow keeps its at-uri but its subject (protocol_uri) changes, so the
    // index must be updated keyed on at_uri, not inserted (the row already
    // exists with the old protocol_uri).
    expect(reindexFollowSubject).toHaveBeenCalledWith(followUri, newProtocol);
  });

  test('skips re-indexing a follow whose protocol is already indexed under another follow', async () => {
    // If the user has duplicate follow records in their PDS (different at_uri,
    // same protocol), one of them may already be indexed correctly. When the
    // second one is processed, reindexFollowSubject throws 23505 on
    // uq_follow_did_protocol. The migration must not abort.
    const dupErr = Object.assign(new Error('unique'), {
      code: '23505',
      constraint_name: 'uq_follow_did_protocol',
    });
    reindexFollowSubject.mockRejectedValueOnce(dupErr);

    await migrateUser(DID);

    // The PDS follow record is still updated.
    expect(store.get(followUri)?.value.subject).toBe(newProtocol);
  });

  test('re-indexes the follow even when the PDS subject was already migrated', async () => {
    // Simulate a prior partial run: the PDS follow record's subject is already
    // the new protocol uri, but the index row may still point at the old one.
    // The migration must still correct the index, otherwise the follow stays
    // permanently linked to a protocol uri the app no longer reads.
    seed(followUri, {
      $type: 'bio.cuanto.surveyProtocol.follow',
      subject: newProtocol,
      createdAt: '2026-01-15T00:00:00.000Z',
    });

    await migrateUser(DID);

    expect(reindexFollowSubject).toHaveBeenCalledWith(followUri, newProtocol);
  });

  test('skips indexing identifications for occurrences not in the occurrences table', async () => {
    // Incidental occurrences (no eventID) are never written to the occurrences
    // table by insertOccurrence (early return on missing surveyUri). A
    // corresponding identification must still have its PDS record refreshed, but
    // insertIdentification will throw a FK violation; the migration must not abort.
    const incidentalOcc = `at://${DID}/bio.lexicons.temp.v0-1.occurrence/incid1`;
    const incidentalIdent = `at://${DID}/bio.lexicons.temp.v0-1.identification/iid1`;
    seed(incidentalOcc, {
      $type: 'bio.lexicons.temp.v0-1.occurrence',
      eventDate: '2026-03-01',
      decimalLatitude: '37.7',
      decimalLongitude: '-122.4',
      // No eventID — incidental observation, not part of any survey.
    });
    seed(incidentalIdent, {
      $type: 'bio.lexicons.temp.v0-1.identification',
      occurrence: { uri: incidentalOcc, cid: 'old-occ-cid' },
      scientificName: 'Quercus agrifolia',
      taxonRank: 'species',
    });

    const fkErr = Object.assign(new Error('FK'), { code: '23503' });
    insertIdentification.mockRejectedValueOnce(fkErr);

    await migrateUser(DID);

    // PDS record was still updated (occurrence strongRef CID refreshed).
    expect(store.has(incidentalIdent)).toBe(true);
  });

  test('is idempotent: a second run leaves the repo unchanged', async () => {
    await migrateUser(DID);
    const snapshot = new Map([...store.entries()].map(([k, v]) => [k, v.cid]));
    await migrateUser(DID);
    const after = new Map([...store.entries()].map(([k, v]) => [k, v.cid]));
    expect(after).toEqual(snapshot);
  });
});

describe('migrateUser — cross-author (author not yet migrated)', () => {
  const AUTHOR = 'did:plc:author';
  const authorOldProtocol = `at://${AUTHOR}/bio.lexicons.temp.v0-1.surveyProtocol/p9`;
  const authorOldTarget = `at://${AUTHOR}/bio.lexicons.temp.v0-1.surveyTarget/t9`;
  const authorNewProtocol = `at://${AUTHOR}/bio.cuanto.surveyProtocol/p9`;
  const authorNewTarget = `at://${AUTHOR}/bio.cuanto.protocolTarget/t9`;
  const xSurvey = `at://${DID}/bio.lexicons.temp.v0-1.survey/xs1`;
  const xOcc = `at://${DID}/bio.lexicons.temp.v0-1.occurrence/xo1`;
  const xFollow = `at://${DID}/bio.cuanto.surveyProtocol.follow/xf1`;

  beforeEach(() => {
    store.clear();
    // Another author's records, still on the old NSIDs (not migrated).
    seed(authorOldProtocol, {
      $type: 'bio.lexicons.temp.v0-1.surveyProtocol',
      title: 'Theirs',
      description: 'd',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    seed(authorOldTarget, {
      $type: 'bio.lexicons.temp.v0-1.surveyTarget',
      protocol: authorOldProtocol,
      scope: [
        {
          $type: 'bio.lexicons.temp.v0-1.surveyTarget#taxonScope',
          scientificName: 'Pinus',
          taxonRank: 'genus',
        },
      ],
    });
    // The surveyor's records referencing the other author's protocol.
    seed(xSurvey, {
      $type: 'bio.lexicons.temp.v0-1.survey',
      protocol: { uri: authorOldProtocol, cid: 'authoroldcid' },
      createdAt: '2026-02-01T00:00:00.000Z',
      eventDate: '2026-02-01',
      location: { $type: 'org.atgeo.place', name: 'Park' },
    });
    seed(xOcc, {
      $type: 'bio.lexicons.temp.v0-1.occurrence',
      eventID: xSurvey,
      surveyTargetID: authorOldTarget,
      organismQuantity: '1',
      organismQuantityType: 'individual-count',
    });
    seed(xFollow, {
      $type: 'bio.cuanto.surveyProtocol.follow',
      subject: authorOldProtocol,
      createdAt: '2026-01-15T00:00:00.000Z',
    });
  });

  test('materializes surveyTargets from the author PDS and best-efforts the protocol CID', async () => {
    await migrateUser(DID);

    // survey points at the author's deterministic new protocol uri; cid falls
    // back to the old one since the author has not migrated.
    const survey = store.get(`at://${DID}/bio.cuanto.survey/xs1`)?.value as {
      protocol: { uri: string; cid: string };
    };
    expect(survey.protocol.uri).toBe(authorNewProtocol);
    expect(survey.protocol.cid).toBe('authoroldcid');

    // surveyor's surveyTarget is materialized in their own repo from the
    // author's (unmigrated) target, with provenance to the author's new target.
    const st = store.get(`at://${DID}/bio.cuanto.surveyTarget/t9`)?.value as {
      protocol: string;
      protocolTargetID: string;
      scope: { scientificName: string }[];
    };
    expect(st.protocol).toBe(authorNewProtocol);
    expect(st.protocolTargetID).toBe(authorNewTarget);
    expect(st.scope[0].scientificName).toBe('Pinus');

    // occurrence repointed to the surveyor's own surveyTarget
    const occ = store.get(xOcc)?.value as { surveyTargetID: string };
    expect(occ.surveyTargetID).toBe(`at://${DID}/bio.cuanto.surveyTarget/t9`);

    // the author's records are untouched (we can't write their repo)
    expect(store.has(authorOldProtocol)).toBe(true);
    expect(store.has(authorOldTarget)).toBe(true);
  });
});
