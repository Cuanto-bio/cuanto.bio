import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { extract } from 'tar-stream';
import {
  expect,
  seedOccurrence,
  seedProtocol,
  seedSurvey,
  seedSurveyTarget,
  teardownDid,
  test,
} from './fixtures.js';

const EXPORT_DID = 'did:test:export-spec';
const EXPORT_HANDLE = 'user-export-spec';
// Matches the value playwright.config.ts hands the dev server.
const TAP_PASSWORD = 'devpassword';

function authCookie(did: string) {
  return {
    name: 'did',
    value: did,
    domain: '127.0.0.1',
    path: '/',
    httpOnly: true,
    sameSite: 'Lax' as const,
  };
}

// Decompresses a gzip tar buffer and returns a map of filename -> content.
async function extractTarGz(buffer: Buffer): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const ex = extract();
  return new Promise((resolve, reject) => {
    ex.on('entry', (header, stream, next) => {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        files.set(header.name, Buffer.concat(chunks).toString('utf8'));
        next();
      });
      stream.resume();
    });
    ex.on('finish', () => resolve(files));
    ex.on('error', reject);
    Readable.from(buffer).pipe(createGunzip()).pipe(ex);
  });
}

// Returns rows (as field arrays) from a CSV string, skipping the header line.
function csvRows(csv: string): string[][] {
  return csv
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => line.split(','));
}

// Posts a tap firehose record event to the webhook. This is the production path
// by which a PDS-side record write or deletion reaches our index, so tests that
// care about deletion semantics have to go through it rather than issuing their
// own DELETE.
function postTapEvent(
  request: APIRequestContext,
  record: Record<string, unknown>,
): Promise<APIResponse> {
  return request.post('/api/tap/webhook', {
    headers: {
      Authorization: `Basic ${Buffer.from(`admin:${TAP_PASSWORD}`).toString('base64')}`,
    },
    data: { id: 1, type: 'record', record },
  });
}

function surveyTargetEvent(
  did: string,
  rkey: string,
  action: 'create' | 'delete',
  rev: string,
  record?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    did,
    rev,
    collection: 'bio.cuanto.surveyTarget',
    rkey,
    action,
    live: true,
    ...(record ? { record } : {}),
  };
}

test.describe('DwC-DP export endpoint', () => {
  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, EXPORT_DID);
  });

  test('returns 401 for unauthenticated requests', async ({ request, sql }) => {
    const { protocolRkey } = await seedProtocol(sql, EXPORT_DID);
    const response = await request.get(
      `/api/protocols/${EXPORT_HANDLE}/${protocolRkey}/export`,
    );
    expect(response.status()).toBe(401);
  });

  test('returns 404 for unknown protocol', async ({ context }) => {
    await context.addCookies([authCookie(EXPORT_DID)]);
    const response = await context.request.get(
      '/api/protocols/nonexistent-handle/nonexistent-rkey/export',
    );
    expect(response.status()).toBe(404);
  });

  test('returns gzip archive with correct headers', async ({
    context,
    sql,
  }) => {
    await context.addCookies([authCookie(EXPORT_DID)]);
    const { protocolRkey } = await seedProtocol(sql, EXPORT_DID);
    const response = await context.request.get(
      `/api/protocols/${EXPORT_HANDLE}/${protocolRkey}/export`,
    );
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('application/gzip');
    expect(response.headers()['content-disposition']).toContain('attachment');
    expect(response.headers()['content-disposition']).toContain(
      `${EXPORT_HANDLE}-${protocolRkey}-dwcdp.tar.gz`,
    );
  });

  test('notDetected: only emitted for targets that existed at survey time', async ({
    context,
    sql,
  }) => {
    await context.addCookies([authCookie(EXPORT_DID)]);

    // survey_targets are seeded directly below to control created_at; the
    // protocol_targets seedProtocol creates are unused by this test.
    const { protocolRkey } = await seedProtocol(sql, EXPORT_DID);
    const protocolUri = `at://${EXPORT_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;

    const surveyTime = new Date('2026-01-15T12:00:00Z');
    const beforeSurvey = new Date('2026-01-10T00:00:00Z');
    const afterSurvey = new Date('2026-01-20T00:00:00Z');

    const ptUriA = `at://${EXPORT_DID}/bio.cuanto.protocolTarget/targetrkeya`;
    const ptUriB = `at://${EXPORT_DID}/bio.cuanto.protocolTarget/targetrkeyb`;

    // Target A: existed before the survey — should appear as notDetected.
    await seedSurveyTarget(sql, EXPORT_DID, protocolUri, ptUriA, beforeSurvey);
    // Target B: added after the survey — must NOT appear as notDetected.
    await seedSurveyTarget(sql, EXPORT_DID, protocolUri, ptUriB, afterSurvey);

    // Survey conducted at surveyTime, no occurrences.
    await seedSurvey(
      sql,
      EXPORT_DID,
      protocolUri,
      'Test Location',
      surveyTime.toISOString(),
    );

    const response = await context.request.get(
      `/api/protocols/${EXPORT_HANDLE}/${protocolRkey}/export`,
    );
    expect(response.status()).toBe(200);

    const buf = Buffer.from(await response.body());
    const files = await extractTarGz(buf);

    expect(files.has('occurrence.csv')).toBe(true);
    const rows = csvRows(files.get('occurrence.csv')!);

    const notDetectedRows = rows.filter((fields) =>
      fields.some((f) => f === 'notDetected'),
    );

    // Exactly one notDetected row: target A only.
    expect(notDetectedRows).toHaveLength(1);
    // The notDetected row's occurrenceID encodes the survey_target URI for A.
    expect(notDetectedRows[0].join(',')).toContain('targetrkeya');
  });

  test('notDetected: emitted for targets with null created_at (unknown birth time)', async ({
    context,
    sql,
  }) => {
    await context.addCookies([authCookie(EXPORT_DID)]);

    const { protocolRkey } = await seedProtocol(sql, EXPORT_DID);
    const protocolUri = `at://${EXPORT_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;

    const ptUriC = `at://${EXPORT_DID}/bio.cuanto.protocolTarget/targetrkeyc`;
    // Null created_at = unknown birth time; must not be suppressed.
    await seedSurveyTarget(sql, EXPORT_DID, protocolUri, ptUriC, null);

    await seedSurvey(sql, EXPORT_DID, protocolUri);

    const response = await context.request.get(
      `/api/protocols/${EXPORT_HANDLE}/${protocolRkey}/export`,
    );
    expect(response.status()).toBe(200);

    const buf = Buffer.from(await response.body());
    const files = await extractTarGz(buf);

    const rows = csvRows(files.get('occurrence.csv')!);
    const notDetectedRows = rows.filter((fields) =>
      fields.some((f) => f === 'notDetected'),
    );
    expect(notDetectedRows).toHaveLength(1);
    expect(notDetectedRows[0].join(',')).toContain('targetrkeyc');
  });

  test('notDetected: only emitted for targets not yet retired at survey time', async ({
    context,
    sql,
  }) => {
    await context.addCookies([authCookie(EXPORT_DID)]);

    const { protocolRkey } = await seedProtocol(sql, EXPORT_DID);
    const protocolUri = `at://${EXPORT_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;

    const beforeRetirement = new Date('2026-01-10T00:00:00Z');
    const retiredAt = new Date('2026-01-15T00:00:00Z');
    const afterRetirement = new Date('2026-01-20T00:00:00Z');

    const ptUriD = `at://${EXPORT_DID}/bio.cuanto.protocolTarget/targetrkeyd`;
    const ptUriE = `at://${EXPORT_DID}/bio.cuanto.protocolTarget/targetrkeye`;

    // Target D: retired. A survey before the retirement should still see it as
    // notDetected; a survey after should not.
    await seedSurveyTarget(
      sql,
      EXPORT_DID,
      protocolUri,
      ptUriD,
      beforeRetirement,
      retiredAt,
    );
    // Target E: never retired, a control that should always be notDetected.
    await seedSurveyTarget(
      sql,
      EXPORT_DID,
      protocolUri,
      ptUriE,
      beforeRetirement,
    );

    await seedSurvey(
      sql,
      EXPORT_DID,
      protocolUri,
      'Test Location',
      beforeRetirement.toISOString(),
    );
    await seedSurvey(
      sql,
      EXPORT_DID,
      protocolUri,
      'Test Location',
      afterRetirement.toISOString(),
    );

    const response = await context.request.get(
      `/api/protocols/${EXPORT_HANDLE}/${protocolRkey}/export`,
    );
    expect(response.status()).toBe(200);

    const buf = Buffer.from(await response.body());
    const files = await extractTarGz(buf);

    const rows = csvRows(files.get('occurrence.csv')!);
    const notDetectedRows = rows.filter((fields) =>
      fields.some((f) => f === 'notDetected'),
    );

    // Target D: notDetected only for the survey before retirement.
    const targetDRows = notDetectedRows.filter((fields) =>
      fields.some((f) => f.includes('targetrkeyd')),
    );
    expect(targetDRows).toHaveLength(1);

    // Target E: notDetected for both surveys (never retired).
    const targetERows = notDetectedRows.filter((fields) =>
      fields.some((f) => f.includes('targetrkeye')),
    );
    expect(targetERows).toHaveLength(2);
  });

  // Issue #41: nothing stops a surveyTarget record from being deleted directly
  // on the surveyor's PDS by any AT Protocol client. The recorded detection is
  // still in the occurrences table and must still reach the export.
  test('detection survives deletion of its surveyTarget record', async ({
    context,
    sql,
  }) => {
    await context.addCookies([authCookie(EXPORT_DID)]);

    const { protocolRkey } = await seedProtocol(sql, EXPORT_DID);
    const protocolUri = `at://${EXPORT_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
    const ptUriF = `at://${EXPORT_DID}/bio.cuanto.protocolTarget/targetrkeyf`;

    const { surveyAtUri } = await seedSurvey(sql, EXPORT_DID, protocolUri);
    const { occUri } = await seedOccurrence(
      sql,
      EXPORT_DID,
      surveyAtUri,
      protocolUri,
      ptUriF,
      '7',
    );

    const deleteResponse = await postTapEvent(
      context.request,
      surveyTargetEvent(EXPORT_DID, 'targetrkeyf', 'delete', 'aaaa2'),
    );
    expect(deleteResponse.status()).toBe(200);

    const response = await context.request.get(
      `/api/protocols/${EXPORT_HANDLE}/${protocolRkey}/export`,
    );
    expect(response.status()).toBe(200);

    const buf = Buffer.from(await response.body());
    const files = await extractTarGz(buf);
    const rows = csvRows(files.get('occurrence.csv')!);

    // occurrenceID (field 0) is the occurrence's at-uri for detections. Assert on
    // the specific occurrence rather than a count: the bug is an omission.
    const detection = rows.find((fields) => fields[0] === occUri);
    expect(detection).toBeDefined();
    expect(detection!).toContain('detected');
    // The quantity is the data that silently disappears with the row.
    expect(detection!).toContain('7');
  });

  // Issue #41, decision 2: a deleted surveyTarget does not retroactively unmake
  // the surveys conducted while it was live, so their notDetected rows stand.
  test('notDetected survives deletion of the surveyTarget record', async ({
    context,
    sql,
  }) => {
    await context.addCookies([authCookie(EXPORT_DID)]);

    const { protocolRkey } = await seedProtocol(sql, EXPORT_DID);
    const protocolUri = `at://${EXPORT_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
    const ptUriG = `at://${EXPORT_DID}/bio.cuanto.protocolTarget/targetrkeyg`;

    const adoptedAt = new Date('2026-01-10T00:00:00Z');
    const surveyTime = new Date('2026-01-15T12:00:00Z');

    await seedSurveyTarget(sql, EXPORT_DID, protocolUri, ptUriG, adoptedAt);
    await seedSurvey(
      sql,
      EXPORT_DID,
      protocolUri,
      'Test Location',
      surveyTime.toISOString(),
    );

    const deleteResponse = await postTapEvent(
      context.request,
      surveyTargetEvent(EXPORT_DID, 'targetrkeyg', 'delete', 'aaaa2'),
    );
    expect(deleteResponse.status()).toBe(200);

    const response = await context.request.get(
      `/api/protocols/${EXPORT_HANDLE}/${protocolRkey}/export`,
    );
    expect(response.status()).toBe(200);

    const buf = Buffer.from(await response.body());
    const files = await extractTarGz(buf);
    const rows = csvRows(files.get('occurrence.csv')!);

    const notDetectedRows = rows.filter((fields) =>
      fields.some((f) => f === 'notDetected'),
    );
    const targetGRows = notDetectedRows.filter((fields) =>
      fields.some((f) => f.includes('targetrkeyg')),
    );
    expect(targetGRows).toHaveLength(1);
  });

  // Issue #41: once the row survives a delete, event ordering starts to matter.
  // A replayed delete carrying an older rev than the row's must not tombstone a
  // record a newer create already revived.
  test('a stale delete event does not tombstone a newer surveyTarget', async ({
    context,
    sql,
  }) => {
    const { protocolRkey } = await seedProtocol(sql, EXPORT_DID);
    const protocolUri = `at://${EXPORT_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
    const ptUriH = `at://${EXPORT_DID}/bio.cuanto.protocolTarget/targetrkeyh`;
    const targetUri = `at://${EXPORT_DID}/bio.cuanto.surveyTarget/targetrkeyh`;

    const createResponse = await postTapEvent(
      context.request,
      surveyTargetEvent(EXPORT_DID, 'targetrkeyh', 'create', 'aaaa2', {
        $type: 'bio.cuanto.surveyTarget',
        protocol: protocolUri,
        protocolTargetID: ptUriH,
        createdAt: '2026-01-10T00:00:00.000Z',
        scope: [],
      }),
    );
    expect(createResponse.status()).toBe(200);

    const staleResponse = await postTapEvent(
      context.request,
      surveyTargetEvent(EXPORT_DID, 'targetrkeyh', 'delete', 'aaaa1'),
    );
    expect(staleResponse.status()).toBe(200);

    const [row] = await sql`
      SELECT deleted_at FROM survey_targets WHERE at_uri = ${targetUri}
    `;
    expect(row).toBeDefined();
    expect(row.deleted_at).toBeNull();
  });

  // gcSurveyTargetsIfUnused hard-deletes the row and the PDS record together, so
  // its own delete events arrive after the row is already gone. Tombstoning must
  // stay an update of an existing row, never an insert that resurrects one.
  test('a delete event for an unknown surveyTarget creates no row', async ({
    context,
    sql,
  }) => {
    const targetUri = `at://${EXPORT_DID}/bio.cuanto.surveyTarget/targetrkeyi`;

    const response = await postTapEvent(
      context.request,
      surveyTargetEvent(EXPORT_DID, 'targetrkeyi', 'delete', 'aaaa2'),
    );
    expect(response.status()).toBe(200);

    const rows = await sql`
      SELECT at_uri FROM survey_targets WHERE at_uri = ${targetUri}
    `;
    expect(rows).toHaveLength(0);
  });
});
