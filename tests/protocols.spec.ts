import {
  expect,
  seedOccurrence,
  seedProtocol,
  seedSurvey,
  teardownDid,
  test,
} from './fixtures.js';

const DID = 'did:test:protocols-spec';
const HANDLE = 'user-protocols-spec';

// ── Protocol creation with locationOptions ────────────────────────────────────
//
// createRecord in src/lib/server/pds.ts is mocked via PDS_MOCK=true in the
// Playwright webServer config — no real HTTP call is made. The same
// protocolRecord is both passed to createRecord(..., record) and stored in the
// DB via insertProtocol, so asserting on the DB record verifies the exact
// payload that would be sent to /xrpc/com.atproto.repo.createRecord.

const LOC_DID = 'did:test:protocol-loc-opts-spec';
const LOC_HANDLE = 'user-protocol-loc-opts-spec';

test.describe('protocol creation with locationOptions', () => {
  test.beforeEach(async ({ page, sql, context }) => {
    await sql`
      INSERT INTO users (did, handle) VALUES (${LOC_DID}, ${LOC_HANDLE})
      ON CONFLICT (did) DO UPDATE SET handle = EXCLUDED.handle
    `;
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

    await page.goto('/protocols/new');
    await page.waitForLoadState('networkidle');
  });

  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, LOC_DID);
  });

  test('name-only location is stored in DB record', async ({ page, sql }) => {
    await page.fill('[name="title"]', 'Name-only Location Protocol');
    await page.fill(
      '[name="description"]',
      'Protocol with a name-only location',
    );

    await page.click('text=+ Add manually');
    await page
      .locator('[placeholder="Location name"]')
      .first()
      .fill('Mission Creek');

    await page.click('text=Create protocol');
    await expect(page).toHaveURL(new RegExp(`/protocols/${LOC_HANDLE}/\\w+`));

    const [row] = await sql<{ record: Record<string, unknown> }[]>`
      SELECT record FROM survey_protocols WHERE did = ${LOC_DID}
      ORDER BY indexed_at DESC LIMIT 1
    `;

    const locationOptions = row.record.locationOptions as {
      $type: string;
      name: string;
      locations?: unknown[];
    }[];

    expect(locationOptions).toHaveLength(1);
    expect(locationOptions[0].$type).toBe('org.atgeo.place');
    expect(locationOptions[0].name).toBe('Mission Creek');
    expect(locationOptions[0].locations).toBeUndefined();
  });

  test('geo location is stored in DB record', async ({ page, sql }) => {
    await page.fill('[name="title"]', 'Geo Location Protocol');
    await page.fill('[name="description"]', 'Protocol with geo coordinates');

    await page.click('text=+ Add manually');
    await page
      .locator('[placeholder="Location name"]')
      .first()
      .fill('China Camp');
    await page.click('text=+ Add coordinates');
    await page.locator('[placeholder="Latitude"]').first().fill('38.004');
    await page.locator('[placeholder="Longitude"]').first().fill('-122.4978');

    await page.click('text=Create protocol');
    await expect(page).toHaveURL(new RegExp(`/protocols/${LOC_HANDLE}/\\w+`));

    const [row] = await sql<{ record: Record<string, unknown> }[]>`
      SELECT record FROM survey_protocols WHERE did = ${LOC_DID}
      ORDER BY indexed_at DESC LIMIT 1
    `;

    const locationOptions = row.record.locationOptions as {
      $type: string;
      name: string;
      locations: { $type: string; latitude: string; longitude: string }[];
    }[];

    expect(locationOptions).toHaveLength(1);
    expect(locationOptions[0].$type).toBe('org.atgeo.place');
    expect(locationOptions[0].name).toBe('China Camp');
    expect(locationOptions[0].locations).toHaveLength(1);
    expect(locationOptions[0].locations[0].$type).toBe(
      'community.lexicon.location.geo',
    );
    expect(locationOptions[0].locations[0].latitude).toBe('38.004');
    expect(locationOptions[0].locations[0].longitude).toBe('-122.4978');
  });

  test('address location is stored in DB record', async ({ page, sql }) => {
    await page.fill('[name="title"]', 'Address Location Protocol');
    await page.fill('[name="description"]', 'Protocol with a street address');

    await page.click('text=+ Add manually');
    await page
      .locator('[placeholder="Location name"]')
      .first()
      .fill('Coyote Hills');
    await page.click('text=+ Add address');
    await page.locator('[placeholder="US"]').first().fill('US');
    await page.locator('[placeholder="CA"]').first().fill('CA');
    await page.locator('[placeholder="San Francisco"]').first().fill('Fremont');
    await page.locator('[placeholder="94103"]').first().fill('94538');

    await page.click('text=Create protocol');
    await expect(page).toHaveURL(new RegExp(`/protocols/${LOC_HANDLE}/\\w+`));

    const [row] = await sql<{ record: Record<string, unknown> }[]>`
      SELECT record FROM survey_protocols WHERE did = ${LOC_DID}
      ORDER BY indexed_at DESC LIMIT 1
    `;

    const locationOptions = row.record.locationOptions as {
      $type: string;
      name: string;
      locations: {
        $type: string;
        country: string;
        region?: string;
        locality?: string;
        postalCode?: string;
      }[];
    }[];

    expect(locationOptions).toHaveLength(1);
    expect(locationOptions[0].$type).toBe('org.atgeo.place');
    expect(locationOptions[0].name).toBe('Coyote Hills');
    expect(locationOptions[0].locations).toHaveLength(1);
    expect(locationOptions[0].locations[0].$type).toBe(
      'community.lexicon.location.address',
    );
    expect(locationOptions[0].locations[0].country).toBe('US');
    expect(locationOptions[0].locations[0].region).toBe('CA');
    expect(locationOptions[0].locations[0].locality).toBe('Fremont');
    expect(locationOptions[0].locations[0].postalCode).toBe('94538');
  });

  test('protocol without locationOptions has no locationOptions in DB record', async ({
    page,
    sql,
  }) => {
    await page.fill('[name="title"]', 'No Location Protocol');
    await page.fill('[name="description"]', 'Protocol with free-form location');

    await page.click('text=Create protocol');
    await expect(page).toHaveURL(new RegExp(`/protocols/${LOC_HANDLE}/\\w+`));

    const [row] = await sql<{ record: Record<string, unknown> }[]>`
      SELECT record FROM survey_protocols WHERE did = ${LOC_DID}
      ORDER BY indexed_at DESC LIMIT 1
    `;

    expect(row.record.locationOptions).toBeUndefined();
  });

  test('map appears when lat and lon are filled in', async ({ page }) => {
    await page.route('https://tile.openstreetmap.org/**', (route) =>
      route.fulfill({ status: 200, body: Buffer.alloc(0) }),
    );

    await page.click('text=+ Add manually');
    await page
      .locator('[placeholder="Location name"]')
      .first()
      .fill('Test Place');
    await page.click('text=+ Add coordinates');

    await expect(page.getByTestId('geo-map')).not.toBeVisible();

    await page.locator('[placeholder="Latitude"]').first().fill('37.77');
    await expect(page.getByTestId('geo-map')).not.toBeVisible();

    await page.locator('[placeholder="Longitude"]').first().fill('-122.42');
    await expect(page.getByTestId('geo-map')).toBeVisible();
  });

  test('map hides when lat or lon is cleared', async ({ page }) => {
    await page.route('https://tile.openstreetmap.org/**', (route) =>
      route.fulfill({ status: 200, body: Buffer.alloc(0) }),
    );

    await page.click('text=+ Add manually');
    await page
      .locator('[placeholder="Location name"]')
      .first()
      .fill('Test Place');
    await page.click('text=+ Add coordinates');
    await page.locator('[placeholder="Latitude"]').first().fill('37.77');
    await page.locator('[placeholder="Longitude"]').first().fill('-122.42');
    await expect(page.getByTestId('geo-map')).toBeVisible();

    await page.locator('[placeholder="Longitude"]').first().fill('');
    await expect(page.getByTestId('geo-map')).not.toBeVisible();
  });

  test('clicking the map updates the lat/lon inputs', async ({ page }) => {
    await page.route('https://tile.openstreetmap.org/**', (route) =>
      route.fulfill({ status: 200, body: Buffer.alloc(0) }),
    );

    await page.click('text=+ Add manually');
    await page
      .locator('[placeholder="Location name"]')
      .first()
      .fill('Test Place');
    await page.click('text=+ Add coordinates');
    await page.locator('[placeholder="Latitude"]').first().fill('37.77');
    await page.locator('[placeholder="Longitude"]').first().fill('-122.42');

    const mapEl = page.getByTestId('geo-map');
    // Wait for the MapLibre canvas — the div appears immediately but the canvas
    // is created after the async dynamic import in onMount completes
    await expect(mapEl.locator('canvas')).toBeVisible();
    const box = await mapEl.boundingBox();
    if (!box) throw new Error('map bounding box not found');

    const latInput = page.locator('[placeholder="Latitude"]').first();
    const lngInput = page.locator('[placeholder="Longitude"]').first();
    const latBefore = await latInput.inputValue();

    await page.mouse.click(box.x + box.width * 0.1, box.y + box.height * 0.1);

    // Wait for the latitude input to reflect the clicked coordinate
    await expect(latInput).not.toHaveValue(latBefore);
    const latVal = await latInput.inputValue();
    const lngVal = await lngInput.inputValue();
    expect(Number.isNaN(parseFloat(latVal))).toBe(false);
    expect(Number.isNaN(parseFloat(lngVal))).toBe(false);
  });
});

// ── Protocol editing ─────────────────────────────────────────────────────────

const EDIT_DID = 'did:test:edit-spec';
const EDIT_HANDLE = 'user-edit-spec';
const OTHER_DID = 'did:test:edit-spec-other';
const OTHER_HANDLE = 'user-edit-spec-other';

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

test.describe('protocol editing', () => {
  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, EDIT_DID);
    await teardownDid(sql, OTHER_DID);
  });

  test('edit button visible for protocol author', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(EDIT_DID)]);
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}`);
    await expect(page.getByRole('link', { name: 'Edit' })).toBeVisible();
  });

  test('edit button not visible for non-owner', async ({
    page,
    sql,
    context,
  }) => {
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    await sql`
      INSERT INTO users (did, handle) VALUES (${OTHER_DID}, ${OTHER_HANDLE})
      ON CONFLICT (did) DO NOTHING
    `;
    await context.addCookies([authCookie(OTHER_DID)]);
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}`);
    await expect(page.getByRole('link', { name: 'Edit' })).not.toBeVisible();
  });

  test('non-owner cannot access edit route directly', async ({
    page,
    sql,
    context,
  }) => {
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    await sql`
      INSERT INTO users (did, handle) VALUES (${OTHER_DID}, ${OTHER_HANDLE})
      ON CONFLICT (did) DO NOTHING
    `;
    await context.addCookies([authCookie(OTHER_DID)]);
    const response = await page.goto(
      `/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`,
    );
    expect(response?.status()).toBe(403);
  });

  test('unauthenticated user is redirected to sign in', async ({
    page,
    sql,
  }) => {
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`);
    await expect(page).toHaveURL(/\/auth\/signin/);
  });

  test('edit form pre-populates title and description', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(EDIT_DID)]);
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`);
    await expect(page.locator('[name="title"]')).toHaveValue('Test Protocol');
    await expect(page.locator('[name="description"]')).toHaveValue(
      'A protocol for integration tests',
    );
  });

  test('successful edit updates title in DB and redirects', async ({
    page,
    sql,
    context,
  }) => {
    await context.addCookies([authCookie(EDIT_DID)]);
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`);

    await page.fill('[name="title"]', 'Updated Protocol Title');

    await page.click('text=Save changes');
    await expect(page).toHaveURL(
      `/app/protocols/${EDIT_HANDLE}/${protocolRkey}`,
    );
    await expect(
      page.getByRole('heading', { name: 'Updated Protocol Title' }),
    ).toBeVisible();

    const [row] = await sql<{ record: Record<string, unknown> }[]>`
      SELECT record FROM survey_protocols WHERE did = ${EDIT_DID} LIMIT 1
    `;
    expect(row.record.title).toBe('Updated Protocol Title');
  });

  test('editing replaces survey targets', async ({ page, sql, context }) => {
    await context.addCookies([authCookie(EDIT_DID)]);
    const { protocolRkey } = await seedProtocol(sql, EDIT_DID);
    const protocolUri = `at://${EDIT_DID}/bio.lexicons.temp.v0-1.surveyProtocol/${protocolRkey}`;

    await page.goto(`/protocols/${EDIT_HANDLE}/${protocolRkey}/edit`);

    // Remove all existing targets
    let removeCount = await page.locator('button[aria-label="Remove"]').count();
    while (removeCount > 0) {
      await page.locator('button[aria-label="Remove"]').first().click();
      removeCount = await page.locator('button[aria-label="Remove"]').count();
    }

    // Add a new verbatim target
    await page.click('text=+ Add custom target');
    await page
      .locator('[placeholder="Describe what to look for…"]')
      .fill('Freshwater fish');

    await page.click('text=Save changes');
    await expect(page).toHaveURL(
      `/app/protocols/${EDIT_HANDLE}/${protocolRkey}`,
    );

    const targets = await sql<{ record: Record<string, unknown> }[]>`
      SELECT record FROM survey_targets WHERE protocol_uri = ${protocolUri}
    `;
    expect(targets).toHaveLength(1);
    const scope = (
      targets[0].record.scope as { verbatimTargetScope: string }[]
    )[0];
    expect(scope.verbatimTargetScope).toBe('Freshwater fish');
  });
});

test('/protocols shows protocol titles', async ({ page, sql }) => {
  await sql`INSERT INTO users (did, handle) VALUES (${DID}, ${HANDLE}) ON CONFLICT (did) DO NOTHING`;
  await seedProtocol(sql, DID);

  try {
    await page.goto('/protocols');
    await expect(
      page.getByRole('link', { name: /Test Protocol.*@user-protocols-spec/ }),
    ).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

test('/protocols/[handle] shows protocol titles for that user', async ({
  page,
  sql,
}) => {
  await sql`INSERT INTO users (did, handle) VALUES (${DID}, ${HANDLE}) ON CONFLICT (did) DO NOTHING`;
  await seedProtocol(sql, DID);

  try {
    await page.goto(`/protocols/${HANDLE}`);
    await expect(page.getByText('Test Protocol')).toBeVisible();
  } finally {
    await teardownDid(sql, DID);
  }
});

// ── Last Survey column ────────────────────────────────────────────────────────

const LAST_DID = 'did:test:last-survey-spec';
const LAST_HANDLE = 'user-last-survey-spec';

test.describe('protocol detail Last Survey column', () => {
  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, LAST_DID);
  });

  test('links to the most recent survey per target', async ({ page, sql }) => {
    await sql`INSERT INTO users (did, handle) VALUES (${LAST_DID}, ${LAST_HANDLE}) ON CONFLICT (did) DO NOTHING`;
    const { protocolRkey } = await seedProtocol(sql, LAST_DID);
    const protocolUri = `at://${LAST_DID}/bio.lexicons.temp.v0-1.surveyProtocol/${protocolRkey}`;

    const targets = await sql<{ at_uri: string; record: { scope: unknown } }[]>`
      SELECT at_uri, record FROM survey_targets
      WHERE protocol_uri = ${protocolUri}
      ORDER BY indexed_at ASC
    `;
    const taxonTargetUri = targets[0].at_uri;

    // Older and newer survey, both with an occurrence for the first target.
    const { surveyRkey: olderRkey } = await seedSurvey(
      sql,
      LAST_DID,
      protocolUri,
      'Older Location',
      '2026-01-01T10:00:00.000Z',
    );
    const { surveyRkey: newerRkey } = await seedSurvey(
      sql,
      LAST_DID,
      protocolUri,
      'Newer Location',
      '2026-05-01T10:00:00.000Z',
    );
    const olderUri = `at://${LAST_DID}/bio.lexicons.temp.v0-1.survey/${olderRkey}`;
    const newerUri = `at://${LAST_DID}/bio.lexicons.temp.v0-1.survey/${newerRkey}`;
    await seedOccurrence(sql, LAST_DID, olderUri, taxonTargetUri);
    await seedOccurrence(sql, LAST_DID, newerUri, taxonTargetUri);

    await page.goto(`/protocols/${LAST_HANDLE}/${protocolRkey}`);

    // The more recent survey wins; the older one is not linked.
    await expect(
      page.locator(`a[href="/surveys/${LAST_HANDLE}/${newerRkey}"]`),
    ).toBeVisible();
    await expect(
      page.locator(`a[href="/surveys/${LAST_HANDLE}/${olderRkey}"]`),
    ).toHaveCount(0);

    // The second target has no occurrences — its row shows an em dash.
    const verbatimRow = page.getByRole('row').filter({ hasText: 'All birds' });
    await expect(verbatimRow).toContainText('—');
    await expect(verbatimRow.locator('a[href^="/surveys/"]')).toHaveCount(0);
  });
});

// ── Taxon autocomplete (regression guard for TaxonAutocomplete extraction) ────

const TAXON_DID = 'did:test:protocol-taxon-spec';
const TAXON_HANDLE = 'user-protocol-taxon-spec';

const MOCK_TAXON_RESULT = {
  inatId: 48978,
  scientificName: 'Quercus agrifolia',
  taxonRank: 'species',
  commonName: 'Coast Live Oak',
  kingdom: 'Plantae',
  taxonID: 'https://www.inaturalist.org/taxa/48978',
};

test.describe('taxon autocomplete', () => {
  test.beforeEach(async ({ page, sql, context }) => {
    await sql`
      INSERT INTO users (did, handle) VALUES (${TAXON_DID}, ${TAXON_HANDLE})
      ON CONFLICT (did) DO UPDATE SET handle = EXCLUDED.handle
    `;
    await context.addCookies([
      {
        name: 'did',
        value: TAXON_DID,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);

    await page.route('**/api/taxa**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [MOCK_TAXON_RESULT] }),
      }),
    );

    await page.goto('/protocols/new');
    await page.waitForLoadState('networkidle');
  });

  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, TAXON_DID);
  });

  test('typing triggers a taxa search and shows results', async ({ page }) => {
    await page.fill(
      '[placeholder="Search iNaturalist taxa (e.g. Quercus)"]',
      'Quercus',
    );
    await page.waitForTimeout(350);

    await expect(page.getByText('Quercus agrifolia')).toBeVisible();
    await expect(page.getByText('Coast Live Oak')).toBeVisible();
  });

  test('selecting a result adds it as a survey target', async ({ page }) => {
    await page.fill(
      '[placeholder="Search iNaturalist taxa (e.g. Quercus)"]',
      'Quercus',
    );
    await page.waitForTimeout(350);

    await page.getByText('Quercus agrifolia').click();

    await expect(page.locator('[id^="target-sciname-"]').first()).toHaveValue(
      'Quercus agrifolia',
    );
  });

  test('search input clears after selecting a result', async ({ page }) => {
    await page.fill(
      '[placeholder="Search iNaturalist taxa (e.g. Quercus)"]',
      'Quercus',
    );
    await page.waitForTimeout(350);

    await page.getByText('Quercus agrifolia').click();

    await expect(
      page.locator('[placeholder="Search iNaturalist taxa (e.g. Quercus)"]'),
    ).toHaveValue('');
  });
});

// ── Nominatim place search ────────────────────────────────────────────────────

const SEARCH_DID = 'did:test:protocol-search-spec';
const SEARCH_HANDLE = 'user-protocol-search-spec';

const MOCK_PLACE_RESULT = {
  placeId: 1,
  displayName: 'Golden Gate Park, San Francisco, California, United States',
  lat: '37.7693681',
  lon: '-122.4821837',
  address: {
    countryCode: 'US',
    region: 'California',
    locality: 'San Francisco',
    postalCode: '94117',
  },
};

test.describe('Nominatim place search', () => {
  test.beforeEach(async ({ page, sql, context }) => {
    await sql`
      INSERT INTO users (did, handle) VALUES (${SEARCH_DID}, ${SEARCH_HANDLE})
      ON CONFLICT (did) DO UPDATE SET handle = EXCLUDED.handle
    `;
    await context.addCookies([
      {
        name: 'did',
        value: SEARCH_DID,
        domain: '127.0.0.1',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);

    await page.route('**/api/places**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results: [MOCK_PLACE_RESULT] }),
      }),
    );

    await page.goto('/protocols/new');
    await page.waitForLoadState('networkidle');
  });

  test.afterEach(async ({ sql }) => {
    await teardownDid(sql, SEARCH_DID);
  });

  test('typing in the search box does not send a request', async ({ page }) => {
    let placesRequestCount = 0;
    page.on('request', (req) => {
      if (req.url().includes('/api/places')) placesRequestCount++;
    });

    await page.fill(
      '[placeholder="Search for a place on OpenStreetMap…"]',
      'Golden Gate Park',
    );
    // No debounce in the implementation; wait briefly to confirm nothing fires
    await page.waitForTimeout(400);

    expect(placesRequestCount).toBe(0);
  });

  test('clicking Search sends a request with the query', async ({ page }) => {
    const requestUrls: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/places')) requestUrls.push(req.url());
    });

    await page.fill(
      '[placeholder="Search for a place on OpenStreetMap…"]',
      'Golden Gate Park',
    );
    await page.click('button:has-text("Search")');
    await page.waitForLoadState('networkidle');

    expect(requestUrls).toHaveLength(1);
    expect(requestUrls[0]).toContain('q=Golden');
  });

  test('pressing Enter in the search box sends a request', async ({ page }) => {
    const requestUrls: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/places')) requestUrls.push(req.url());
    });

    await page.fill(
      '[placeholder="Search for a place on OpenStreetMap…"]',
      'Golden Gate Park',
    );
    await page.press(
      '[placeholder="Search for a place on OpenStreetMap…"]',
      'Enter',
    );
    await page.waitForLoadState('networkidle');

    expect(requestUrls).toHaveLength(1);
    expect(requestUrls[0]).toContain('q=Golden');
  });

  test('selecting a result adds a pre-filled location entry', async ({
    page,
  }) => {
    await page.fill(
      '[placeholder="Search for a place on OpenStreetMap…"]',
      'Golden Gate',
    );
    await page.click('button:has-text("Search")');

    await page
      .getByRole('button', { name: /Golden Gate Park/ })
      .first()
      .click();

    await expect(
      page.locator('[placeholder="Location name"]').first(),
    ).toHaveValue('Golden Gate Park');
    await expect(page.locator('[placeholder="Latitude"]').first()).toHaveValue(
      '37.7693681',
    );
    await expect(page.locator('[placeholder="Longitude"]').first()).toHaveValue(
      '-122.4821837',
    );
    await expect(
      page.locator('[placeholder="San Francisco"]').first(),
    ).toHaveValue('San Francisco');
    await expect(page.locator('[placeholder="CA"]').first()).toHaveValue(
      'California',
    );
  });

  test('search input and results are cleared after selecting a result', async ({
    page,
  }) => {
    await page.fill(
      '[placeholder="Search for a place on OpenStreetMap…"]',
      'Golden Gate',
    );
    await page.click('button:has-text("Search")');

    await page
      .getByRole('button', { name: /Golden Gate Park/ })
      .first()
      .click();

    await expect(
      page.locator('[placeholder="Search for a place on OpenStreetMap…"]'),
    ).toHaveValue('');
    await expect(
      page.getByRole('button', { name: /Golden Gate Park, San Francisco/ }),
    ).not.toBeVisible();
  });

  test('map appears after selecting a search result with coordinates', async ({
    page,
  }) => {
    await page.route('https://tile.openstreetmap.org/**', (route) =>
      route.fulfill({ status: 200, body: Buffer.alloc(0) }),
    );

    await page.fill(
      '[placeholder="Search for a place on OpenStreetMap…"]',
      'Golden Gate',
    );
    await page.click('button:has-text("Search")');
    await page
      .getByRole('button', { name: /Golden Gate Park/ })
      .first()
      .click();

    await expect(page.getByTestId('geo-map')).toBeVisible();
  });
});
