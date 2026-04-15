import { test as base } from '@playwright/test';
import postgres, { type Sql } from 'postgres';

export { expect } from '@playwright/test';

const TEST_DB_URL = 'postgresql://cuanto:cuanto@localhost:5432/cuanto_test';

const FAKE_CID = 'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34';

export async function seedProtocol(
  sql: Sql,
  did: string,
): Promise<{ protocolRkey: string }> {
  const handle = `user-${did.split(':').pop()}`;
  await sql`
    INSERT INTO users (did, handle) VALUES (${did}, ${handle})
    ON CONFLICT (did) DO NOTHING
  `;

  const rkey = `testproto${Date.now()}`;
  const atUri = `at://${did}/bio.lexicons.temp.surveyProtocol/${rkey}`;

  await sql`
    INSERT INTO survey_protocols
      (at_uri, did, rkey, title, description, required_fields, created_at, cid)
    VALUES (
      ${atUri}, ${did}, ${rkey},
      'Test Protocol', 'A protocol for integration tests',
      ${sql.array([])}, ${new Date().toISOString()}, ${FAKE_CID}
    )
  `;

  const targets = [
    {
      rkey: `testtarget1${Date.now()}`,
      scope: [
        {
          $type: 'bio.lexicons.temp.surveyTarget#taxonScope',
          scientificName: 'Quercus agrifolia',
          taxonID: 'https://www.gbif.org/species/2878688',
        },
      ],
    },
    {
      rkey: `testtarget2${Date.now()}`,
      scope: [
        {
          $type: 'bio.lexicons.temp.surveyTarget#verbatimScope',
          verbatimTargetScope: 'All birds',
        },
      ],
    },
  ];

  for (const t of targets) {
    const targetUri = `at://${did}/bio.lexicons.temp.surveyTarget/${t.rkey}`;
    await sql`
      INSERT INTO survey_targets (at_uri, did, rkey, protocol_uri, scope)
      VALUES (${targetUri}, ${did}, ${t.rkey}, ${atUri}, ${sql.json(t.scope)})
    `;
  }

  return { protocolRkey: rkey };
}

export async function teardownDid(sql: Sql, did: string): Promise<void> {
  await sql`DELETE FROM occurrences WHERE did = ${did}`;
  await sql`DELETE FROM surveys WHERE did = ${did}`;
  await sql`DELETE FROM survey_targets WHERE did = ${did}`;
  await sql`DELETE FROM survey_protocols WHERE did = ${did}`;
  await sql`DELETE FROM users WHERE did = ${did}`;
}

type TestFixtures = {
  sql: Sql;
  protocolRkey: string;
};

export const test = base.extend<TestFixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires destructuring here
  sql: async ({}, use) => {
    const connection = postgres(TEST_DB_URL, { max: 1 });
    await use(connection);
    await connection.end();
  },

  protocolRkey: async ({ sql, context }, use) => {
    const did = 'did:test:survey-spec';

    await context.addCookies([
      {
        name: 'did',
        value: did,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);

    const { protocolRkey } = await seedProtocol(sql, did);
    await use(protocolRkey);
    await teardownDid(sql, did);
  },
});
