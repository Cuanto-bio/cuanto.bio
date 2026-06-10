import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { extract } from 'tar-stream';
import {
  expect,
  seedProtocol,
  seedSurvey,
  seedSurveyTarget,
  teardownDid,
  test,
} from './fixtures.js';

const EXPORT_DID = 'did:test:export-spec';
const EXPORT_HANDLE = 'user-export-spec';

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

    // Seed a minimal protocol (no protocol_targets needed; we seed survey_targets
    // directly to control created_at).
    const protocolRkey = `testproto${Date.now()}`;
    const protocolUri = `at://${EXPORT_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
    await sql`
      INSERT INTO users (did, handle)
      VALUES (${EXPORT_DID}, ${EXPORT_HANDLE})
      ON CONFLICT (did) DO NOTHING
    `;
    const protocolRecord = sql.json({
      $type: 'bio.cuanto.surveyProtocol',
      title: 'T',
      description: 'D',
      createdAt: new Date().toISOString(),
    });
    await sql`
      INSERT INTO survey_protocols (at_uri, did, rkey, cid, record, indexed_at)
      VALUES (
        ${protocolUri}, ${EXPORT_DID}, ${protocolRkey},
        'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34',
        ${protocolRecord},
        now()
      )
    `;

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

    const protocolRkey = `testproto${Date.now()}`;
    const protocolUri = `at://${EXPORT_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
    await sql`
      INSERT INTO users (did, handle)
      VALUES (${EXPORT_DID}, ${EXPORT_HANDLE})
      ON CONFLICT (did) DO NOTHING
    `;
    const protocolRecord2 = sql.json({
      $type: 'bio.cuanto.surveyProtocol',
      title: 'T',
      description: 'D',
      createdAt: new Date().toISOString(),
    });
    await sql`
      INSERT INTO survey_protocols (at_uri, did, rkey, cid, record, indexed_at)
      VALUES (
        ${protocolUri}, ${EXPORT_DID}, ${protocolRkey},
        'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34',
        ${protocolRecord2},
        now()
      )
    `;

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
});
