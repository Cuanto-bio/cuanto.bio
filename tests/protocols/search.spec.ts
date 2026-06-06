import { expect, teardownDid, test } from '../fixtures.js';

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
