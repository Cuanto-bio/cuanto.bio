import type { Sql } from 'postgres';
import {
  expect,
  seedProtocol,
  seedSurvey,
  seedSurveyWithCoordinates,
  teardownDid,
  test,
} from '../fixtures.js';

// ── Edit route ───────────────────────────────────────────────────────────────

const EDIT_DID = 'did:test:survey-edit-route';
const EDIT_HANDLE = 'user-survey-edit-route';

test('survey detail page shows Edit link for owner', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: EDIT_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
  const protocolUri = `at://${EDIT_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
  const { surveyRkey } = await seedSurvey(
    sql,
    EDIT_DID,
    protocolUri,
    'Edit Route Test',
  );

  try {
    // Cache protocol in IDB before visiting the survey detail page
    await page.goto(`/app/protocols/${EDIT_HANDLE}/${protocolRkey}`);
    await page.waitForLoadState('networkidle');
    await page.goto(`/app/surveys/${EDIT_HANDLE}/${surveyRkey}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('link', { name: 'Edit' })).toBeVisible();
  } finally {
    await teardownDid(sql, EDIT_DID);
  }
});

test('edit page saves updated location name', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: EDIT_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
  const protocolUri = `at://${EDIT_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
  const { surveyRkey } = await seedSurvey(
    sql,
    EDIT_DID,
    protocolUri,
    'Original Name',
  );

  try {
    // Cache protocol in IDB before visiting the edit page
    await page.goto(`/app/protocols/${EDIT_HANDLE}/${protocolRkey}`);
    await page.waitForLoadState('networkidle');
    await page.goto(`/app/surveys/${EDIT_HANDLE}/${surveyRkey}/edit`);
    await page.waitForSelector('[placeholder="e.g. Mission Dolores Park"]', {
      state: 'visible',
    });

    await page.fill(
      '[placeholder="e.g. Mission Dolores Park"]',
      'Updated Name',
    );
    await page.getByRole('button', { name: 'Save Survey' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();

    await expect(page).toHaveURL(
      new RegExp(`/app/surveys/${EDIT_HANDLE}/${surveyRkey}`),
    );
    await expect(page.getByText('Updated Name')).toBeVisible();
  } finally {
    await teardownDid(sql, EDIT_DID);
  }
});

const LOC_DID = 'did:test:survey-loc-edit';
const LOC_HANDLE = 'user-survey-loc-edit';

test('edit form shows coexisting point + bbox and persists removing the bbox', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: LOC_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const { protocolRkey } = await seedProtocol(sql, LOC_DID);
  const protocolUri = `at://${LOC_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
  const rkey = `locedit${Date.now()}`;
  const atUri = `at://${LOC_DID}/bio.cuanto.survey/${rkey}`;
  // A survey holding a point AND a bounding box at once (e.g. a track-recorded
  // survey: centroid point + derived bbox). The old exclusive picker collapsed
  // this to one representation; the editor must show both.
  const record = {
    $type: 'bio.cuanto.survey',
    protocol: {
      uri: protocolUri,
      cid: 'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34',
    },
    createdAt: new Date().toISOString(),
    eventDate: '2026-05-01T10:00:00.000Z',
    eventDurationValue: 30,
    eventDurationUnit: 'minutes',
    location: {
      $type: 'org.atgeo.place',
      name: 'Loc Edit Park',
      locations: [
        {
          $type: 'community.lexicon.location.geo',
          latitude: '37.77',
          longitude: '-122.41',
        },
        {
          $type: 'community.lexicon.location.bbox',
          north: '37.8',
          south: '37.7',
          east: '-122.3',
          west: '-122.5',
        },
      ],
    },
  };
  await sql`
    INSERT INTO surveys (at_uri, did, rkey, protocol_uri, created_at, record, indexed_at)
    VALUES (${atUri}, ${LOC_DID}, ${rkey}, ${protocolUri}, now(), ${sql.json(record)}, now())
  `;

  try {
    await page.goto(`/app/protocols/${LOC_HANDLE}/${protocolRkey}`);
    await page.waitForLoadState('networkidle');
    await page.goto(`/app/surveys/${LOC_HANDLE}/${rkey}/edit`);
    await page.waitForSelector('[placeholder="e.g. Mission Dolores Park"]', {
      state: 'visible',
    });

    // Both representations show at once.
    await expect(page.getByText('37.77, -122.41')).toBeVisible();
    await expect(
      page.getByText('N 37.8, S 37.7, E -122.3, W -122.5'),
    ).toBeVisible();

    // Remove only the bounding box; the point stays.
    await page.getByTestId('loc-remove-bbox').click();
    // Confirm via the AlertDialog
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Remove' })
      .click();
    await expect(
      page.getByText('N 37.8, S 37.7, E -122.3, W -122.5'),
    ).toHaveCount(0);
    await expect(page.getByText('37.77, -122.41')).toBeVisible();

    await page.getByRole('button', { name: 'Save Survey' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    // Wait for the redirect to the detail page (not the /edit URL, which shares a
    // prefix) so the PUT has committed before we read the DB.
    await page.waitForURL(
      new RegExp(`/app/surveys/${LOC_HANDLE}/${rkey}\\?updated=1`),
    );

    // Persisted: geo entry kept, bbox entry dropped.
    const [row] = await sql<
      { record: { location: { locations?: Array<{ $type: string }> } } }[]
    >`SELECT record FROM surveys WHERE at_uri = ${atUri}`;
    const locs = row.record.location.locations ?? [];
    expect(locs.some((l) => l.$type === 'community.lexicon.location.geo')).toBe(
      true,
    );
    expect(
      locs.some((l) => l.$type === 'community.lexicon.location.bbox'),
    ).toBe(false);
  } finally {
    await teardownDid(sql, LOC_DID);
  }
});

const LOC2_DID = 'did:test:survey-loc-edit2';
const LOC2_HANDLE = 'user-survey-loc-edit2';

test('editing a point coordinate via the input persists the new value', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: LOC2_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const { protocolRkey } = await seedProtocol(sql, LOC2_DID);
  const protocolUri = `at://${LOC2_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
  const surveyRkey = `ptedit${Date.now()}`;
  const atUri = `at://${LOC2_DID}/bio.cuanto.survey/${surveyRkey}`;
  const record = {
    $type: 'bio.cuanto.survey',
    protocol: {
      uri: protocolUri,
      cid: 'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34',
    },
    createdAt: new Date().toISOString(),
    eventDate: '2026-05-01T10:00:00.000Z',
    eventDurationValue: 30,
    eventDurationUnit: 'minutes',
    location: {
      $type: 'org.atgeo.place',
      name: 'Point Edit Park',
      locations: [
        {
          $type: 'community.lexicon.location.geo',
          latitude: '37.7749',
          longitude: '-122.4194',
        },
      ],
    },
  };
  await sql`
    INSERT INTO surveys (at_uri, did, rkey, protocol_uri, created_at, record, indexed_at)
    VALUES (${atUri}, ${LOC2_DID}, ${surveyRkey}, ${protocolUri}, now(), ${sql.json(record)}, now())
  `;

  try {
    await page.goto(`/app/protocols/${LOC2_HANDLE}/${protocolRkey}`);
    await page.waitForLoadState('networkidle');
    await page.goto(`/app/surveys/${LOC2_HANDLE}/${surveyRkey}/edit`);
    await page.waitForSelector('[placeholder="e.g. Mission Dolores Park"]', {
      state: 'visible',
    });

    // Enter edit mode for the point, then change the latitude via the input.
    await page.getByText('37.7749, -122.4194').waitFor();
    await page.getByTestId('loc-edit-point').click();
    await page.getByLabel('Latitude').fill('40');
    await page.getByLabel('Longitude').fill('-73');

    await page.getByRole('button', { name: 'Save Survey' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForURL(
      new RegExp(`/app/surveys/${LOC2_HANDLE}/${surveyRkey}\\?updated=1`),
    );

    const [row] = await sql<
      {
        record: {
          location: {
            locations?: Array<{
              $type: string;
              latitude?: string;
              longitude?: string;
            }>;
          };
        };
      }[]
    >`SELECT record FROM surveys WHERE at_uri = ${atUri}`;
    const geo = (row.record.location.locations ?? []).find(
      (l) => l.$type === 'community.lexicon.location.geo',
    );
    expect(geo?.latitude).toBe('40');
    expect(geo?.longitude).toBe('-73');
  } finally {
    await teardownDid(sql, LOC2_DID);
  }
});

const LOC3_DID = 'did:test:survey-loc-edit3';
const LOC3_HANDLE = 'user-survey-loc-edit3';

test('edit form removes an existing track and persists its absence', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: LOC3_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const { protocolRkey } = await seedProtocol(sql, LOC3_DID);
  const protocolUri = `at://${LOC3_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
  const surveyRkey = `trkedit${Date.now()}`;
  const atUri = `at://${LOC3_DID}/bio.cuanto.survey/${surveyRkey}`;
  // A survey carrying a point plus a published GPX track blob. The editor must
  // let the user drop the track while keeping the point.
  const record = {
    $type: 'bio.cuanto.survey',
    protocol: {
      uri: protocolUri,
      cid: 'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34',
    },
    createdAt: new Date().toISOString(),
    eventDate: '2026-05-01T10:00:00.000Z',
    eventDurationValue: 30,
    eventDurationUnit: 'minutes',
    location: {
      $type: 'org.atgeo.place',
      name: 'Track Edit Park',
      locations: [
        {
          $type: 'community.lexicon.location.geo',
          latitude: '37.77',
          longitude: '-122.41',
        },
      ],
    },
    track: {
      gpx: {
        $type: 'blob',
        ref: { $link: 'bafkreigpxfaketrackcidfortestingremovalflowxxxxx' },
        mimeType: 'application/gpx+xml',
        size: 128,
      },
      source: 'device',
    },
  };
  await sql`
    INSERT INTO surveys (at_uri, did, rkey, protocol_uri, created_at, record, indexed_at)
    VALUES (${atUri}, ${LOC3_DID}, ${surveyRkey}, ${protocolUri}, now(), ${sql.json(record)}, now())
  `;

  try {
    await page.goto(`/app/protocols/${LOC3_HANDLE}/${protocolRkey}`);
    await page.waitForLoadState('networkidle');
    await page.goto(`/app/surveys/${LOC3_HANDLE}/${surveyRkey}/edit`);
    await page.waitForSelector('[placeholder="e.g. Mission Dolores Park"]', {
      state: 'visible',
    });

    // The track row is shown with a Remove control because the survey has a track.
    await page.getByTestId('loc-remove-track').click();
    // Confirm via the AlertDialog.
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Remove' })
      .click();
    await expect(page.getByTestId('loc-remove-track')).toHaveCount(0);

    await page.getByRole('button', { name: 'Save Survey' }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForURL(
      new RegExp(`/app/surveys/${LOC3_HANDLE}/${surveyRkey}\\?updated=1`),
    );

    // Persisted: the point is kept, the track key is gone from the record.
    const [row] = await sql<
      {
        record: {
          track?: unknown;
          location: { locations?: Array<{ $type: string }> };
        };
      }[]
    >`SELECT record FROM surveys WHERE at_uri = ${atUri}`;
    expect(row.record.track).toBeUndefined();
    const locs = row.record.location.locations ?? [];
    expect(locs.some((l) => l.$type === 'community.lexicon.location.geo')).toBe(
      true,
    );
  } finally {
    await teardownDid(sql, LOC3_DID);
  }
});

const TRKDIST_DID = 'did:test:survey-loc-edit-dist';
const TRKDIST_HANDLE = 'user-survey-loc-edit-dist';

test('edit form shows track distance and drops it when the track is removed', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: TRKDIST_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  // Serve a real GPX body for the published blob so the editor loads points.
  // Two fixes 0.01° apart in each axis near 37.8°N: ~1.42 km.
  await page.route('**/api/blobs/gpx*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/gpx+xml',
      body: [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<gpx version="1.1" creator="cuanto.bio">',
        '<trk><trkseg>',
        '<trkpt lat="37.77" lon="-122.41"><time>2026-05-01T10:00:00.000Z</time></trkpt>',
        '<trkpt lat="37.78" lon="-122.42"><time>2026-05-01T10:00:10.000Z</time></trkpt>',
        '</trkseg></trk>',
        '</gpx>',
      ].join('\n'),
    }),
  );

  const { protocolRkey } = await seedProtocol(sql, TRKDIST_DID);
  const protocolUri = `at://${TRKDIST_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
  const surveyRkey = `trkdist${Date.now()}`;
  const atUri = `at://${TRKDIST_DID}/bio.cuanto.survey/${surveyRkey}`;
  const record = {
    $type: 'bio.cuanto.survey',
    protocol: {
      uri: protocolUri,
      cid: 'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34',
    },
    createdAt: new Date().toISOString(),
    eventDate: '2026-05-01T10:00:00.000Z',
    location: {
      $type: 'org.atgeo.place',
      name: 'Track Distance Park',
      locations: [],
    },
    track: {
      gpx: {
        $type: 'blob',
        ref: { $link: 'bafkreigpxfaketrackcidfordistanceflowxxxxxxxxxxx' },
        mimeType: 'application/gpx+xml',
        size: 128,
      },
      source: 'device',
    },
  };
  await sql`
    INSERT INTO surveys (at_uri, did, rkey, protocol_uri, created_at, record, indexed_at)
    VALUES (${atUri}, ${TRKDIST_DID}, ${surveyRkey}, ${protocolUri}, now(), ${sql.json(record)}, now())
  `;

  try {
    await page.goto(`/app/protocols/${TRKDIST_HANDLE}/${protocolRkey}`);
    await page.waitForLoadState('networkidle');
    await page.goto(`/app/surveys/${TRKDIST_HANDLE}/${surveyRkey}/edit`);
    await page.waitForSelector('[placeholder="e.g. Mission Dolores Park"]', {
      state: 'visible',
    });

    await expect(page.getByText('1.42 km', { exact: true })).toBeVisible();

    // Removing the track drops the readout rather than leaving a stale distance.
    await page.getByTestId('loc-remove-track').click();
    await page
      .getByRole('alertdialog')
      .getByRole('button', { name: 'Remove' })
      .click();
    await expect(page.getByText('1.42 km', { exact: true })).toHaveCount(0);
  } finally {
    await teardownDid(sql, TRKDIST_DID);
  }
});

// ── Survey detail: coordinates and map ────────────────────────────────────────

const COORDS_DID = 'did:test:survey-spec-coords';
const COORDS_HANDLE = 'user-survey-spec-coords';

test('survey detail shows coordinates and map when survey has geo location', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: COORDS_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const { protocolRkey } = await seedProtocol(sql, COORDS_DID);
  const protocolUri = `at://${COORDS_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
  const { surveyRkey } = await seedSurveyWithCoordinates(
    sql,
    COORDS_DID,
    protocolUri,
    'Geo Test Park',
    '37.7749',
    '-122.4194',
  );

  try {
    await page.goto(`/app/protocols/${COORDS_HANDLE}/${protocolRkey}`);
    await page.waitForLoadState('networkidle');
    await page.goto(`/app/surveys/${COORDS_HANDLE}/${surveyRkey}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('37.7749, -122.4194')).toBeVisible();
    await expect(page.locator('[data-testid="geo-map"]')).toBeVisible();
  } finally {
    await teardownDid(sql, COORDS_DID);
  }
});

const MISSING_PROTOCOL_DID = 'did:test:survey-spec-missing-protocol';
const MISSING_PROTOCOL_HANDLE = 'user-survey-spec-missing-protocol';

test('survey detail loads when protocol is not cached in IDB', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: MISSING_PROTOCOL_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const { protocolRkey } = await seedProtocol(sql, MISSING_PROTOCOL_DID);
  const protocolUri = `at://${MISSING_PROTOCOL_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
  const { surveyRkey } = await seedSurvey(
    sql,
    MISSING_PROTOCOL_DID,
    protocolUri,
    'Test Park',
  );

  try {
    // Navigate directly to the survey without pre-caching the protocol
    await page.goto(`/app/surveys/${MISSING_PROTOCOL_HANDLE}/${surveyRkey}`);
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Test Park')).toBeVisible();
  } finally {
    await teardownDid(sql, MISSING_PROTOCOL_DID);
  }
});

test('survey detail does not show coordinates or map when survey has no geo location', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: COORDS_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const { protocolRkey } = await seedProtocol(sql, COORDS_DID);
  const protocolUri = `at://${COORDS_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
  const { surveyRkey } = await seedSurvey(
    sql,
    COORDS_DID,
    protocolUri,
    'No Coords Park',
  );

  try {
    await page.goto(`/app/protocols/${COORDS_HANDLE}/${protocolRkey}`);
    await page.waitForLoadState('networkidle');
    await page.goto(`/app/surveys/${COORDS_HANDLE}/${surveyRkey}`);
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('Coordinates:')).not.toBeVisible();
    await expect(page.locator('[data-testid="geo-map"]')).not.toBeVisible();
  } finally {
    await teardownDid(sql, COORDS_DID);
  }
});

// ── Survey detail: surveyors row ──────────────────────────────────────────────

const SURVEYORS_DID = 'did:test:survey-surveyors';
const SURVEYORS_HANDLE = 'user-survey-surveyors';
// A 1x1 transparent GIF, so the avatar resolves without a network round trip.
const AVATAR_URL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// Seeds a survey by SURVEYORS_DID whose author has an avatar, optionally
// recording surveyorCount. Visited signed-out via the public detail route, so
// no protocol pre-caching in IDB is needed.
async function seedSurveyWithSurveyors(
  sql: Sql,
  surveyorCount?: number,
): Promise<{ surveyRkey: string; protocolRkey: string }> {
  const { protocolRkey } = await seedProtocol(sql, SURVEYORS_DID);
  const protocolUri = `at://${SURVEYORS_DID}/bio.cuanto.surveyProtocol/${protocolRkey}`;
  await sql`
    UPDATE users SET avatar_url = ${AVATAR_URL} WHERE did = ${SURVEYORS_DID}
  `;

  const rkey = `surveyors${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const atUri = `at://${SURVEYORS_DID}/bio.cuanto.survey/${rkey}`;
  const record = {
    $type: 'bio.cuanto.survey',
    protocol: {
      uri: protocolUri,
      cid: 'bafyreids4hmf6hmplkmcvjn57gqxq3gj2lspkutktkj4w53hnnqavtcr34',
    },
    createdAt: new Date().toISOString(),
    eventDate: '2026-05-01T10:00:00.000Z',
    location: { $type: 'org.atgeo.place', name: 'Surveyors Park' },
    ...(surveyorCount != null ? { surveyorCount } : {}),
  };
  await sql`
    INSERT INTO surveys (at_uri, did, rkey, protocol_uri, created_at, record, indexed_at)
    VALUES (${atUri}, ${SURVEYORS_DID}, ${rkey}, ${protocolUri}, now(), ${sql.json(record)}, now())
  `;
  return { surveyRkey: rkey, protocolRkey };
}

test('survey detail shows the surveyor avatar and handle when surveyorCount is absent', async ({
  page,
  sql,
}) => {
  const { surveyRkey } = await seedSurveyWithSurveyors(sql);

  try {
    await page.goto(`/surveys/${SURVEYORS_HANDLE}/${surveyRkey}`);

    const row = page.getByTestId('survey-surveyors');
    await expect(row).toBeVisible();
    await expect(row.getByText(`@${SURVEYORS_HANDLE}`)).toBeVisible();
    const avatar = row.locator('img');
    await expect(avatar).toBeVisible();
    await expect(avatar).toHaveAttribute('src', AVATAR_URL);
    await expect(row).not.toContainText('other');
  } finally {
    await teardownDid(sql, SURVEYORS_DID);
  }
});

test('survey detail shows "and N others" when surveyorCount exceeds 1', async ({
  page,
  sql,
}) => {
  const { surveyRkey } = await seedSurveyWithSurveyors(sql, 3);

  try {
    await page.goto(`/surveys/${SURVEYORS_HANDLE}/${surveyRkey}`);

    const row = page.getByTestId('survey-surveyors');
    await expect(row.getByText(`@${SURVEYORS_HANDLE}`)).toBeVisible();
    await expect(row).toContainText('and 2 others');
  } finally {
    await teardownDid(sql, SURVEYORS_DID);
  }
});

test('survey detail singularizes the others count when surveyorCount is 2', async ({
  page,
  sql,
}) => {
  const { surveyRkey } = await seedSurveyWithSurveyors(sql, 2);

  try {
    await page.goto(`/surveys/${SURVEYORS_HANDLE}/${surveyRkey}`);

    const row = page.getByTestId('survey-surveyors');
    await expect(row).toContainText('and 1 other');
    await expect(row).not.toContainText('others');
  } finally {
    await teardownDid(sql, SURVEYORS_DID);
  }
});

test('survey detail shows only the surveyor when surveyorCount is 1', async ({
  page,
  sql,
}) => {
  const { surveyRkey } = await seedSurveyWithSurveyors(sql, 1);

  try {
    await page.goto(`/surveys/${SURVEYORS_HANDLE}/${surveyRkey}`);

    const row = page.getByTestId('survey-surveyors');
    await expect(row.getByText(`@${SURVEYORS_HANDLE}`)).toBeVisible();
    await expect(row).not.toContainText('other');
  } finally {
    await teardownDid(sql, SURVEYORS_DID);
  }
});

// The owner's /app view reads the survey from IndexedDB rather than the server
// load, so the handle and avatar have to survive the cache round trip too.
test('owner survey detail shows the surveyor avatar and handle from the cache', async ({
  page,
  sql,
  context,
}) => {
  await context.addCookies([
    {
      name: 'did',
      value: SURVEYORS_DID,
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);

  const { surveyRkey, protocolRkey } = await seedSurveyWithSurveyors(sql, 3);

  try {
    await page.goto(`/app/protocols/${SURVEYORS_HANDLE}/${protocolRkey}`);
    await page.waitForLoadState('networkidle');
    await page.goto(`/app/surveys/${SURVEYORS_HANDLE}/${surveyRkey}`);
    await page.waitForLoadState('networkidle');

    const row = page.getByTestId('survey-surveyors');
    await expect(row.getByText(`@${SURVEYORS_HANDLE}`)).toBeVisible();
    await expect(row.locator('img')).toBeVisible();
    await expect(row).toContainText('and 2 others');
  } finally {
    await teardownDid(sql, SURVEYORS_DID);
  }
});
