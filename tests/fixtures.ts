import { test as base } from '@playwright/test';
import postgres, { type Sql } from 'postgres';

export { expect } from '@playwright/test';

const TEST_DB_URL = 'postgresql://cuanto:cuanto@localhost:5432/cuanto_test';

const FAKE_CID = 'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34';

export async function seedProtocol(
  sql: Sql,
  did: string,
  title = 'Test Protocol',
): Promise<{
  protocolRkey: string;
  taxonTargetUri: string;
  verbatimTargetUri: string;
}> {
  const handle = `user-${did.split(':').pop()}`;
  await sql`
    INSERT INTO users (did, handle) VALUES (${did}, ${handle})
    ON CONFLICT (did) DO NOTHING
  `;

  const rkey = `testproto${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const atUri = `at://${did}/bio.cuanto.surveyProtocol/${rkey}`;

  const protocolRecord = {
    $type: 'bio.cuanto.surveyProtocol',
    title,
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
    {
      rkey: `testtarget3${Date.now()}`,
      scope: [
        {
          $type: 'bio.cuanto.protocolTarget#taxonScope',
          scientificName: 'Orienthella piunca',
          taxonRank: 'species',
          taxonID: 'https://www.inaturalist.org/taxa/1655734',
          vernacularName: "Fisher's aeolid",
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

  return {
    protocolRkey: rkey,
    taxonTargetUri: `at://${did}/bio.cuanto.protocolTarget/${targets[0].rkey}`,
    verbatimTargetUri: `at://${did}/bio.cuanto.protocolTarget/${targets[1].rkey}`,
  };
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
): Promise<{ surveyRkey: string; surveyAtUri: string }> {
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
  return { surveyRkey: rkey, surveyAtUri: atUri };
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
    INSERT INTO surveys (at_uri, did, rkey, protocol_uri, created_at, record, geom, indexed_at)
    VALUES (
      ${atUri}, ${did}, ${rkey}, ${protocolUri}, now(), ${sql.json(record)},
      ST_SetSRID(ST_MakePoint(${parseFloat(longitude)}, ${parseFloat(latitude)}), 4326),
      now()
    )
  `;
  return { surveyRkey: rkey };
}

export async function seedOccurrence(
  sql: Sql,
  did: string,
  surveyUri: string,
  protocolUri: string,
  // The protocol author's protocolTarget URI.
  protocolTargetUri: string,
  organismQuantity?: string,
): Promise<{ occUri: string }> {
  const rkey = `testocc${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const atUri = `at://${did}/bio.lexicons.temp.v0-1.occurrence/${rkey}`;
  const targetRkey = protocolTargetUri.split('/').at(-1) ?? '';
  const surveyTargetUri = `at://${did}/bio.cuanto.surveyTarget/${targetRkey}`;
  const record = {
    $type: 'bio.lexicons.temp.v0-1.occurrence',
    eventID: surveyUri,
    surveyTargetID: surveyTargetUri,
    ...(organismQuantity !== undefined ? { organismQuantity } : {}),
  };
  // The occurrence's protocolTarget is resolved at the app level by joining
  // survey_targets on surveyTargetID, so seed the row that join depends on.
  const targetRecord = {
    $type: 'bio.cuanto.surveyTarget',
    protocol: protocolUri,
    protocolTargetID: protocolTargetUri,
    scope: [],
  };
  await sql`
    INSERT INTO survey_targets (at_uri, did, rkey, protocol_uri, protocol_target_uri, record, indexed_at)
    VALUES (${surveyTargetUri}, ${did}, ${targetRkey}, ${protocolUri}, ${protocolTargetUri}, ${sql.json(targetRecord)}, now())
    ON CONFLICT (at_uri) DO NOTHING
  `;
  await sql`
    INSERT INTO occurrences (at_uri, did, rkey, survey_uri, record, indexed_at)
    VALUES (${atUri}, ${did}, ${rkey}, ${surveyUri}, ${sql.json(record)}, now())
  `;
  return { occUri: atUri };
}

// Seeds a survey_target without an occurrence, so it shows up as notDetected in
// the dwc-dp export for any survey by the same did+protocol without a matching
// occurrence. targetCreatedAt controls the temporal gate; null means "unknown
// birth time" (treated as always existing). targetRetiredAt controls the upper
// bound of the target's validity; null means "never retired".
export async function seedSurveyTarget(
  sql: Sql,
  did: string,
  protocolUri: string,
  protocolTargetUri: string,
  targetCreatedAt: Date | null = null,
  targetRetiredAt: Date | null = null,
): Promise<{ surveyTargetUri: string }> {
  const targetRkey = protocolTargetUri.split('/').at(-1) ?? '';
  const surveyTargetUri = `at://${did}/bio.cuanto.surveyTarget/${targetRkey}`;
  const targetRecord = {
    $type: 'bio.cuanto.surveyTarget',
    protocol: protocolUri,
    protocolTargetID: protocolTargetUri,
    scope: [],
    createdAt: targetCreatedAt?.toISOString(),
    retiredAt: targetRetiredAt?.toISOString(),
  };
  await sql`
    INSERT INTO survey_targets (
      at_uri, did, rkey, protocol_uri, protocol_target_uri, record,
      indexed_at, created_at, retired_at
    )
    VALUES (
      ${surveyTargetUri}, ${did}, ${targetRkey}, ${protocolUri},
      ${protocolTargetUri}, ${sql.json(targetRecord)},
      now(), ${targetCreatedAt}, ${targetRetiredAt}
    )
    ON CONFLICT (at_uri) DO UPDATE SET
      created_at = EXCLUDED.created_at,
      retired_at = EXCLUDED.retired_at
  `;
  return { surveyTargetUri };
}

export async function seedIncidentalOccurrence(
  sql: Sql,
  did: string,
  surveyUri: string,
  taxonID: string,
  scientificName: string,
  vernacularName?: string,
): Promise<{ occUri: string }> {
  const occRkey = `testinc${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const occUri = `at://${did}/bio.lexicons.temp.v0-1.occurrence/${occRkey}`;
  const occRecord = {
    $type: 'bio.lexicons.temp.v0-1.occurrence',
    eventID: surveyUri,
    taxonID,
    organismQuantity: '1',
    organismQuantityType: 'individuals',
  };
  await sql`
    INSERT INTO occurrences (at_uri, did, rkey, survey_uri, record, indexed_at)
    VALUES (${occUri}, ${did}, ${occRkey}, ${surveyUri}, ${sql.json(occRecord)}, now())
  `;

  const identRkey = `testident${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const identUri = `at://${did}/bio.lexicons.temp.v0-1.identification/${identRkey}`;
  const identRecord = {
    $type: 'bio.lexicons.temp.v0-1.identification',
    occurrence: { uri: occUri, cid: FAKE_CID },
    scientificName,
    ...(vernacularName ? { vernacularName } : {}),
    taxonRank: 'species',
    taxonID,
    createdAt: new Date().toISOString(),
  };
  await sql`
    INSERT INTO identifications (at_uri, did, rkey, occurrence_uri, record, indexed_at)
    VALUES (${identUri}, ${did}, ${identRkey}, ${occUri}, ${sql.json(identRecord)}, now())
  `;

  return { occUri };
}

export async function teardownDid(sql: Sql, did: string): Promise<void> {
  await sql`DELETE FROM identifications WHERE did = ${did}`;
  await sql`DELETE FROM occurrences WHERE did = ${did}`;
  await sql`DELETE FROM surveys WHERE did = ${did}`;
  await sql`DELETE FROM survey_targets WHERE did = ${did}`;
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
