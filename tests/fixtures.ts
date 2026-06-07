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
  const atUri = `at://${did}/bio.cuanto.surveyProtocol/${rkey}`;

  const protocolRecord = {
    $type: 'bio.cuanto.surveyProtocol',
    title: 'Test Protocol',
    description: 'A protocol for integration tests',
    createdAt: new Date().toISOString(),
    requiredFields: [],
  };

  await sql`
    INSERT INTO survey_protocols (at_uri, did, rkey, cid, record, indexed_at)
    VALUES (${atUri}, ${did}, ${rkey}, ${FAKE_CID}, ${sql.json(protocolRecord)}, now())
  `;

  const targets = [
    {
      rkey: `testtarget1${Date.now()}`,
      scope: [
        {
          $type: 'bio.cuanto.protocolTarget#taxonScope',
          scientificName: 'Quercus agrifolia',
          taxonRank: 'species',
          taxonID: 'https://www.gbif.org/species/2878688',
          vernacularName: 'Coast live oak',
        },
      ],
    },
    {
      rkey: `testtarget2${Date.now()}`,
      scope: [
        {
          $type: 'bio.cuanto.protocolTarget#verbatimScope',
          verbatimTargetScope: 'All birds',
        },
      ],
    },
  ];

  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const targetUri = `at://${did}/bio.cuanto.protocolTarget/${t.rkey}`;
    const indexedAt = new Date(Date.now() + i * 1000).toISOString();
    const targetRecord = {
      $type: 'bio.cuanto.protocolTarget',
      protocol: atUri,
      scope: t.scope,
    };
    await sql`
      INSERT INTO protocol_targets (at_uri, did, rkey, protocol_uri, record, indexed_at)
      VALUES (${targetUri}, ${did}, ${t.rkey}, ${atUri}, ${sql.json(targetRecord)}, ${indexedAt})
    `;
  }

  return { protocolRkey: rkey };
}

export async function seedProtocolWithLocationOptions(
  sql: Sql,
  did: string,
): Promise<{ protocolRkey: string }> {
  const handle = `user-${did.split(':').pop()}`;
  await sql`
    INSERT INTO users (did, handle) VALUES (${did}, ${handle})
    ON CONFLICT (did) DO NOTHING
  `;

  const rkey = `testproto${Date.now()}`;
  const atUri = `at://${did}/bio.cuanto.surveyProtocol/${rkey}`;

  const protocolRecord = {
    $type: 'bio.cuanto.surveyProtocol',
    title: 'Location Options Protocol',
    description: 'A protocol with controlled location options',
    createdAt: new Date().toISOString(),
    requiredFields: [],
    locationOptions: [
      {
        $type: 'org.atgeo.place',
        name: 'China Camp',
        locations: [
          {
            $type: 'community.lexicon.location.geo',
            latitude: '38.004',
            longitude: '-122.4978',
          },
        ],
      },
      {
        $type: 'org.atgeo.place',
        name: 'Mission Creek',
      },
    ],
  };

  await sql`
    INSERT INTO survey_protocols (at_uri, did, rkey, cid, record, indexed_at)
    VALUES (${atUri}, ${did}, ${rkey}, ${FAKE_CID}, ${sql.json(protocolRecord)}, now())
  `;

  return { protocolRkey: rkey };
}

export async function seedProtocolWithManyLocationOptions(
  sql: Sql,
  did: string,
): Promise<{ protocolRkey: string }> {
  const handle = `user-${did.split(':').pop()}`;
  await sql`
    INSERT INTO users (did, handle) VALUES (${did}, ${handle})
    ON CONFLICT (did) DO NOTHING
  `;

  const rkey = `testproto${Date.now()}`;
  const atUri = `at://${did}/bio.cuanto.surveyProtocol/${rkey}`;

  const locationOptions = [
    {
      $type: 'org.atgeo.place',
      name: 'China Camp',
      locations: [
        {
          $type: 'community.lexicon.location.geo',
          latitude: '38.004',
          longitude: '-122.4978',
        },
      ],
    },
    { $type: 'org.atgeo.place', name: 'Mission Creek' },
    { $type: 'org.atgeo.place', name: 'Coyote Hills' },
    { $type: 'org.atgeo.place', name: 'Point Reyes' },
    { $type: 'org.atgeo.place', name: 'Muir Woods' },
    { $type: 'org.atgeo.place', name: 'Año Nuevo' },
  ];

  const protocolRecord = {
    $type: 'bio.cuanto.surveyProtocol',
    title: 'Many Locations Protocol',
    description: 'A protocol with 6+ location options (triggers combobox)',
    createdAt: new Date().toISOString(),
    requiredFields: [],
    locationOptions,
  };

  await sql`
    INSERT INTO survey_protocols (at_uri, did, rkey, cid, record, indexed_at)
    VALUES (${atUri}, ${did}, ${rkey}, ${FAKE_CID}, ${sql.json(protocolRecord)}, now())
  `;

  return { protocolRkey: rkey };
}

export async function seedSurvey(
  sql: Sql,
  did: string,
  protocolUri: string,
  locationName = 'Test Location',
  createdAt = new Date().toISOString(),
): Promise<{ surveyRkey: string }> {
  const rkey = `testsurvey${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const atUri = `at://${did}/bio.cuanto.survey/${rkey}`;
  const record = {
    $type: 'bio.cuanto.survey',
    protocol: { uri: protocolUri, cid: FAKE_CID },
    createdAt,
    location: { $type: 'org.atgeo.place', name: locationName },
  };
  await sql`
    INSERT INTO surveys (at_uri, did, rkey, protocol_uri, created_at, record, indexed_at)
    VALUES (${atUri}, ${did}, ${rkey}, ${protocolUri}, ${new Date(createdAt)}, ${sql.json(record)}, now())
  `;
  return { surveyRkey: rkey };
}

export async function seedSurveyWithCoordinates(
  sql: Sql,
  did: string,
  protocolUri: string,
  locationName = 'Test Location',
  latitude = '37.7749',
  longitude = '-122.4194',
): Promise<{ surveyRkey: string }> {
  const rkey = `testsurvey${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const atUri = `at://${did}/bio.cuanto.survey/${rkey}`;
  const record = {
    $type: 'bio.cuanto.survey',
    protocol: { uri: protocolUri, cid: FAKE_CID },
    createdAt: new Date().toISOString(),
    location: {
      $type: 'org.atgeo.place',
      name: locationName,
      locations: [
        {
          $type: 'community.lexicon.location.geo',
          latitude,
          longitude,
        },
      ],
    },
  };
  await sql`
    INSERT INTO surveys (at_uri, did, rkey, protocol_uri, created_at, record, indexed_at)
    VALUES (${atUri}, ${did}, ${rkey}, ${protocolUri}, now(), ${sql.json(record)}, now())
  `;
  return { surveyRkey: rkey };
}

export async function seedOccurrence(
  sql: Sql,
  did: string,
  surveyUri: string,
  surveyTargetUri: string,
): Promise<void> {
  const rkey = `testocc${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const atUri = `at://${did}/bio.lexicons.temp.v0-1.occurrence/${rkey}`;
  const record = {
    $type: 'bio.lexicons.temp.v0-1.occurrence',
    eventID: surveyUri,
    surveyTargetID: surveyTargetUri,
  };
  await sql`
    INSERT INTO occurrences (at_uri, did, rkey, survey_uri, record, indexed_at)
    VALUES (${atUri}, ${did}, ${rkey}, ${surveyUri}, ${sql.json(record)}, now())
  `;
}

export async function teardownDid(sql: Sql, did: string): Promise<void> {
  await sql`DELETE FROM identifications WHERE did = ${did}`;
  await sql`DELETE FROM occurrences WHERE did = ${did}`;
  await sql`DELETE FROM surveys WHERE did = ${did}`;
  await sql`DELETE FROM protocol_targets WHERE did = ${did}`;
  await sql`DELETE FROM protocol_follows WHERE did = ${did}`;
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
        domain: '127.0.0.1',
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
