import { expect, teardownDid, test } from '../fixtures.js';

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
